package dispatch

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/adityahimaone/switchyard-studio/internal/store"
	"github.com/adityahimaone/switchyard-studio/internal/tasks"
)

type fake struct {
	mu       sync.Mutex
	succeed  bool
	reqs     []Request
	dispatch int32
	srv      *httptest.Server
	onRun    func(Request)
}

func newFake(t *testing.T, succeed bool) *fake {
	f := &fake{succeed: succeed}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Node-Agent-Token") != "tok" {
			w.WriteHeader(401)
			return
		}
		switch {
		case r.Method == "POST" && r.URL.Path == "/api/dispatch":
			var q Request
			_ = json.NewDecoder(r.Body).Decode(&q)
			atomic.AddInt32(&f.dispatch, 1)
			f.mu.Lock()
			f.reqs = append(f.reqs, q)
			f.mu.Unlock()
			if f.onRun != nil {
				f.onRun(q)
			}
			w.WriteHeader(202)
		case strings.HasPrefix(r.URL.Path, "/api/results/"):
			id := strings.TrimPrefix(r.URL.Path, "/api/results/")
			f.mu.Lock()
			n := len(f.reqs)
			f.mu.Unlock()
			if n == 0 {
				w.WriteHeader(404)
				return
			}
			res := Result{TaskID: id, Success: f.succeed, Output: "done"}
			if !f.succeed {
				res.Error = "boom"
			}
			_ = json.NewEncoder(w).Encode(res)
		}
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func setup(t *testing.T, f *fake) (*Dispatcher, tasks.Task) {
	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	d, err := New(s, Config{NodeAgentURL: f.srv.URL, Token: "tok", Poll: 10 * time.Millisecond, Lease: time.Minute, MaxRetries: 1})
	if err != nil {
		t.Fatal(err)
	}
	d.LogDir = t.TempDir()
	b, _ := d.Tasks.CreateBoard("b")
	tk, err := d.Tasks.Create(tasks.NewTask{BoardID: b.ID, Title: "t", Prompt: "do it", Workspace: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if tk.Status != tasks.Todo {
		_, err = d.Tasks.Move(tk.ID, tasks.Todo, "t")
		if err != nil {
			t.Fatal(err)
		}
	}
	return d, tk
}

func TestClaimRace(t *testing.T) {
	d, tk := setup(t, newFake(t, true))
	var wins int32
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if ok, _ := d.Claim(tk.ID, "run"+string(rune('a'+i))); ok {
				atomic.AddInt32(&wins, 1)
			}
		}(i)
	}
	wg.Wait()
	if wins != 1 {
		t.Fatalf("wins=%d want 1", wins)
	}
}

func TestLeaseExpiryReapsAndReclaims(t *testing.T) {
	d, tk := setup(t, newFake(t, true))
	if ok, _ := d.Claim(tk.ID, "r1"); !ok {
		t.Fatal("claim")
	}
	if _, err := d.Tasks.Move(tk.ID, tasks.InProgress, "x"); err != nil {
		t.Fatal(err)
	}
	d.Now = func() time.Time { return time.Now().Add(2 * time.Minute) }
	n, err := d.ReapExpired()
	if err != nil || n != 1 {
		t.Fatalf("reap n=%d err=%v", n, err)
	}
	got, _ := d.Tasks.Get(tk.ID)
	if got.Status != tasks.Todo {
		t.Fatalf("status %s", got.Status)
	}
	if ok, _ := d.Claim(tk.ID, "r2"); !ok {
		t.Fatal("reclaim after expiry")
	}
}

func TestStealExpiredLease(t *testing.T) {
	d, tk := setup(t, newFake(t, true))
	_, _ = d.Claim(tk.ID, "r1")
	if ok, _ := d.Claim(tk.ID, "r2"); ok {
		t.Fatal("live lease must not be stolen")
	}
	d.Now = func() time.Time { return time.Now().Add(2 * time.Minute) }
	if ok, _ := d.Claim(tk.ID, "r2"); !ok {
		t.Fatal("expired lease should be stealable")
	}
}

func TestSuccessGoesToReview(t *testing.T) {
	f := newFake(t, true)
	d, tk := setup(t, f)
	if _, err := d.Start(context.Background(), tk.ID); err != nil {
		t.Fatal(err)
	}
	d.Wait()
	got, _ := d.Tasks.Get(tk.ID)
	if got.Status != tasks.Review {
		t.Fatalf("status %s", got.Status)
	}
	if f.reqs[0].Workspace != tk.Workspace || f.reqs[0].TaskID != tk.ID {
		t.Fatalf("req %+v", f.reqs[0])
	}
}

func TestFailureRetriesThenFails(t *testing.T) {
	f := newFake(t, false)
	d, tk := setup(t, f)
	for i := 0; i < 2; i++ {
		if _, err := d.Start(context.Background(), tk.ID); err != nil {
			t.Fatal(err)
		}
		d.Wait()
		got, _ := d.Tasks.Get(tk.ID)
		want := tasks.Todo
		if i == 1 {
			want = tasks.Failed
		}
		if got.Status != want || got.RetryCount != i+1 {
			t.Fatalf("attempt %d: status=%s retries=%d", i, got.Status, got.RetryCount)
		}
	}
}

