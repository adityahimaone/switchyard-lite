package dispatch

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/adityahimaone/switchyard-studio/internal/harnesses"
	"github.com/adityahimaone/switchyard-studio/internal/store"
	"github.com/adityahimaone/switchyard-studio/internal/tasks"
	"github.com/adityahimaone/switchyard-studio/internal/worker"
)

// Config tunes the dispatcher.
type Config struct {
	NodeAgentURL        string
	Token               string
	WorkerID            string
	Lease               time.Duration // claim lease; renewed while running
	Poll                time.Duration // result poll interval
	Tick                time.Duration // fallback scan interval
	MaxRetries          int
	MaxParallel         int
	TimeoutS            int
	CapacityBackoffBase time.Duration // initial backoff on 503 / queue-full
	CapacityBackoffMax  time.Duration // max backoff cap on 503 / queue-full
}

const (
	defaultLease               = 5 * time.Minute
	defaultCapacityBackoffBase = 10 * time.Second
	defaultCapacityBackoffMax  = 5 * time.Minute
	leaseSettingKey            = "dispatch.lease"
)

func parseDurationSetting(raw string) time.Duration {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	if d, err := time.ParseDuration(raw); err == nil && d > 0 {
		return d
	}
	if secs, err := strconv.Atoi(raw); err == nil && secs > 0 {
		return time.Duration(secs) * time.Second
	}
	return 0
}

// ConfigFromEnv reads NODE_AGENT_URL, NODE_AGENT_TOKEN, and optional SWITCHYARD_DISPATCH_LEASE.
func ConfigFromEnv() Config {
	return Config{
		NodeAgentURL: os.Getenv("NODE_AGENT_URL"),
		Token:        os.Getenv("NODE_AGENT_TOKEN"),
		Lease:        parseDurationSetting(os.Getenv("SWITCHYARD_DISPATCH_LEASE")),
	}
}

func (c *Config) defaults() {
	if c.WorkerID == "" {
		h, _ := os.Hostname()
		c.WorkerID = fmt.Sprintf("%s-%d", h, os.Getpid())
	}
	if c.Lease <= 0 {
		c.Lease = defaultLease
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
	if c.CapacityBackoffBase <= 0 {
		c.CapacityBackoffBase = defaultCapacityBackoffBase
	}
	if c.CapacityBackoffMax < c.CapacityBackoffBase {
		c.CapacityBackoffMax = defaultCapacityBackoffMax
		if c.CapacityBackoffMax < c.CapacityBackoffBase {
			c.CapacityBackoffMax = c.CapacityBackoffBase
		}
	}
}

type Dispatcher struct {
	S             *store.Store
	Tasks         *tasks.Service
	Cfg           Config
	Client        *Client
	Remote        *worker.Client
	Now           func() time.Time
	LogDir        string
	AgyRunner     AgyExecFunc
	AgyAuthRunner AgyAuthFunc

	wake             chan struct{}
	mu               sync.Mutex
	running          map[string]bool
	capacityAttempts map[string]int
	backoffUntil     map[string]time.Time
	wg               sync.WaitGroup
}

func New(s *store.Store, cfg Config) (*Dispatcher, error) {
	if err := s.EnsureDispatch(); err != nil {
		return nil, err
	}
	if cfg.Lease <= 0 && s != nil && s.DB != nil {
		var raw string
		if err := s.DB.QueryRow(`SELECT value FROM dispatch_settings WHERE key=?`, leaseSettingKey).Scan(&raw); err == nil {
			if parsed := parseDurationSetting(raw); parsed > 0 {
				cfg.Lease = parsed
			}
		}
	}
	cfg.defaults()
	return &Dispatcher{S: s, Tasks: tasks.New(s), Cfg: cfg,
		Client:           &Client{BaseURL: cfg.NodeAgentURL, Token: cfg.Token},
		Remote:           worker.New(cfg.NodeAgentURL, cfg.Token),
		Now:              time.Now,
		wake:             make(chan struct{}, 1),
		running:          map[string]bool{},
		capacityAttempts: map[string]int{},
		backoffUntil:     map[string]time.Time{}}, nil
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
	log.Printf("dispatch: loop started (worker=%s lease=%s tick=%s max_parallel=%d max_retries=%d)",
		d.Cfg.WorkerID, d.Cfg.Lease, d.Cfg.Tick, d.Cfg.MaxParallel, d.Cfg.MaxRetries)
	t := time.NewTicker(d.Cfg.Tick)
	defer t.Stop()
	for {
		d.safeTick(ctx)
		select {
		case <-ctx.Done():
			log.Printf("dispatch: loop stopped (%v)", ctx.Err())
			return
		case <-t.C:
		case <-d.wake:
		}
	}
}

// RunReaper periodically reaps expired dispatch leases without auto-claiming
// todo tasks. Used when SWITCHYARD_DISPATCH is not enabled so manual dispatches
// and claims left behind by a killed server PID are still reclaimed promptly.
func (d *Dispatcher) RunReaper(ctx context.Context) {
	log.Printf("dispatch: reaper loop started (worker=%s lease=%s tick=%s; auto-dispatch disabled)",
		d.Cfg.WorkerID, d.Cfg.Lease, d.Cfg.Tick)
	t := time.NewTicker(d.Cfg.Tick)
	defer t.Stop()
	for {
		d.safeReap()
		select {
		case <-ctx.Done():
			log.Printf("dispatch: reaper loop stopped (%v)", ctx.Err())
			return
		case <-t.C:
		}
	}
}

func (d *Dispatcher) safeTick(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("dispatch: recovered panic in Tick: %v", r)
		}
	}()
	if err := d.Tick(ctx); err != nil {
		log.Printf("dispatch: %v", err)
	}
}

