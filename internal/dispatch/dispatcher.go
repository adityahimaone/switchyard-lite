package dispatch

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/store"
	"github.com/adityahimaone/switchyard-lite/internal/tasks"
)

// Config tunes the dispatcher.
type Config struct {
	NodeAgentURL string
	Token        string
	WorkerID     string
	Lease        time.Duration // claim lease; renewed while polling
	Poll         time.Duration // result poll interval
	Tick         time.Duration // fallback scan interval
	MaxRetries   int
	MaxParallel  int
	TimeoutS     int
}

// ConfigFromEnv reads NODE_AGENT_URL / NODE_AGENT_TOKEN.
func ConfigFromEnv() Config {
	return Config{NodeAgentURL: os.Getenv("NODE_AGENT_URL"), Token: os.Getenv("NODE_AGENT_TOKEN")}
}

func (c *Config) defaults() {
	if c.WorkerID == "" {
		h, _ := os.Hostname()
		c.WorkerID = fmt.Sprintf("%s-%d", h, os.Getpid())
	}
	if c.Lease == 0 {
		c.Lease = 60 * time.Second
	}
	if c.Poll == 0 {
		c.Poll = 2 * time.Second
	}
	if c.Tick == 0 {
		c.Tick = 30 * time.Second
	}
	if c.MaxRetries == 0 {
		c.MaxRetries = 2
	}
	if c.MaxParallel == 0 {
		c.MaxParallel = 4
	}
}

type Dispatcher struct {
	S      *store.Store
	Tasks  *tasks.Service
	Cfg    Config
	Client *Client
	Now    func() time.Time

	wake    chan struct{}
	mu      sync.Mutex
	running map[string]bool
	wg      sync.WaitGroup
}

func New(s *store.Store, cfg Config) (*Dispatcher, error) {
	if err := s.EnsureDispatch(); err != nil {
		return nil, err
	}
	cfg.defaults()
	return &Dispatcher{S: s, Tasks: tasks.New(s), Cfg: cfg,
		Client:  &Client{BaseURL: cfg.NodeAgentURL, Token: cfg.Token},
		Now:     time.Now,
		wake:    make(chan struct{}, 1),
		running: map[string]bool{}}, nil
}

// Wake nudges the loop to scan immediately.
func (d *Dispatcher) Wake() {
	select {
	case d.wake <- struct{}{}:
	default:
	}
}

// Wait blocks until in-flight runs finish (tests).
func (d *Dispatcher) Wait() { d.wg.Wait() }