func TestNonGitSkipsWorktree(t *testing.T) {
	if IsGit(t.TempDir()) {
		t.Fatal("tempdir is not git")
	}
}

func TestExtractFailureReasonDshQuota(t *testing.T) {
	dshOutput := strings.Join([]string{
		`{"type":"turn_start","turn":1,"model":"alicn/deepseek-v4.1-flash-1017"}`,
		`{"type":"turn_end","turn":1,"error":{"code":"QUOTA","source":"inferhub","status":402,"message":"balance too low for this request — deposit USDC to continue"}}`,
		`{"type":"final","status":"error","error":"balance too low for this request — deposit USDC to continue"}`,
	}, "\n")
	reason, permanent := ExtractFailureReason("exit status 1", dshOutput)
	if !permanent {
		t.Fatalf("expected permanent=true, got false (reason=%q)", reason)
	}
	if !strings.Contains(strings.ToLower(reason), "balance too low") {
		t.Fatalf("unexpected reason: %q", reason)
	}
}

func TestWorkerLogTailIncrementalAndReset(t *testing.T) {
	dir := t.TempDir()
	if err := AppendWorkerLog(dir, "t_1", "line 1\n"); err != nil {
		t.Fatal(err)
	}
	text, off, err := WorkerLogTail(dir, "t_1", 0)
	if err != nil || text != "line 1\n" || off != 7 {
		t.Fatalf("tail1: text=%q off=%d err=%v", text, off, err)
	}
	if err := AppendWorkerLog(dir, "t_1", "line 2\n"); err != nil {
		t.Fatal(err)
	}
	text2, off2, err := WorkerLogTail(dir, "t_1", off)
	if err != nil || text2 != "line 2\n" || off2 != 14 {
		t.Fatalf("tail2: text=%q off=%d err=%v", text2, off2, err)
	}
	if err := ResetWorkerLog(dir, "t_1"); err != nil {
		t.Fatal(err)
	}
	text3, off3, err := WorkerLogTail(dir, "t_1", off2)
	if err != nil || text3 != "" || off3 != 0 {
		t.Fatalf("tail after reset: text=%q off=%d err=%v", text3, off3, err)
	}
}

