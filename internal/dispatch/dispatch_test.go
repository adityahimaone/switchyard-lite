package dispatch

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/store"
	"github.com/adityahimaone/switchyard-lite/internal/tasks"
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
