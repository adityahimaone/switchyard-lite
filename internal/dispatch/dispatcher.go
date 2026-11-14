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
	"github.com/adityahimaone/switchyard-lite/internal/worker"
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
	Remote *worker.Client
	Now    func() time.Time
	LogDir string

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
		Remote:  worker.New(cfg.NodeAgentURL, cfg.Token),
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

// Tick reaps expired leases then claims and starts todo tasks (skipping passive tracker cards).
func (d *Dispatcher) Tick(ctx context.Context) error {
	if _, err := d.ReapExpired(); err != nil {
		return err
	}
	rows, err := d.S.DB.Query(`SELECT id FROM tasks WHERE status='todo' AND COALESCE(execution_mode,'managed') <> 'tracker' ORDER BY created_at, id`)
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
// expired lease can be stolen. Passive tracker tasks are never auto-claimed.
func (d *Dispatcher) Claim(taskID, runID string) (bool, error) {
	now := d.Now().Unix()
	res, err := d.S.DB.Exec(`INSERT INTO dispatch_claims(task_id,worker_id,run_id,attempt,claimed_at,lease_expires_at)
		SELECT id,?,?,retry_count+1,?,? FROM tasks WHERE id=? AND status='todo' AND COALESCE(execution_mode,'managed') <> 'tracker'
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
	now := d.Now().Unix()
	_, _ = d.S.DB.Exec(`UPDATE tasks SET started_at=?, completed_at=0, error_sig='', result='' WHERE id=?`, now, taskID)
	_ = ResetWorkerLog(d.WorkerLogDir(), taskID)
	_ = d.Tasks.RecordEvent(taskID, "claimed", map[string]any{
		"run_id":    runID,
		"worker_id": d.Cfg.WorkerID,
		"executor":  t.Executor,
		"model":     t.Model,
	})
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
	// Preparing a remote worktree can take several node-agent round-trips;
	// keep the claim alive so a slow worker is not reaped mid-setup.
	stopRenew := make(chan struct{})
	go func() {
		tick := time.NewTicker(20 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-stopRenew:
				return
			case <-tick.C:
				if !d.renew(t.ID, runID) {
					return
				}
			}
		}
	}()
	wt, transport, err := d.prepareWorktree(ctx, t)
	close(stopRenew)
	if err != nil {
		d.failRun(t, runID, "worktree: "+err.Error(), nil, false)
		return
	}
	if wt != nil {
		d.saveWorktree(t.ID, *wt, transport)
		workspace = wt.Path
		_ = d.Tasks.RecordEvent(t.ID, "worktree_ready", map[string]any{
			"run_id":    runID,
			"path":      wt.Path,
			"branch":    wt.Branch,
			"base_sha":  wt.BaseSHA,
			"transport": transport,
		})
	}
	var boardName string
	_ = d.S.DB.QueryRow(`SELECT name FROM boards WHERE id=?`, t.BoardID).Scan(&boardName)
	message := AugmentPrompt(t.Prompt, t.Workspace, d.workspaceLabels(t.Workspace), t.Paths, t.Skills)
	req := Request{TaskID: t.ID, Title: t.Title, Board: boardName, Message: message, Workspace: workspace,
		Model: t.Model, Effort: t.Effort, Executor: t.Executor, ExecutionMode: t.ExecutionMode, Acceptance: t.Acceptance,
		Paths: t.Paths, Skills: t.Skills, Branch: t.Branch,
		RunID: runID, TimeoutS: d.Cfg.TimeoutS}
	applyTaskSession(&req, t)
	ack, err := d.Client.DispatchWithAck(ctx, req)
	if err != nil {
		d.failRun(t, runID, err.Error(), nil, false)
		return
	}
	if ack.SessionID != "" && t.SessionID == "" {
		_, _ = d.S.DB.Exec(`UPDATE tasks SET session_id=? WHERE id=? AND session_id=''`, ack.SessionID, t.ID)
	}
	_ = d.Tasks.RecordEvent(t.ID, "remote_dispatched", map[string]any{
		"run_id":     runID,
		"worker_id":  d.Cfg.WorkerID,
		"executor":   firstNonEmpty(ack.Executor, t.Executor),
		"model":      firstNonEmpty(ack.Model, t.Model),
		"session_id": ack.SessionID,
		"workspace":  workspace,
	})

	var logOffset int64
	streamedBytes := 0
	var streamedBuf strings.Builder
	streamAsked := false
	flushProgress := func() {
		chunk, nextOff, perr := d.Client.FetchProgress(ctx, t.ID, logOffset)
		if perr != nil {
			return
		}
		if chunk != "" {
			_ = AppendWorkerLog(d.WorkerLogDir(), t.ID, chunk)
			_ = d.Tasks.RecordEvent(t.ID, "worker_output", map[string]any{
				"run_id": runID,
				"output": chunk,
			})
			streamedBuf.WriteString(chunk)
			streamedBytes += len(chunk)
			if !streamAsked && (strings.Contains(chunk, "[/QUESTION]") || strings.Contains(chunk, "```question") || strings.Contains(chunk, `"question"`)) {
				if q, opts, ctxText, ok := DetectOpenQuestion(streamedBuf.String()); ok {
					streamAsked = true
					d.recordDetectedQuestion(t, q, opts, ctxText)
				}
			}
		}
		logOffset = nextOff
	}

	for {
		if !d.renew(t.ID, runID) { // lease lost (reaped/stolen): stop touching the task
			return
		}
		flushProgress()
		res, err := d.Client.FetchResult(ctx, t.ID)
		if err == nil {
			flushProgress()
			d.finishWithStream(t, runID, res, streamedBytes > 0)
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

func (d *Dispatcher) saveWorktree(id string, wt Worktree, transport string) {
	_, _ = d.S.DB.Exec(`INSERT INTO task_worktrees(task_id,repo,path,branch,base_sha,transport) VALUES(?,?,?,?,?,?)
		ON CONFLICT(task_id) DO UPDATE SET path=excluded.path, base_sha=excluded.base_sha, transport=excluded.transport`,
		id, wt.Repo, wt.Path, wt.Branch, wt.BaseSHA, transport)
}

// owns checks the lease is still ours before mutating the task.
func (d *Dispatcher) owns(taskID, runID string) bool {
	var one int
	return d.S.DB.QueryRow(`SELECT 1 FROM dispatch_claims WHERE task_id=? AND run_id=?`, taskID, runID).Scan(&one) == nil
}

func (d *Dispatcher) finish(t tasks.Task, runID string, res *Result) {
	d.finishWithStream(t, runID, res, false)
}

func (d *Dispatcher) finishWithStream(t tasks.Task, runID string, res *Result, streamed bool) {
	if !res.Success {
		d.failRun(t, runID, res.Error, res, streamed)
		return
	}
	if !d.owns(t.ID, runID) {
		return
	}
	if !streamed && res.Output != "" {
		_ = AppendWorkerLog(d.WorkerLogDir(), t.ID, res.Output)
		_ = d.Tasks.RecordEvent(t.ID, "worker_output", map[string]any{
			"run_id": runID,
			"output": res.Output,
		})
	}
	now := d.Now().Unix()
	sessionID, dshWsID, turnSeq := extractResultSession(firstNonEmpty(res.Executor, t.Executor), res)
	d.persistTaskSession(t.ID, sessionID, dshWsID, turnSeq)
	_, _ = d.S.DB.Exec(`UPDATE tasks SET result=?, error_sig='', completed_at=? WHERE id=?`, res.Output, now, t.ID)
	payload := map[string]any{
		"run_id":      runID,
		"worker_id":   d.Cfg.WorkerID,
		"executor":    firstNonEmpty(res.Executor, t.Executor),
		"model":       firstNonEmpty(res.Model, t.Model),
		"session_id":  sessionID,
		"duration_ms": res.DurationMs,
		"output":      trunc(res.Output, 65536),
	}
	if u := UsageFromJSON(res.Usage, res.Output); u != nil {
		payload["usage"] = u
	}
	_ = d.Tasks.RecordEvent(t.ID, "completed", payload)
	if res.Output != "" {
		_, _ = d.Tasks.AddComment(t.ID, "worker", res.Output)
	}
	if q, opts, ctxText, ok := DetectOpenQuestion(res.Output); ok {
		d.recordDetectedQuestion(t, q, opts, ctxText)
	}
	_, _ = d.Tasks.Move(t.ID, tasks.Review, "dispatcher")
	d.release(t.ID, runID)
}

func (d *Dispatcher) fail(t tasks.Task, runID, reason string) {
	d.failRun(t, runID, reason, nil, false)
}

func (d *Dispatcher) failRun(t tasks.Task, runID, rawErr string, res *Result, streamed bool) {
	if !d.owns(t.ID, runID) {
		return
	}
	var rawOut, sessionID, dshWsID, executor, model string
	var durationMs int64
	var turnSeq *int64
	var rawUsage map[string]any
	if res != nil {
		rawOut = res.Output
		if rawErr == "" {
			rawErr = res.Error
		}
		executor = res.Executor
		model = res.Model
		durationMs = res.DurationMs
		rawUsage = res.Usage
		sessionID, dshWsID, turnSeq = extractResultSession(firstNonEmpty(executor, t.Executor), res)
		d.persistTaskSession(t.ID, sessionID, dshWsID, turnSeq)
	}
	if !streamed && rawOut != "" {
		_ = AppendWorkerLog(d.WorkerLogDir(), t.ID, rawOut)
		_ = d.Tasks.RecordEvent(t.ID, "worker_output", map[string]any{
			"run_id": runID,
			"output": rawOut,
		})
	}
	reason, permanent := ExtractFailureReason(rawErr, rawOut)
	now := d.Now().Unix()

	var retries int
	_ = d.S.DB.QueryRow(`SELECT retry_count FROM tasks WHERE id=?`, t.ID).Scan(&retries)
	retries++
	_, _ = d.S.DB.Exec(`UPDATE tasks SET retry_count=?, error_sig=?, result=?, completed_at=? WHERE id=?`,
		retries, trunc(reason, 200), rawOut, now, t.ID)

	payload := map[string]any{
		"run_id":      runID,
		"worker_id":   d.Cfg.WorkerID,
		"executor":    firstNonEmpty(executor, t.Executor),
		"model":       firstNonEmpty(model, t.Model),
		"session_id":  sessionID,
		"duration_ms": durationMs,
		"error":       reason,
		"permanent":   permanent,
		"output":      trunc(rawOut, 65536),
	}
	if u := UsageFromJSON(rawUsage, rawOut); u != nil {
		payload["usage"] = u
	}
	_ = d.Tasks.RecordEvent(t.ID, "failed", payload)
	_, _ = d.Tasks.AddComment(t.ID, "dispatcher", "attempt failed: "+reason)
	if q, opts, ctxText, ok := DetectOpenQuestion(rawOut); ok {
		d.recordDetectedQuestion(t, q, opts, ctxText)
	}

	next := tasks.Todo
	if retries > d.Cfg.MaxRetries || permanent {
		next = tasks.Failed
	}
	_, _ = d.Tasks.Move(t.ID, next, "dispatcher")
	d.release(t.ID, runID)
}

func isContinuityHarness(executor string) bool {
	switch strings.ToLower(strings.TrimSpace(executor)) {
	case "dsh", "commandcode", "claude", "omp":
		return true
	default:
		return false
	}
}

func applyTaskSession(req *Request, t tasks.Task) {
	if t.SessionID == "" || !isContinuityHarness(t.Executor) {
		return
	}
	kind := strings.ToLower(strings.TrimSpace(t.Executor))
	req.HarnessKind = kind
	req.SessionContinuation = true
	switch kind {
	case "dsh":
		req.DSHSessionID = t.SessionID
		req.DSHWorkspaceID = t.DSHWorkspaceID
		req.LastTurnSeq = t.LastTurnSeq
	case "commandcode":
		req.CommandCodeSessionID = t.SessionID
	case "claude":
		req.ClaudeSessionID = t.SessionID
	case "omp":
		req.OMPSessionID = t.SessionID
	}
}

func extractResultSession(executor string, res *Result) (sessionID, dshWorkspaceID string, turnSeq *int64) {
	if res == nil {
		return "", "", nil
	}
	switch strings.ToLower(strings.TrimSpace(executor)) {
	case "commandcode":
		sessionID = firstNonEmpty(res.CommandCodeSessionID, res.SessionID)
	case "claude":
		sessionID = firstNonEmpty(res.ClaudeSessionID, res.SessionID)
	case "omp":
		sessionID = firstNonEmpty(res.OMPSessionID, res.SessionID)
	default:
		sessionID = firstNonEmpty(res.DshSessionID, res.SessionID)
		if sessionID == "" {
			sessionID = firstNonEmpty(res.CommandCodeSessionID, res.ClaudeSessionID)
		}
		if sessionID == "" {
			sessionID = res.OMPSessionID
		}
	}
	dshWorkspaceID = firstNonEmpty(res.DSHWorkspaceID, res.WorkspaceID)
	turnSeq = res.LastTurnSeq
	return sessionID, dshWorkspaceID, turnSeq
}

func (d *Dispatcher) persistTaskSession(taskID, sessionID, dshWsID string, turnSeq *int64) {
	if sessionID == "" && dshWsID == "" && turnSeq == nil {
		return
	}
	if sessionID != "" {
		_, _ = d.S.DB.Exec(`UPDATE tasks SET session_id=? WHERE id=?`, sessionID, taskID)
	}
	if dshWsID != "" {
		_, _ = d.S.DB.Exec(`UPDATE tasks SET dsh_workspace_id=? WHERE id=?`, dshWsID, taskID)
	}
	if turnSeq != nil {
		_, _ = d.S.DB.Exec(`UPDATE tasks SET last_turn_seq=? WHERE id=?`, *turnSeq, taskID)
	}
}

func (d *Dispatcher) recordDetectedQuestion(t tasks.Task, q string, opts []string, ctxText string) {
	cur, err := d.Tasks.Get(t.ID)
	if err == nil && cur.Question != nil && cur.Question.Status == "pending" && cur.Question.Question == q {
		return
	}
	_, _ = d.Tasks.AskQuestion(t.ID, tasks.AskQuestionInput{
		Question: q,
		Options:  opts,
		Context:  ctxText,
		Author:   firstNonEmpty(t.Executor, "agent"),
	})
}

// ResumeWithAnswer records the user's answer into the task continuation prompt,
// moves a managed task back to todo if needed, and starts a resumed worker run
// carrying any bound dsh/commandcode/claude/omp session identity.
func (d *Dispatcher) ResumeWithAnswer(ctx context.Context, taskID string, q tasks.TaskQuestion, answer string) (string, bool, error) {
	t, err := d.Tasks.Get(taskID)
	if err != nil {
		return "", false, err
	}
	if t.ExecutionMode == tasks.ExecTracker {
		return "", false, nil
	}
	if t.Executor == "" && t.SessionID == "" && t.Status != tasks.Review && t.Status != tasks.Failed && t.Status != tasks.Blocked && t.Status != tasks.InProgress && t.Status != tasks.Todo {
		return "", false, nil
	}
	contBlock := fmt.Sprintf("[User Answer — %s]\nQuestion: %s\nSelected / Answer: %s\nProceed with the task applying this decision.",
		q.ID, q.Question, answer)
	nextPrompt := strings.TrimSpace(t.Prompt)
	if !strings.Contains(nextPrompt, q.ID) {
		if nextPrompt != "" {
			nextPrompt += "\n\n" + contBlock
		} else {
			nextPrompt = contBlock
		}
		if _, err := d.Tasks.Update(taskID, tasks.Patch{Prompt: &nextPrompt}); err != nil {
			return "", false, err
		}
	}
	_, _ = d.S.DB.Exec(`DELETE FROM dispatch_claims WHERE task_id=?`, taskID)
	_, _ = d.S.DB.Exec(`UPDATE tasks SET error_sig='' WHERE id=?`, taskID)
	if t.Status != tasks.Todo {
		if _, err := d.Tasks.Move(taskID, tasks.Todo, "question"); err != nil {
			return "", false, err
		}
	}
	d.mu.Lock()
	inFlight := len(d.running)
	d.mu.Unlock()
	if inFlight >= d.Cfg.MaxParallel || d.Client == nil || d.Client.BaseURL == "" {
		d.Wake()
		return "", true, nil
	}
	runID, err := d.Start(ctx, taskID)
	if err != nil {
		d.Wake()
		return "", false, err
	}
	return runID, true, nil
}

func trunc(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

var _ = sql.ErrNoRows