func TestProgressPollingAndHardQuotaFailsImmediately(t *testing.T) {
	dshOutput := `{"type":"turn_start","turn":1,"model":"alicn/deepseek-v4.1-flash-1017"}` + "\n" +
		`{"type":"turn_end","turn":1,"error":{"code":"QUOTA","source":"inferhub","status":402,"message":"balance too low for this request — deposit USDC to continue"}}` + "\n"

	var progressHits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "POST" && r.URL.Path == "/api/dispatch":
			w.WriteHeader(202)
			_, _ = w.Write([]byte(`{"accepted":true,"executor":"dsh","model":"alicn/deepseek-v4.1-flash-1017"}`))
		case strings.HasPrefix(r.URL.Path, "/api/progress/"):
			n := atomic.AddInt32(&progressHits, 1)
			offStr := r.URL.Query().Get("offset")
			if n == 1 || offStr == "0" || offStr == "" {
				_ = json.NewEncoder(w).Encode(ProgressChunk{Text: dshOutput[:40], Offset: 40})
			} else if offStr == "40" {
				_ = json.NewEncoder(w).Encode(ProgressChunk{Text: dshOutput[40:], Offset: int64(len(dshOutput))})
			} else {
				_ = json.NewEncoder(w).Encode(ProgressChunk{Text: "", Offset: int64(len(dshOutput))})
			}
		case strings.HasPrefix(r.URL.Path, "/api/results/"):
			if atomic.LoadInt32(&progressHits) < 2 {
				w.WriteHeader(202)
				return
			}
			_ = json.NewEncoder(w).Encode(Result{
				TaskID:       "t_quota",
				Success:      false,
				Error:        "exit status 1",
				Output:       dshOutput,
				DurationMs:   10397,
				DshSessionID: "session-c1f8aa59",
			})
		}
	}))
	t.Cleanup(srv.Close)

	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	d, err := New(s, Config{NodeAgentURL: srv.URL, Token: "tok", Poll: 5 * time.Millisecond, Lease: time.Minute, MaxRetries: 3})
	if err != nil {
		t.Fatal(err)
	}
	d.LogDir = t.TempDir()
	b, _ := d.Tasks.CreateBoard("b")
	tk, err := d.Tasks.Create(tasks.NewTask{BoardID: b.ID, Title: "Git Pull", Prompt: "git pull", Workspace: t.TempDir(), Executor: "dsh"})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := d.Start(context.Background(), tk.ID); err != nil {
		t.Fatal(err)
	}
	d.Wait()

	got, err := d.Tasks.Get(tk.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != tasks.Failed {
		t.Fatalf("expected permanent quota error to move immediately to failed, got %s (error_sig=%q)", got.Status, got.ErrorSig)
	}
	if !strings.Contains(strings.ToLower(got.ErrorSig), "balance too low") {
		t.Fatalf("expected extracted error_sig, got %q", got.ErrorSig)
	}
	if got.Result != dshOutput {
		t.Fatalf("expected persisted result, got %q", got.Result)
	}

	logText, _, err := WorkerLogTail(d.WorkerLogDir(), tk.ID, 0)
	if err != nil || logText != dshOutput {
		t.Fatalf("worker log mismatch: %q (err=%v)", logText, err)
	}

	evs, err := d.Tasks.Events(tk.ID, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	runs := GroupTaskRuns(evs)
	if len(runs) != 1 {
		t.Fatalf("expected 1 run, got %d (%+v)", len(runs), runs)
	}
	if runs[0].Status != "failed" || runs[0].SessionID != "session-c1f8aa59" || runs[0].Executor != "dsh" {
		t.Fatalf("unexpected run summary: %+v", runs[0])
	}
	if runs[0].Usage == nil || runs[0].Usage.Turns != 1 {
		t.Fatalf("expected turns=1 from dsh output, got %+v", runs[0].Usage)
	}
}

func TestHermesLiveWireFormatExtractionAndRuns(t *testing.T) {
	liveLog := strings.Join([]string{
		`HERMES_EVENT: {"label":"Starting remote agent","phase":"job_started"}`,
		`HERMES_EVENT: {"label":"Resolved executor: dsh","phase":"executor_resolved"}`,
		`{"type":"session","sessionId":"session-a5f221e3-8f2c-48c7-9302-c814c1787af3","cwd":"/repo"}`,
		`{"type":"status","phase":"turn_start","turn":1}`,
		`{"type":"status","phase":"step_start","turn":1,"step":1}`,
		`{"type":"status","phase":"step_end","turn":1,"step":1,"usage":{"inputTokens":12,"outputTokens":4,"totalTokens":16}}`,
		`{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"error","error":{"message":"503: {\"message\":\"[openai-compatible-chat-1f51ef20-4a6b-4643-904b-566ba2645fd7/alicn/deepseek-v4.1-flash-1017] [402]: {\\\"error\\\":{\\\"message\\\":\\\"balance too low for this request — deposit USDC to continue\\\",\\\"type\\\":\\\"insufficient_balance\\\",\\\"source\\\":\\\"inferhub\\\"}}\\n (reset after 2m)\"}","code":"QUOTA"}}}`,
		`{"type":"final","sessionId":"session-a5f221e3-8f2c-48c7-9302-c814c1787af3","reason":{"kind":"error","error":{"message":"503: {\"message\":\"[openai-compatible-chat-1f51ef20-4a6b-4643-904b-566ba2645fd7/alicn/deepseek-v4.1-flash-1017] [402]: {\\\"error\\\":{\\\"message\\\":\\\"balance too low for this request — deposit USDC to continue\\\",\\\"type\\\":\\\"insufficient_balance\\\",\\\"source\\\":\\\"inferhub\\\"}}\\n (reset after 2m)\"}","code":"QUOTA"}},"text":""}`,
		`dsh: QUOTA: 503: {"message":"[openai-compatible-chat-1f51ef20-4a6b-4643-904b-566ba2645fd7/alicn/deepseek-v4.1-flash-1017] [402]: {\"error\":{\"message\":\"balance too low for this request — deposit USDC to continue\",\"type\":\"insufficient_balance\",\"source\":\"inferhub\"}}\n (reset after 2m)"}`,
		`HERMES_EVENT: {"label":"Agent process finished","phase":"process_exited"}`,
	}, "\n")

	rawErr := `dsh: QUOTA: 503: {"message":"[openai-compatible-chat-1f51ef20-4a6b-4643-904b-566ba2645fd7/alicn/deepseek-v4.1-flash-1017] [402]: {\"error\":{\"message\":\"balance too low for this request — deposit USDC to continue\"}}"}`
	reason, perm := ExtractFailureReason(rawErr, liveLog)
	if !perm {
		t.Fatalf("expected permanent=true")
	}
	if strings.Contains(reason, `{\"error\"`) {
		t.Fatalf("expected clean unwrapped error without escaped JSON, got %q", reason)
	}
	for _, want := range []string{"QUOTA", "402", "inferhub", "balance too low"} {
		if !strings.Contains(reason, want) {
			t.Fatalf("reason %q missing %q", reason, want)
		}
	}

	evs := []tasks.Event{
		{ID: 1, Kind: "task.moved", CreatedAt: 100, Payload: json.RawMessage(`{"from":"todo","to":"in_progress"}`)},
		{ID: 2, Kind: "task.moved", CreatedAt: 137, Payload: json.RawMessage(`{"from":"in_progress","to":"todo"}`)},
		{ID: 3, Kind: "claimed", CreatedAt: 200, Payload: json.RawMessage(`{"run_id":"r2","executor":"dsh","model":"adit-9router/cheap"}`)},
		{ID: 4, Kind: "worker_output", CreatedAt: 205, Payload: json.RawMessage(`{"output":` + mustJSONString(liveLog) + `}`)},
		{ID: 5, Kind: "failed", CreatedAt: 208, Payload: json.RawMessage(`{"error":` + mustJSONString(reason) + `,"duration_ms":8135}`)},
	}
	runs := GroupTaskRuns(evs)
	if len(runs) != 2 {
		t.Fatalf("expected 2 runs, got %d", len(runs))
	}
	if runs[0].Status != "failed" || runs[0].DurationS != 37 {
		t.Fatalf("expected requeued run #1 to be failed (37s), got %+v", runs[0])
	}
	if runs[1].SessionID != "session-a5f221e3-8f2c-48c7-9302-c814c1787af3" {
		t.Fatalf("expected sessionId extracted from worker_output, got %q", runs[1].SessionID)
	}
	if runs[1].Usage == nil || runs[1].Usage.Turns != 1 || runs[1].Usage.TotalTokens != 16 {
		t.Fatalf("unexpected camelCase usage: %+v", runs[1].Usage)
	}
}

func mustJSONString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func TestNormalizeAgyEffortAndBuildArgs(t *testing.T) {
	effCases := map[string]string{
		"":        "",
		"minimal": "low",
		"MINIMAL": "low",
		"low":     "low",
		"medium":  "medium",
		"high":    "high",
		"xhigh":   "xhigh",
		"max":     "max",
		"invalid": "",
	}
	for in, want := range effCases {
		if got := NormalizeAgyEffort(in); got != want {
			t.Errorf("NormalizeAgyEffort(%q) = %q, want %q", in, got, want)
		}
	}

	task := tasks.Task{
		Model:     "gemini-4-neon-high",
		Effort:    "minimal",
		SessionID: "conv-abc-123",
	}
	args := BuildAgyArgs(task, "/tmp/ws", "-lead dash prompt", 120)
	for _, wantFlag := range []string{"-p", "--dangerously-skip-permissions", "--mode", "auto", "--model", "gemini-4-neon-high", "--effort", "low", "--conversation", "conv-abc-123", "--add-dir", "/tmp/ws", "--print-timeout", "120s"} {
		if !slices.Contains(args, wantFlag) {
			t.Fatalf("expected arg %q in %v", wantFlag, args)
		}
	}
	last := args[len(args)-1]
	if !strings.HasPrefix(last, "Task:\n-lead dash prompt") {
		t.Fatalf("expected dashed prompt guard, got %q", last)
	}
}

func TestAgyLocalExecutionAuthAndGrillMeResume(t *testing.T) {
	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	// Seed preferred agy account in dispatch_settings.
	_, err = s.DB.Exec(`INSERT INTO dispatch_settings(key,value) VALUES('agy.active_account','work@example.com')`)
	if err != nil {
		t.Fatal(err)
	}

	svc := tasks.New(s)
	board, err := svc.CreateBoard("AGY")
	if err != nil {
		t.Fatal(err)
	}
	task, err := svc.Create(tasks.NewTask{
		BoardID:       board.ID,
		Title:         "Implement agy feature",
		Prompt:        "Build the feature",
		Executor:      "agy",
		Model:         "gemini-4-neon-xhigh",
		Effort:        "max",
		Workspace:     "",
		ExecutionMode: tasks.ExecManaged,
	})
	if err != nil {
		t.Fatal(err)
	}

	var mu sync.Mutex
	var authCalls [][]string
	var execRuns []AgyExecInput
	turn := 0

	d, err := New(s, Config{WorkerID: "w-agy", Lease: time.Minute, MaxParallel: 2, TimeoutS: 90})
	if err != nil {
		t.Fatal(err)
	}
	d.AgyAuthRunner = func(ctx context.Context, args ...string) ([]byte, error) {
		mu.Lock()
		authCalls = append(authCalls, append([]string(nil), args...))
		mu.Unlock()
		return []byte("Switched"), nil
	}
	d.AgyRunner = func(ctx context.Context, in AgyExecInput, onChunk func(string)) (AgyExecResult, error) {
		mu.Lock()
		turn++
		curTurn := turn
		execRuns = append(execRuns, in)
		mu.Unlock()

		if curTurn == 1 {
			onChunk(`{"conversation_id":"agy_conv_777","text":"Scanning codebase..."}` + "\n")
			onChunk(`{"tool":"ask_question","args":{"questions":[{"question":"Which DB engine?","options":["SQLite","Postgres"]}]}}` + "\n")
			return AgyExecResult{
				Success:    true,
				SessionID:  "agy_conv_777",
				DurationMs: 120,
			}, nil
		}
		onChunk(`{"conversation_id":"agy_conv_777","result":"Implemented using SQLite."}` + "\n")
		return AgyExecResult{
			Success:    true,
			Output:     "Implemented using SQLite.",
			SessionID:  "agy_conv_777",
			DurationMs: 85,
		}, nil
	}

	if _, err := d.Start(context.Background(), task.ID); err != nil {
		t.Fatalf("Start turn 1: %v", err)
	}
	d.Wait()

	// Check turn 1 state: question detected, session stored, auto-approve + max effort passed, agy-auth switched.
	afterTurn1, err := svc.Get(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if afterTurn1.SessionID != "agy_conv_777" {
		t.Fatalf("expected persisted agy conversation id agy_conv_777, got %q", afterTurn1.SessionID)
	}
	if afterTurn1.Question == nil || afterTurn1.Question.Question != "Which DB engine?" || afterTurn1.Question.Status != "pending" {
		t.Fatalf("expected pending open question after turn 1, got %+v", afterTurn1.Question)
	}

	// Answer the open question and resume without NODE_AGENT_URL configured.
	_, _, err = svc.AnswerQuestion(task.ID, tasks.AnswerQuestionInput{
		QuestionID:      afterTurn1.Question.ID,
		SelectedOptions: []string{"SQLite"},
		Author:          "user",
	})
	if err != nil {
		t.Fatal(err)
	}
	runID2, resumed, err := d.ResumeWithAnswer(context.Background(), task.ID, *afterTurn1.Question, "SQLite")
	if err != nil || !resumed || runID2 == "" {
		t.Fatalf("ResumeWithAnswer turn 2 failed: runID=%q resumed=%v err=%v", runID2, resumed, err)
	}
	d.Wait()

	mu.Lock()
	defer mu.Unlock()
	if len(authCalls) < 2 || !slices.Equal(authCalls[0], []string{"switch", "work@example.com"}) {
		t.Fatalf("expected agy-auth switch calls, got %+v", authCalls)
	}
	if len(execRuns) != 2 {
		t.Fatalf("expected 2 agy executions, got %d", len(execRuns))
	}
	if !slices.Contains(execRuns[0].Args, "--dangerously-skip-permissions") || !slices.Contains(execRuns[0].Args, "--mode") {
		t.Fatalf("turn 1 missing auto-approve flags: %v", execRuns[0].Args)
	}
	if !slices.Contains(execRuns[0].Args, "--effort") || !slices.Contains(execRuns[0].Args, "max") {
		t.Fatalf("turn 1 missing --effort max: %v", execRuns[0].Args)
	}
	if !slices.Contains(execRuns[1].Args, "--conversation") || !slices.Contains(execRuns[1].Args, "agy_conv_777") {
		t.Fatalf("turn 2 missing --conversation agy_conv_777: %v", execRuns[1].Args)
	}

	afterTurn2, err := svc.Get(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if afterTurn2.Status != tasks.Review {
		t.Fatalf("expected task in review after turn 2, got %s", afterTurn2.Status)
	}
}

func TestAgyRemoteFallbackOnNodeAgent409Unavailable(t *testing.T) {
	var mu sync.Mutex
	var sawAgy409 bool
	var shellReq Request
	results := map[string]Result{}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Node-Agent-Token") != "tok" {
			w.WriteHeader(401)
			return
		}
		switch {
		case r.Method == "POST" && r.URL.Path == "/api/dispatch":
			var q Request
			_ = json.NewDecoder(r.Body).Decode(&q)
			if q.Executor == "agy" {
				mu.Lock()
				sawAgy409 = true
				mu.Unlock()
				http.Error(w, "executor unavailable on node(s) owning workspace: agy", http.StatusConflict)
				return
			}
			if q.Executor == "shell" && strings.HasPrefix(q.TaskID, "syprobe-") {
				mu.Lock()
				results[q.TaskID] = Result{TaskID: q.TaskID, Success: false, Error: "not a git repo"}
				mu.Unlock()
				w.WriteHeader(200)
				_, _ = w.Write([]byte(`{"status":"queued"}`))
				return
			}
			if q.Executor == "shell" {
				mu.Lock()
				shellReq = q
				results[q.TaskID] = Result{
					TaskID:  q.TaskID,
					Success: true,
					Output: "provenance executor=shell requested=shell bin=/bin/bash ws=/remote/linux/repo\n" +
						`{"conversation_id":"agy_conv_remote_99","result":"Remote shell agy complete."}` + "\n" +
						"EXECUTOR_PROOF=shell\n",
					DurationMs: 42,
				}
				mu.Unlock()
				w.WriteHeader(200)
				_, _ = w.Write([]byte(`{"status":"queued","transport":"http"}`))
				return
			}
			http.Error(w, "unexpected request", 400)
		case strings.HasPrefix(r.URL.Path, "/api/progress/"):
			id := strings.TrimPrefix(r.URL.Path, "/api/progress/")
			mu.Lock()
			_, ok := results[id]
			mu.Unlock()
			if !ok {
				w.WriteHeader(404)
				return
			}
			off := r.URL.Query().Get("offset")
			if off == "0" || off == "" {
				chunk := `{"conversation_id":"agy_conv_remote_99","text":"Scanning remote repo..."}` + "\n"
				_ = json.NewEncoder(w).Encode(ProgressChunk{Text: chunk, Offset: int64(len(chunk))})
				return
			}
			_ = json.NewEncoder(w).Encode(ProgressChunk{Text: "", Offset: 64})
		case strings.HasPrefix(r.URL.Path, "/api/results/"):
			id := strings.TrimPrefix(r.URL.Path, "/api/results/")
			mu.Lock()
			res, ok := results[id]
			mu.Unlock()
			if !ok {
				w.WriteHeader(404)
				return
			}
			_ = json.NewEncoder(w).Encode(res)
		}
	}))
	defer srv.Close()

	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	d, err := New(s, Config{
		NodeAgentURL: srv.URL,
		Token:        "tok",
		WorkerID:     "w-remote-agy",
		Lease:        time.Minute,
		Poll:         5 * time.Millisecond,
		MaxParallel:  2,
		TimeoutS:     180,
	})
	if err != nil {
		t.Fatal(err)
	}
	d.LogDir = t.TempDir()
	d.Remote.Poll = 5 * time.Millisecond
	d.Remote.Wait = 2 * time.Second

	b, err := d.Tasks.CreateBoard("RemoteAGY")
	if err != nil {
		t.Fatal(err)
	}
	tk, err := d.Tasks.Create(tasks.NewTask{
		BoardID:       b.ID,
		Title:         "Run agy on remote VPS without node-agent upgrade",
		Prompt:        "Inspect remote service",
		Executor:      "agy",
		Model:         "gemini-4-neon-xhigh",
		Effort:        "max",
		Workspace:     "/remote/linux/repo",
		ExecutionMode: tasks.ExecManaged,
	})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := d.Start(context.Background(), tk.ID); err != nil {
		t.Fatalf("Start: %v", err)
	}
	d.Wait()

	mu.Lock()
	got409 := sawAgy409
	gotShell := shellReq
	mu.Unlock()
	if !got409 {
		t.Fatalf("expected initial agy dispatch to hit node-agent 409")
	}
	if gotShell.Executor != "shell" || !gotShell.NoRTK || gotShell.ExecutionMode != "direct" || gotShell.TimeoutS != 180 {
		t.Fatalf("unexpected shell fallback request: %+v", gotShell)
	}
	if !strings.Contains(gotShell.Command, "agy") || !strings.Contains(gotShell.Command, "--dangerously-skip-permissions") || !strings.Contains(gotShell.Command, "--effort") {
		t.Fatalf("shell command missing agy CLI args: %q", gotShell.Command)
	}

	gotTask, err := d.Tasks.Get(tk.ID)
	if err != nil {
		t.Fatal(err)
	}
	if gotTask.Status != tasks.Review {
		t.Fatalf("expected task status review, got %s (error_sig=%q)", gotTask.Status, gotTask.ErrorSig)
	}
	if gotTask.SessionID != "agy_conv_remote_99" {
		t.Fatalf("expected persisted session_id agy_conv_remote_99, got %q", gotTask.SessionID)
	}
	if strings.Contains(gotTask.Result, "EXECUTOR_PROOF") || strings.Contains(gotTask.Result, "provenance executor=") {
		t.Fatalf("expected provenance stripped from task result, got %q", gotTask.Result)
	}
}