// Run is the dispatcher loop; returns when ctx ends.
func (d *Dispatcher) Run(ctx context.Context) {
	t := time.NewTicker(d.Cfg.Tick)
	defer t.Stop()
	for {
		if err := d.Tick(ctx); err != nil {
			log.Printf("dispatch: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		case <-d.wake:
		}
	}
}

// Tick reaps expired leases then claims and starts todo tasks.
func (d *Dispatcher) Tick(ctx context.Context) error {
	if _, err := d.ReapExpired(); err != nil {
		return err
	}
	rows, err := d.S.DB.Query(`SELECT id FROM tasks WHERE status='todo' ORDER BY created_at, id`)
	if err != nil {
		return err
	}
	var ids []string
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()
	for _, id := range ids {
		d.mu.Lock()
		n := len(d.running)
		d.mu.Unlock()
		if n >= d.Cfg.MaxParallel {
			break
		}
		if _, err := d.Start(ctx, id); err != nil && !errors.Is(err, ErrNotClaimable) {
			log.Printf("dispatch %s: %v", id, err)
		}
	}
	return nil
}

// ErrNotClaimable: someone else holds a live lease or the task isn't todo.
var ErrNotClaimable = errors.New("task not claimable")

// Claim atomically takes the lease. Exactly one concurrent caller wins; an
// expired lease can be stolen.
func (d *Dispatcher) Claim(taskID, runID string) (bool, error) {
	now := d.Now().Unix()
	res, err := d.S.DB.Exec(`INSERT INTO dispatch_claims(task_id,worker_id,run_id,attempt,claimed_at,lease_expires_at)
		SELECT id,?,?,retry_count+1,?,? FROM tasks WHERE id=? AND status='todo'
		ON CONFLICT(task_id) DO UPDATE SET worker_id=excluded.worker_id, run_id=excluded.run_id,
		  attempt=excluded.attempt, claimed_at=excluded.claimed_at, lease_expires_at=excluded.lease_expires_at
		  WHERE dispatch_claims.lease_expires_at < ?`,
		d.Cfg.WorkerID, runID, now, now+int64(d.Cfg.Lease.Seconds()), taskID, now)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

func (d *Dispatcher) release(taskID, runID string) {
	_, _ = d.S.DB.Exec(`DELETE FROM dispatch_claims WHERE task_id=? AND run_id=?`, taskID, runID)
}

func (d *Dispatcher) renew(taskID, runID string) bool {
	res, err := d.S.DB.Exec(`UPDATE dispatch_claims SET lease_expires_at=? WHERE task_id=? AND run_id=?`,
		d.Now().Unix()+int64(d.Cfg.Lease.Seconds()), taskID, runID)
	if err != nil {
		return false
	}
	n, _ := res.RowsAffected()
	return n == 1
}

// ReapExpired requeues in_progress tasks whose lease lapsed.
func (d *Dispatcher) ReapExpired() (int, error) {
	rows, err := d.S.DB.Query(`SELECT task_id FROM dispatch_claims WHERE lease_expires_at < ?`, d.Now().Unix())
	if err != nil {
		return 0, err
	}
	var ids []string
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()
	n := 0
	for _, id := range ids {
		if _, err := d.S.DB.Exec(`DELETE FROM dispatch_claims WHERE task_id=?`, id); err != nil {
			return n, err
		}
		t, err := d.Tasks.Get(id)
		if err != nil || t.Status != tasks.InProgress {
			continue
		}
		_, _ = d.Tasks.AddComment(id, "dispatcher", "lease expired; requeued")
		if _, err := d.Tasks.Move(id, tasks.Todo, "dispatcher"); err == nil {
			n++
		}
	}
	return n, nil
}

// Start claims the task and runs it in the background.
func (d *Dispatcher) Start(ctx context.Context, taskID string) (string, error) {
	runID := fmt.Sprintf("run_%x", d.Now().UnixNano())
	ok, err := d.Claim(taskID, runID)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", ErrNotClaimable
	}
	if _, err := d.Tasks.Move(taskID, tasks.InProgress, "dispatcher"); err != nil {
		d.release(taskID, runID)
		return "", err
	}
	t, _ := d.Tasks.Get(taskID)
	if t.Status != tasks.InProgress { // blocked by deps
		d.release(taskID, runID)
		return "", ErrNotClaimable
	}
	d.mu.Lock()
	d.running[taskID] = true
	d.mu.Unlock()
	d.wg.Add(1)
	go func() {
		defer d.wg.Done()
		defer func() { d.mu.Lock(); delete(d.running, taskID); d.mu.Unlock() }()
		d.execute(ctx, t, runID)
	}()
	return runID, nil
}

func (d *Dispatcher) execute(ctx context.Context, t tasks.Task, runID string) {
	workspace := t.Workspace
	if IsGit(workspace) {
		wt, err := EnsureWorktreeFrom(workspace, t.ID, t.Branch)
		if err != nil {
			d.fail(t, runID, "worktree: "+err.Error())
			return
		}
		d.saveWorktree(t.ID, wt)
		workspace = wt.Path
	}
	var boardName string
	_ = d.S.DB.QueryRow(`SELECT name FROM boards WHERE id=?`, t.BoardID).Scan(&boardName)
	message := AugmentPrompt(t.Prompt, t.Workspace, d.workspaceLabels(t.Workspace), t.Paths, t.Skills)
	req := Request{TaskID: t.ID, Title: t.Title, Board: boardName, Message: message, Workspace: workspace,
		Model: t.Model, Effort: t.Effort, Executor: t.Executor, Acceptance: t.Acceptance,
		Paths: t.Paths, Skills: t.Skills, Branch: t.Branch,
		RunID: runID, TimeoutS: d.Cfg.TimeoutS}
	if err := d.Client.Dispatch(ctx, req); err != nil {
		d.fail(t, runID, err.Error())
		return
	}
	for {
		if !d.renew(t.ID, runID) { // lease lost (reaped/stolen): stop touching the task
			return
		}
		res, err := d.Client.FetchResult(ctx, t.ID)
		if err == nil {
			d.finish(t, runID, res)
			return
		}
		if !errors.Is(err, ErrPending) {
			log.Printf("dispatch %s: result: %v", t.ID, err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(d.Cfg.Poll):
		}
	}
}

// workspaceLabels reads the labels attached to a workspace so the Fast-8
// rules can be attached even when the prompt itself mentions no portal.
func (d *Dispatcher) workspaceLabels(path string) []string {
	var raw string
	_ = d.S.DB.QueryRow(`SELECT labels FROM dispatch_workspaces WHERE path=? LIMIT 1`, path).Scan(&raw)
	out := []string{}
	for _, p := range strings.Split(raw, ",") {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func (d *Dispatcher) saveWorktree(id string, wt Worktree) {
	_, _ = d.S.DB.Exec(`INSERT INTO task_worktrees(task_id,repo,path,branch,base_sha) VALUES(?,?,?,?,?)
		ON CONFLICT(task_id) DO UPDATE SET path=excluded.path`, id, wt.Repo, wt.Path, wt.Branch, wt.BaseSHA)
}

// owns checks the lease is still ours before mutating the task.
func (d *Dispatcher) owns(taskID, runID string) bool {
	var one int
	return d.S.DB.QueryRow(`SELECT 1 FROM dispatch_claims WHERE task_id=? AND run_id=?`, taskID, runID).Scan(&one) == nil
}

func (d *Dispatcher) finish(t tasks.Task, runID string, res *Result) {
	if !res.Success {
		msg := res.Error
		if msg == "" {
			msg = res.Output
		}
		d.fail(t, runID, msg)
		return
	}
	if !d.owns(t.ID, runID) {
		return
	}
	if res.Output != "" {
		_, _ = d.Tasks.AddComment(t.ID, "worker", res.Output)
	}
	_, _ = d.Tasks.Move(t.ID, tasks.Review, "dispatcher")
	d.release(t.ID, runID)
}

func (d *Dispatcher) fail(t tasks.Task, runID, reason string) {
	if !d.owns(t.ID, runID) {
		return
	}
	_, _ = d.Tasks.AddComment(t.ID, "dispatcher", "attempt failed: "+reason)
	var retries int
	_ = d.S.DB.QueryRow(`SELECT retry_count FROM tasks WHERE id=?`, t.ID).Scan(&retries)
	retries++
	_, _ = d.S.DB.Exec(`UPDATE tasks SET retry_count=?, error_sig=? WHERE id=?`, retries, trunc(reason, 200), t.ID)
	next := tasks.Todo
	if retries > d.Cfg.MaxRetries {
		next = tasks.Failed
	}
	_, _ = d.Tasks.Move(t.ID, next, "dispatcher")
	d.release(t.ID, runID)
}

func trunc(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

var _ = sql.ErrNoRows