func (d *Dispatcher) safeReap() {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("dispatch: recovered panic in ReapExpired: %v", r)
		}
	}()
	if _, err := d.ReapExpired(); err != nil {
		log.Printf("dispatch: reap: %v", err)
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
		if d.inCapacityBackoff(id) {
			continue
		}
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
	ok, _ := d.renewWithErr(taskID, runID)
	return ok
}

func (d *Dispatcher) renewWithErr(taskID, runID string) (bool, error) {
	res, err := d.S.DB.Exec(`UPDATE dispatch_claims SET lease_expires_at=? WHERE task_id=? AND run_id=?`,
		d.Now().Unix()+int64(d.Cfg.Lease.Seconds()), taskID, runID)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

func (d *Dispatcher) renewInterval() time.Duration {
	iv := d.Cfg.Lease / 3
	if iv <= 0 {
		iv = 20 * time.Second
	}
	if iv > 30*time.Second {
		iv = 30 * time.Second
	}
	if iv < 10*time.Millisecond {
		iv = 10 * time.Millisecond
	}
	return iv
}

func (d *Dispatcher) keepLeaseAlive(ctx context.Context, stop <-chan struct{}, cancel context.CancelFunc, taskID, runID string) {
	tick := time.NewTicker(d.renewInterval())
	defer tick.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ctx.Done():
			return
		case <-tick.C:
			ok, err := d.renewWithErr(taskID, runID)
			if err != nil {
				log.Printf("dispatch %s: lease renew error: %v", taskID, err)
				continue
			}
			if !ok {
				select {
				case <-stop:
					return
				default:
				}
				log.Printf("dispatch %s: lease no longer held by %s; stopping run", taskID, runID)
				if cancel != nil {
					cancel()
				}
				return
			}
		}
	}
}

