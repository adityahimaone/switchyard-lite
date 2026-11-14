package dispatch

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/store"
	"github.com/adityahimaone/switchyard-lite/internal/tasks"
)

func TestDetectOpenQuestionFormats(t *testing.T) {
	cases := []struct {
		name    string
		output  string
		wantQ   string
		wantLen int
		wantOK  bool
	}{
		{
			name:    "fenced_json_block",
			output:  "Analyzed codebase.\n```question\n{\"question\":\"Which auth strategy?\",\"options\":[\"JWT + Refresh\",\"Session Cookie\"],\"context\":\"Found both middleware files\"}\n```\n",
			wantQ:   "Which auth strategy?",
			wantLen: 2,
			wantOK:  true,
		},
		{
			name:    "explicit_question_tag",
			output:  "[QUESTION]\nPick deployment target?\n1. Fly.io\n2. Cloud Run\n3. Self-hosted\n[/QUESTION]",
			wantQ:   "Pick deployment target?",
			wantLen: 3,
			wantOK:  true,
		},
		{
			name:    "natural_tail_dsh_choices",
			output:  "Checked routes.\nShould I keep backwards-compatible `/v1` aliases?\nA) Keep aliases\nB) Remove deprecated routes\nReply with your choice.",
			wantQ:   "Should I keep backwards-compatible `/v1` aliases?",
			wantLen: 2,
			wantOK:  true,
		},
		{
			name:   "plain_completion_no_question",
			output: "All tests pass cleanly.",
			wantOK: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			q, opts, _, ok := DetectOpenQuestion(tc.output)
			if ok != tc.wantOK {
				t.Fatalf("ok=%v want %v (q=%q opts=%v)", ok, tc.wantOK, q, opts)
			}
			if !tc.wantOK {
				return
			}
			if q != tc.wantQ {
				t.Errorf("question=%q want %q", q, tc.wantQ)
			}
			if len(opts) != tc.wantLen {
				t.Errorf("opts=%v (len %d) want len %d", opts, len(opts), tc.wantLen)
			}
		})
	}
}

func TestTrackerTasksSkippedByTickAndClaim(t *testing.T) {
	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	svc := tasks.New(s)
	board, err := svc.CreateBoard("Main")
	if err != nil {
		t.Fatal(err)
	}
	d, err := New(s, Config{WorkerID: "w-test", Lease: time.Minute, MaxParallel: 2})
	if err != nil {
		t.Fatal(err)
	}

	tracked, err := svc.Create(tasks.NewTask{
		BoardID:       board.ID,
		Title:         "External Claude/dsh tracker card",
		Status:        tasks.Todo,
		ExecutionMode: tasks.ExecTracker,
		Executor:      "dsh",
	})
	if err != nil {
		t.Fatal(err)
	}

	if claimed, err := d.Claim(tracked.ID, "run_should_skip"); err != nil || claimed {
		t.Fatalf("tracker task should never be claimed: claimed=%v err=%v", claimed, err)
	}
	if err := d.Tick(context.Background()); err != nil {
		t.Fatalf("tick failed: %v", err)
	}
	got, err := svc.Get(tracked.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != tasks.Todo {
		t.Fatalf("expected tracker status todo unchanged, got %s", got.Status)
	}
}

func TestResumeWithAnswerContinuity(t *testing.T) {
	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	var mu sync.Mutex
	var captured Request
	doneCh := make(chan struct{}, 1)

	agent := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "POST" && r.URL.Path == "/api/dispatch":
			var req Request
			_ = json.NewDecoder(r.Body).Decode(&req)
			mu.Lock()
			captured = req
			mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"accepted":true,"executor":"dsh","session_id":"dsh_sess_initial"}`))
		case r.Method == "GET" && strings.HasPrefix(r.URL.Path, "/api/results/"):
			mu.Lock()
			tid := captured.TaskID
			mu.Unlock()
			if tid == "" {
				w.WriteHeader(http.StatusAccepted)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"task_id":"` + tid + `","success":true,"output":"Applied JWT choice","dsh_session_id":"dsh_s_2"}`))
			select {
			case doneCh <- struct{}{}:
			default:
			}
		case r.Method == "GET" && strings.HasPrefix(r.URL.Path, "/api/progress/"):
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	defer agent.Close()

	svc := tasks.New(s)
	board, err := svc.CreateBoard("Auth")
	if err != nil {
		t.Fatal(err)
	}
	d, err := New(s, Config{
		NodeAgentURL: agent.URL,
		WorkerID:     "w-test",
		Lease:        time.Minute,
		Poll:         15 * time.Millisecond,
		Tick:         time.Second,
		MaxParallel:  2,
		TimeoutS:     10,
	})
	if err != nil {
		t.Fatal(err)
	}

	task, err := svc.Create(tasks.NewTask{
		BoardID:       board.ID,
		Title:         "Configure auth flow",
		Prompt:        "Set up auth",
		Executor:      "dsh",
		SessionID:     "dsh_sess_initial",
		ExecutionMode: tasks.ExecManaged,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = s.DB.Exec(`UPDATE tasks SET dsh_workspace_id='dsh_ws_9' WHERE id=?`, task.ID)
	q, err := svc.AskQuestion(task.ID, tasks.AskQuestionInput{
		Question: "Use JWT or Session?",
		Options:  []string{"JWT", "Session"},
		Author:   "dsh",
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = svc.AnswerQuestion(task.ID, tasks.AnswerQuestionInput{
		QuestionID:      q.ID,
		SelectedOptions: []string{"JWT"},
		Author:          "user",
	})
	if err != nil {
		t.Fatal(err)
	}

	runID, resumed, err := d.ResumeWithAnswer(context.Background(), task.ID, q, "JWT")
	if err != nil || !resumed || runID == "" {
		t.Fatalf("ResumeWithAnswer failed: runID=%q resumed=%v err=%v", runID, resumed, err)
	}
	select {
	case <-doneCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for resumed dispatch result")
	}
	d.Wait()

	mu.Lock()
	gotReq := captured
	mu.Unlock()
	if !gotReq.SessionContinuation {
		t.Errorf("expected SessionContinuation=true")
	}
	if gotReq.DSHSessionID != "dsh_sess_initial" || gotReq.DSHWorkspaceID != "dsh_ws_9" {
		t.Errorf("unexpected dsh continuity fields: sess=%q ws=%q", gotReq.DSHSessionID, gotReq.DSHWorkspaceID)
	}
	if gotReq.HarnessKind != "dsh" {
		t.Errorf("expected HarnessKind=dsh, got %q", gotReq.HarnessKind)
	}
}