func TestLeaseDefaultsAndConfiguration(t *testing.T) {
	t.Setenv("SWITCHYARD_DISPATCH_LEASE", "")
	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	dDefault, err := New(s, Config{})
	if err != nil {
		t.Fatal(err)
	}
	if dDefault.Cfg.Lease < 5*time.Minute {
		t.Fatalf("expected default lease >= 5m, got %s", dDefault.Cfg.Lease)
	}

	// dispatch_settings override when Config.Lease is unset.
	if _, err := s.DB.Exec(`INSERT INTO dispatch_settings(key,value) VALUES('dispatch.lease','8m')`); err != nil {
		t.Fatal(err)
	}
	dFromDB, err := New(s, Config{})
	if err != nil {
		t.Fatal(err)
	}
	if dFromDB.Cfg.Lease != 8*time.Minute {
		t.Fatalf("expected lease 8m from dispatch_settings, got %s", dFromDB.Cfg.Lease)
	}

	// Environment variable override takes precedence over dispatch_settings.
	t.Setenv("SWITCHYARD_DISPATCH_LEASE", "600")
	cfgEnv := ConfigFromEnv()
	if cfgEnv.Lease != 10*time.Minute {
		t.Fatalf("expected 10m from SWITCHYARD_DISPATCH_LEASE=600, got %s", cfgEnv.Lease)
	}
	dFromEnv, err := New(s, cfgEnv)
	if err != nil {
		t.Fatal(err)
	}
	if dFromEnv.Cfg.Lease != 10*time.Minute {
		t.Fatalf("expected lease 10m from env, got %s", dFromEnv.Cfg.Lease)
	}
}