// ReapExpired requeues in_progress tasks whose lease lapsed.
func (d *Dispatcher) ReapExpired() (int, error) {
	rows, err := d.S.DB.Query(`SELECT task_id, worker_id, run_id, lease_expires_at FROM dispatch_claims WHERE lease_expires_at < ?`, d.Now().Unix())
	if err != nil {
		return 0, err
	}
	type expiredClaim struct {
		taskID    string
		workerID  string
		runID     string
		expiresAt int64
	}
	var claims []expiredClaim
	for rows.Next() {
		var c expiredClaim
		_ = rows.Scan(&c.taskID, &c.workerID, &c.runID, &c.expiresAt)
		claims = append(claims, c)
	}
	rows.Close()
	n := 0
	for _, c := range claims {
		if _, err := d.S.DB.Exec(`DELETE FROM dispatch_claims WHERE task_id=?`, c.taskID); err != nil {
			return n, err
		}
		t, err := d.Tasks.Get(c.taskID)
		if err != nil || t.Status != tasks.InProgress {
			status := "missing"
			if err == nil {
				status = t.Status
			}
			log.Printf("dispatch: ReapExpired cleaned stale claim task=%s worker=%s run=%s status=%s", c.taskID, c.workerID, c.runID, status)
			continue
		}
		_, _ = d.Tasks.AddComment(c.taskID, "dispatcher", "lease expired; requeued")
		if _, err := d.Tasks.Move(c.taskID, tasks.Todo, "dispatcher"); err == nil {
			log.Printf("dispatch: ReapExpired reclaimed task=%s worker=%s run=%s expired_at=%d", c.taskID, c.workerID, c.runID, c.expiresAt)
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
	// Keep the claim alive from an independent goroutine for the entire run
	// (worktree prep, local/remote execution, SSE wait, and polling) so long
	// silent tool calls can never starve lease renewal.
	runCtx, cancelRun := context.WithCancel(ctx)
	defer cancelRun()
	stopRenew := make(chan struct{})
	var stopOnce sync.Once
	endRenew := func() { stopOnce.Do(func() { close(stopRenew) }) }
	defer endRenew()
	go d.keepLeaseAlive(runCtx, stopRenew, cancelRun, t.ID, runID)

	wt, transport, err := d.prepareWorktree(runCtx, t)
	if err != nil {
		endRenew()
		if isCapacityError(err, "") {
			d.requeueCapacity(t, runID, "worktree: "+err.Error())
			return
		}
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
	message := AugmentAutonomousPrompt(t.Prompt, t.Workspace, d.workspaceLabels(t.Workspace), t.Paths, t.Skills, t.GrillMe)
	if staged := d.stageTaskContext(runCtx, t, workspace); staged != "" {
		message = staged + "\n" + message
	}
	canon := harnesses.Canonical(t.Executor)
	if canon != "" && t.SessionID != "" {
		// If the task switched harnesses mid-card, inject a cross-harness handoff summary.
		prevHarness := ""
		for h, sid := range t.HarnessSessions {
			if sid == t.SessionID && h != canon {
				prevHarness = h
				break
			}
		}
		if prevHarness != "" {
			if handoff := harnesses.BuildCrossHarnessHandoff(prevHarness, canon, t); handoff != "" && !strings.Contains(message, "[CROSS-HARNESS HANDOFF]") {
				message = handoff + "\n" + message
			}
		}
	}
	if isAgyExecutor(t.Executor) && d.shouldRunAgyLocally(t) {
		d.executeLocalAgy(runCtx, t, boardName, message, workspace, runID)
		return
	}
	effort := t.Effort
	if isAgyExecutor(t.Executor) {
		if norm := NormalizeAgyEffort(t.Effort); norm != "" {
			effort = norm
		}
		d.switchRemoteAgyAccountIfNeeded(runCtx, t, d.taskTargetMachine(t.Workspace), runID)
	}
	req := Request{TaskID: t.ID, Title: t.Title, Board: boardName, Message: message, Workspace: workspace,
		Model: t.Model, Effort: effort, Executor: t.Executor, ExecutionMode: t.ExecutionMode, Acceptance: t.Acceptance,
		AutoApprove: isAgyExecutor(t.Executor),
		Paths:       t.Paths, Skills: t.Skills, Branch: t.Branch,
		RunID: runID, TimeoutS: d.Cfg.TimeoutS}
	applyTaskSession(&req, t)
	if isContinuityHarness(t.Executor) && !isAgyExecutor(t.Executor) {
		boundSID := t.SessionID
		if hs, ok := t.HarnessSessions[canon]; ok && hs != "" {
			boundSID = hs
		} else if len(t.HarnessSessions) > 0 {
			boundSID = ""
		}
		sp := harnesses.BuildSpawnSpec(canon, t.Model, effort, boundSID, workspace, message, d.Cfg.TimeoutS)
		req.Spawn = &sp
	}
	hasRemote := (d.Remote != nil && d.Remote.Enabled()) || (d.Client != nil && strings.TrimSpace(d.Client.BaseURL) != "")
	ack, err := d.Client.DispatchWithAck(runCtx, req)
	if err != nil {
		if isAgyExecutor(t.Executor) && isUnsupportedExecutorErr(err) && hasRemote {
			d.executeRemoteShellAgy(runCtx, t, boardName, message, workspace, runID)
			return
		}
		endRenew()
		if isCapacityError(err, "") {
			d.requeueCapacity(t, runID, err.Error())
			return
		}
		d.failRun(t, runID, err.Error(), nil, false)
		return
	}
	d.clearCapacityBackoff(t.ID)
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
		chunk, nextOff, perr := d.Client.FetchProgress(runCtx, t.ID, logOffset)
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

	// Try SSE event stream first for sub-100ms progress & result delivery; fall back
	// to FetchProgress/FetchResult polling for legacy node-agent servers or test mocks.
	if sres, supported, serr := d.Client.StreamEvents(runCtx, t.ID, logOffset, func(chunk string, nextOff int64) {
		if chunk != "" {
			_ = AppendWorkerLog(d.WorkerLogDir(), t.ID, chunk)
			_ = d.Tasks.RecordEvent(t.ID, "worker_output", map[string]any{
				"run_id": runID,
				"output": chunk,
			})
			streamedBuf.WriteString(chunk)
			streamedBytes += len(chunk)
			if !streamAsked && (strings.Contains(chunk, "[/QUESTION]") || strings.Contains(chunk, "```question") || strings.Contains(chunk, `"question"`)) {
				if q, opts, ctxText, multi, ok := DetectOpenQuestionFull(streamedBuf.String()); ok {
					streamAsked = true
					d.recordDetectedQuestionFull(t, q, opts, ctxText, multi)
				}
			}
		}
		if nextOff > logOffset {
			logOffset = nextOff
		}
		_ = d.renew(t.ID, runID)
	}); supported && serr == nil && sres != nil {
		if !sres.Success && isAgyExecutor(t.Executor) && isUnsupportedExecutorErr(errors.New(sres.Error)) && hasRemote {
			d.executeRemoteShellAgy(runCtx, t, boardName, message, workspace, runID)
			return
		}
		endRenew()
		d.finishWithStream(t, runID, sres, streamedBytes > 0)
		return
	}
	if runCtx.Err() != nil {
		return
	}

	for {
		if !d.renew(t.ID, runID) { // lease lost (reaped/stolen): stop touching the task
			return
		}
		flushProgress()
		res, err := d.Client.FetchResult(runCtx, t.ID)
		if err == nil {
			flushProgress()
			if !res.Success && isAgyExecutor(t.Executor) && isUnsupportedExecutorErr(errors.New(res.Error)) && hasRemote {
				d.executeRemoteShellAgy(runCtx, t, boardName, message, workspace, runID)
				return
			}
			endRenew()
			d.finishWithStream(t, runID, res, streamedBytes > 0)
			return
		}
		if !errors.Is(err, ErrPending) {
			log.Printf("dispatch %s: result: %v", t.ID, err)
		}
		select {
		case <-runCtx.Done():
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
	d.clearCapacityBackoff(t.ID)
	if !streamed && res.Output != "" {
		_ = AppendWorkerLog(d.WorkerLogDir(), t.ID, res.Output)
		_ = d.Tasks.RecordEvent(t.ID, "worker_output", map[string]any{
			"run_id": runID,
			"output": res.Output,
		})
	}
	now := d.Now().Unix()
	usedExec := firstNonEmpty(res.Executor, t.Executor)
	cleanOut, parsedSID := harnesses.UnwrapOutput(usedExec, res.Output)
	if cleanOut == "" {
		cleanOut = res.Output
	}
	sessionID, dshWsID, turnSeq := extractResultSession(usedExec, res)
	if sessionID == "" {
		sessionID = parsedSID
	}
	d.persistTaskSession(t.ID, sessionID, dshWsID, turnSeq)
	if sessionID != "" {
		_ = d.Tasks.SaveHarnessSession(t.ID, harnesses.Canonical(usedExec), sessionID)
	}
	_, _ = d.S.DB.Exec(`UPDATE tasks SET result=?, error_sig='', completed_at=? WHERE id=?`, cleanOut, now, t.ID)
	payload := map[string]any{
		"run_id":      runID,
		"worker_id":   d.Cfg.WorkerID,
		"executor":    usedExec,
		"model":       firstNonEmpty(res.Model, t.Model),
		"session_id":  sessionID,
		"duration_ms": res.DurationMs,
		"output":      trunc(cleanOut, 65536),
	}
	if u := UsageFromJSON(res.Usage, res.Output); u != nil {
		payload["usage"] = u
	}
	_ = d.Tasks.RecordEvent(t.ID, "completed", payload)
	if cleanOut != "" {
		_, _ = d.Tasks.AddComment(t.ID, "worker", cleanOut)
	}
	if q, opts, ctxText, multi, ok := DetectOpenQuestionFull(cleanOut); ok {
		d.recordDetectedQuestionFull(t, q, opts, ctxText, multi)
		_ = d.Tasks.RecordEvent(t.ID, "question.waiting", map[string]any{
			"run_id":   runID,
			"question": q,
		})
		_, _ = d.Tasks.Move(t.ID, tasks.WaitingInput, "dispatcher")
		d.release(t.ID, runID)
		return
	}
	_, _ = d.Tasks.Move(t.ID, tasks.Review, "dispatcher")
	d.release(t.ID, runID)
}

// isCapacityError reports whether an error reflects temporary node-agent
// queue saturation (e.g. HTTP 503 "node queue full") rather than a task failure.
func isCapacityError(err error, rawErr string) bool {
	if errors.Is(err, ErrCapacity) {
		return true
	}
	msg := rawErr
	if msg == "" && err != nil {
		msg = err.Error()
	}
	low := strings.ToLower(strings.TrimSpace(msg))
	if low == "" || isPermanentFailure(low) {
		return false
	}
	for _, needle := range []string{
		"node queue full",
		"queue full",
		"queue is full",
		"node-agent dispatch: 503",
		"node-agent dispatch: 429",
	} {
		if strings.Contains(low, needle) {
			return true
		}
	}
	return false
}

func (d *Dispatcher) nextCapacityBackoff(taskID string) (int, time.Duration) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.capacityAttempts == nil {
		d.capacityAttempts = map[string]int{}
	}
	if d.backoffUntil == nil {
		d.backoffUntil = map[string]time.Time{}
	}
	d.capacityAttempts[taskID]++
	attempt := d.capacityAttempts[taskID]

	base := d.Cfg.CapacityBackoffBase
	if base <= 0 {
		base = defaultCapacityBackoffBase
	}
	maxDelay := d.Cfg.CapacityBackoffMax
	if maxDelay < base {
		maxDelay = base
	}
	delay := base
	for i := 1; i < attempt && delay < maxDelay; i++ {
		delay *= 2
		if delay > maxDelay {
			delay = maxDelay
			break
		}
	}
	d.backoffUntil[taskID] = d.Now().Add(delay)
	return attempt, delay
}

func (d *Dispatcher) clearCapacityBackoff(taskID string) {
	d.mu.Lock()
	delete(d.capacityAttempts, taskID)
	delete(d.backoffUntil, taskID)
	d.mu.Unlock()
}

func (d *Dispatcher) inCapacityBackoff(taskID string) bool {
	d.mu.Lock()
	until, ok := d.backoffUntil[taskID]
	d.mu.Unlock()
	return ok && d.Now().Before(until)
}

// requeueCapacity handles temporary node-agent capacity saturation (e.g. HTTP 503
// "node queue full") without incrementing retry_count or marking the task failed.
func (d *Dispatcher) requeueCapacity(t tasks.Task, runID, rawErr string) {
	if !d.owns(t.ID, runID) {
		return
	}
	attempt, delay := d.nextCapacityBackoff(t.ID)
	reason := strings.TrimSpace(rawErr)
	if reason == "" {
		reason = "node queue full"
	}
	delayStr := delay.Round(time.Second).String()
	if delay < time.Second {
		delayStr = delay.String()
	}
	_ = d.Tasks.RecordEvent(t.ID, "capacity_backoff", map[string]any{
		"run_id":     runID,
		"worker_id":  d.Cfg.WorkerID,
		"executor":   t.Executor,
		"model":      t.Model,
		"error":      reason,
		"attempt":    attempt,
		"backoff_ms": delay.Milliseconds(),
	})
	_, _ = d.Tasks.AddComment(t.ID, "dispatcher",
		fmt.Sprintf("node queue full; backing off %s, will retry (%s)", delayStr, trunc(reason, 200)))
	_, _ = d.Tasks.Move(t.ID, tasks.Todo, "dispatcher")
	d.release(t.ID, runID)
	log.Printf("dispatch %s: %s; backing off %s (attempt %d), requeued to todo", t.ID, reason, delayStr, attempt)
	time.AfterFunc(delay, d.Wake)
}

func (d *Dispatcher) fail(t tasks.Task, runID, reason string) {
	d.failRun(t, runID, reason, nil, false)
}

func (d *Dispatcher) failRun(t tasks.Task, runID, rawErr string, res *Result, streamed bool) {
	if !d.owns(t.ID, runID) {
		return
	}
	if res == nil && isCapacityError(nil, rawErr) {
		d.requeueCapacity(t, runID, rawErr)
		return
	}
	d.clearCapacityBackoff(t.ID)
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
	if q, opts, ctxText, multi, ok := DetectOpenQuestionFull(rawOut); ok {
		d.recordDetectedQuestionFull(t, q, opts, ctxText, multi)
		if sessionID != "" {
			_ = d.Tasks.SaveHarnessSession(t.ID, harnesses.Canonical(firstNonEmpty(executor, t.Executor)), sessionID)
		}
		_, _ = d.Tasks.Move(t.ID, tasks.WaitingInput, "dispatcher")
		d.release(t.ID, runID)
		return
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
	case "dsh", "commandcode", "claude", "omp", "agy", "antigravity":
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
	if kind == "antigravity" {
		kind = "agy"
	}
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
	case "agy":
		req.AgySessionID = t.SessionID
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
	case "agy", "antigravity":
		sessionID = firstNonEmpty(res.AgySessionID, res.SessionID)
	default:
		sessionID = firstNonEmpty(res.DshSessionID, res.SessionID)
		if sessionID == "" {
			sessionID = firstNonEmpty(res.CommandCodeSessionID, res.ClaudeSessionID)
		}
		if sessionID == "" {
			sessionID = firstNonEmpty(res.OMPSessionID, res.AgySessionID)
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
	d.recordDetectedQuestionFull(t, q, opts, ctxText, false)
}

func (d *Dispatcher) recordDetectedQuestionFull(t tasks.Task, q string, opts []string, ctxText string, multi bool) {
	cur, err := d.Tasks.Get(t.ID)
	if err == nil && cur.Question != nil && cur.Question.Status == "pending" && cur.Question.Question == q {
		return
	}
	_, _ = d.Tasks.AskQuestion(t.ID, tasks.AskQuestionInput{
		Question:    q,
		Options:     opts,
		MultiSelect: multi,
		Context:     ctxText,
		Author:      firstNonEmpty(t.Executor, "agent"),
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
	if t.Executor == "" && t.SessionID == "" && t.Status != tasks.WaitingInput && t.Status != tasks.Review && t.Status != tasks.Failed && t.Status != tasks.Blocked && t.Status != tasks.InProgress && t.Status != tasks.Todo {
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
	canRunLocally := isAgyExecutor(t.Executor)
	if inFlight >= d.Cfg.MaxParallel || (!canRunLocally && (d.Client == nil || d.Client.BaseURL == "")) {
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