func TestIndependentLeaseRenewalSurvivesLongSilentToolCall(t *testing.T) {
	unblock := make(chan struct{})
	sseConnected := make(chan struct{}, 1)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/dispatch":
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"accepted":true}`))
		case strings.HasPrefix(r.URL.Path, "/api/events/"):
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(http.StatusOK)
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
			select {
			case sseConnected <- struct{}{}:
			default:
			}
			// Simulate a silent long-running tool call exceeding the 1s lease.
			select {
			case <-unblock:
			case <-r.Context().Done():
				return
			}
			id := strings.TrimPrefix(r.URL.Path, "/api/events/")
			b, _ := json.Marshal(Result{TaskID: id, Success: true, Output: "grep finished"})
			_, _ = w.Write([]byte("event: result\ndata: " + string(b) + "\n\n"))
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	d, err := New(s, Config{
		NodeAgentURL: srv.URL,
		Lease:        1 * time.Second,
		Poll:         20 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	d.LogDir = t.TempDir()
	b, _ := d.Tasks.CreateBoard("b")
	tk, err := d.Tasks.Create(tasks.NewTask{BoardID: b.ID, Title: "slow grep", Prompt: "search tree", Workspace: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := d.Start(context.Background(), tk.ID); err != nil {
		t.Fatal(err)
	}
	<-sseConnected

	var initialExp int64
	if err := s.DB.QueryRow(`SELECT lease_expires_at FROM dispatch_claims WHERE task_id=?`, tk.ID).Scan(&initialExp); err != nil {
		t.Fatalf("read initial claim: %v", err)
	}

	// Wait longer than the 1s lease with zero SSE events emitted.
	time.Sleep(1500 * time.Millisecond)

	var renewedExp int64
	if err := s.DB.QueryRow(`SELECT lease_expires_at FROM dispatch_claims WHERE task_id=?`, tk.ID).Scan(&renewedExp); err != nil {
		t.Fatalf("read renewed claim: %v", err)
	}
	if renewedExp <= initialExp {
		t.Fatalf("expected background goroutine to renew lease: initial=%d renewed=%d", initialExp, renewedExp)
	}
	if n, err := d.ReapExpired(); err != nil || n != 0 {
		t.Fatalf("active run should not be reaped: n=%d err=%v", n, err)
	}

	close(unblock)
	d.Wait()

	got, err := d.Tasks.Get(tk.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != tasks.Review {
		t.Fatalf("expected review after long silent call, got %s", got.Status)
	}
}

func TestNodeQueueFull503BacksOffAndDoesNotFail(t *testing.T) {
	var attempts int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/dispatch":
			n := atomic.AddInt32(&attempts, 1)
			if n <= 4 {
				http.Error(w, "node queue full", http.StatusServiceUnavailable)
				return
			}
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"accepted":true}`))
		case strings.HasPrefix(r.URL.Path, "/api/events/"):
			w.WriteHeader(http.StatusNotFound)
		case strings.HasPrefix(r.URL.Path, "/api/progress/"):
			w.WriteHeader(http.StatusNoContent)
		case strings.HasPrefix(r.URL.Path, "/api/results/"):
			id := strings.TrimPrefix(r.URL.Path, "/api/results/")
			_ = json.NewEncoder(w).Encode(Result{TaskID: id, Success: true, Output: "completed after backoff"})
		}
	}))
	defer srv.Close()

	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	var nowMu sync.Mutex
	curNow := time.Now()
	d, err := New(s, Config{
		NodeAgentURL:        srv.URL,
		Poll:                5 * time.Millisecond,
		Lease:               time.Minute,
		MaxRetries:          1, // Ordinary failures would mark Failed after 2 tries.
		CapacityBackoffBase: 5 * time.Second,
		CapacityBackoffMax:  30 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	d.Now = func() time.Time {
		nowMu.Lock()
		defer nowMu.Unlock()
		return curNow
	}
	d.LogDir = t.TempDir()

	b, _ := d.Tasks.CreateBoard("b")
	tk, err := d.Tasks.Create(tasks.NewTask{BoardID: b.ID, Title: "burst", Prompt: "run", Workspace: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}

	wantDelays := []time.Duration{5 * time.Second, 10 * time.Second, 20 * time.Second, 30 * time.Second}
	for i, wantDelay := range wantDelays {
		if err := d.Tick(context.Background()); err != nil {
			t.Fatalf("tick %d: %v", i, err)
		}
		d.Wait()

		got, err := d.Tasks.Get(tk.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got.Status != tasks.Todo {
			t.Fatalf("attempt %d: expected status todo on 503, got %s", i+1, got.Status)
		}
		if got.RetryCount != 0 {
			t.Fatalf("attempt %d: 503 must not increment retry_count, got %d", i+1, got.RetryCount)
		}

		// Tick immediately while inside backoff must skip the task.
		before := atomic.LoadInt32(&attempts)
		if err := d.Tick(context.Background()); err != nil {
			t.Fatal(err)
		}
		d.Wait()
		if after := atomic.LoadInt32(&attempts); after != before {
			t.Fatalf("attempt %d: task dispatched during backoff window (%d -> %d)", i+1, before, after)
		}

		// Verify exponential backoff boundary: advance just short of wantDelay -> still skipped.
		nowMu.Lock()
		curNow = curNow.Add(wantDelay - time.Second)
		nowMu.Unlock()
		if err := d.Tick(context.Background()); err != nil {
			t.Fatal(err)
		}
		d.Wait()
		if after := atomic.LoadInt32(&attempts); after != before {
			t.Fatalf("attempt %d: task dispatched before %s backoff elapsed", i+1, wantDelay)
		}

		// Advance past backoff window for next iteration.
		nowMu.Lock()
		curNow = curNow.Add(2 * time.Second)
		nowMu.Unlock()
	}

	// Verify dispatcher comment explains queue-full backoff instead of generic "attempt failed".
	comments, err := d.Tasks.Comments(tk.ID)
	if err != nil || len(comments) == 0 {
		t.Fatalf("expected dispatcher comments, got %d err=%v", len(comments), err)
	}
	for _, c := range comments {
		if strings.Contains(c.Body, "attempt failed") {
			t.Fatalf("expected capacity backoff comment, got %q", c.Body)
		}
		if !strings.Contains(strings.ToLower(c.Body), "node queue full") || !strings.Contains(strings.ToLower(c.Body), "backing off") {
			t.Fatalf("unexpected capacity comment: %q", c.Body)
		}
	}

	// 5th attempt succeeds and moves task to Review.
	if err := d.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	d.Wait()
	got, err := d.Tasks.Get(tk.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != tasks.Review || got.RetryCount != 0 {
		t.Fatalf("expected review with retry_count=0 after recovery, got status=%s retries=%d", got.Status, got.RetryCount)
	}
}

func TestManualMoveReleasesClaimCancelsRunAndReaperReclaimsDeadPID(t *testing.T) {
	sseConnected := make(chan struct{}, 1)
	sseCanceled := make(chan struct{}, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/dispatch":
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"accepted":true}`))
		case strings.HasPrefix(r.URL.Path, "/api/events/"):
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(http.StatusOK)
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
			select {
			case sseConnected <- struct{}{}:
			default:
			}
			<-r.Context().Done()
			select {
			case sseCanceled <- struct{}{}:
			default:
			}
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	d, err := New(s, Config{
		NodeAgentURL: srv.URL,
		Lease:        90 * time.Millisecond, // renewInterval = 30ms
		Poll:         10 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	d.LogDir = t.TempDir()
	b, _ := d.Tasks.CreateBoard("b")
	tk, err := d.Tasks.Create(tasks.NewTask{BoardID: b.ID, Title: "stop me", Prompt: "work", Workspace: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := d.Start(context.Background(), tk.ID); err != nil {
		t.Fatal(err)
	}
	<-sseConnected

	// Manually move task to Failed via Service.Move (API path).
	if _, err := d.Tasks.Move(tk.ID, tasks.Failed, "api"); err != nil {
		t.Fatal(err)
	}
	var claims int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM dispatch_claims WHERE task_id=?`, tk.ID).Scan(&claims); err != nil {
		t.Fatal(err)
	}
	if claims != 0 {
		t.Fatalf("expected Move to failed to delete dispatch_claims immediately, got %d", claims)
	}

	// Background renewer detects missing claim and cancels the SSE stream promptly.
	select {
	case <-sseCanceled:
	case <-time.After(2 * time.Second):
		t.Fatal("expected in-flight SSE run to cancel after Move released claim")
	}
	d.Wait()
	got, _ := d.Tasks.Get(tk.ID)
	if got.Status != tasks.Failed {
		t.Fatalf("expected task to stay failed, got %s", got.Status)
	}

	// Simulate a stale expired claim from a killed previous serve PID and verify RunReaper reclaims it.
	tk2, err := d.Tasks.Create(tasks.NewTask{BoardID: b.ID, Title: "orphaned", Prompt: "work", Workspace: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.Tasks.Move(tk2.ID, tasks.InProgress, "dispatcher"); err != nil {
		t.Fatal(err)
	}
	past := time.Now().Add(-10 * time.Minute).Unix()
	if _, err := s.DB.Exec(
		`INSERT INTO dispatch_claims(task_id,worker_id,run_id,attempt,claimed_at,lease_expires_at) VALUES(?,?,?,?,?,?)`,
		tk2.ID, "old-host-1063905", "run_dead", 5, past-300, past,
	); err != nil {
		t.Fatal(err)
	}

	d2, err := New(s, Config{WorkerID: "new-host-2000", Tick: 20 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	rctx, rcancel := context.WithCancel(context.Background())
	reaperDone := make(chan struct{})
	go func() {
		defer close(reaperDone)
		d2.RunReaper(rctx)
	}()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		got2, _ := d2.Tasks.Get(tk2.ID)
		if got2.Status == tasks.Todo {
			break
		}
		time.Sleep(15 * time.Millisecond)
	}
	rcancel()
	<-reaperDone

	got2, _ := d2.Tasks.Get(tk2.ID)
	if got2.Status != tasks.Todo {
		t.Fatalf("expected RunReaper to reclaim orphaned task to todo, got %s", got2.Status)
	}
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM dispatch_claims WHERE task_id=?`, tk2.ID).Scan(&claims); err != nil {
		t.Fatal(err)
	}
	if claims != 0 {
		t.Fatalf("expected RunReaper to delete expired claim, got %d", claims)
	}
}
