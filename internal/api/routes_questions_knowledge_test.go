package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/dispatch"
	"github.com/adityahimaone/switchyard-lite/internal/store"
	"github.com/adityahimaone/switchyard-lite/internal/tasks"
)

func doJSONReq(t *testing.T, h http.Handler, tok, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestTrackerRetryQuestionsAndKnowledgeEndpoints(t *testing.T) {
	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	a := New(s)
	d, err := dispatch.New(s, dispatch.Config{WorkerID: "w-api", Lease: time.Minute, MaxParallel: 2})
	if err != nil {
		t.Fatal(err)
	}
	UseDispatcher(a, d)

	tok, err := CreateToken(s, "full", "admin")
	if err != nil {
		t.Fatal(err)
	}
	h := a.Handler()

	board, err := a.Tasks.CreateBoard("Default")
	if err != nil {
		t.Fatal(err)
	}

	// 1. Passive Tracker Mode lifecycle
	rec := doJSONReq(t, h, tok, "POST", "/api/v1/tasks/track/start", map[string]any{
		"board_id":   board.ID,
		"title":      "Mirror Antigravity Task",
		"executor":   "commandcode",
		"session_id": "cc_sess_42",
	})
	if rec.Code != 200 {
		t.Fatalf("track/start code=%d body=%s", rec.Code, rec.Body.String())
	}
	var tracked tasks.Task
	if err := json.Unmarshal(rec.Body.Bytes(), &tracked); err != nil {
		t.Fatal(err)
	}
	if tracked.ExecutionMode != tasks.ExecTracker || tracked.Status != tasks.InProgress {
		t.Fatalf("unexpected tracked task: mode=%s status=%s", tracked.ExecutionMode, tracked.Status)
	}

	rec = doJSONReq(t, h, tok, "POST", "/api/v1/tasks/"+tracked.ID+"/track/progress", map[string]any{
		"step":    "Auditing schema",
		"percent": 60,
		"comment": true,
	})
	if rec.Code != 200 {
		t.Fatalf("track/progress code=%d body=%s", rec.Code, rec.Body.String())
	}

	// 2. Interactive Question + Answer on tracked task (no auto-resume needed)
	rec = doJSONReq(t, h, tok, "POST", "/api/v1/tasks/"+tracked.ID+"/questions", map[string]any{
		"question":     "Choose rollout mode?",
		"options":      []string{"Canary", "Blue/Green"},
		"multi_select": false,
		"author":       "commandcode",
	})
	if rec.Code != 201 {
		t.Fatalf("ask question code=%d body=%s", rec.Code, rec.Body.String())
	}
	var q tasks.TaskQuestion
	if err := json.Unmarshal(rec.Body.Bytes(), &q); err != nil {
		t.Fatal(err)
	}

	rec = doJSONReq(t, h, tok, "POST", "/api/v1/tasks/"+tracked.ID+"/questions/answer", map[string]any{
		"question_id":      q.ID,
		"selected_options": []string{"Canary"},
		"author":           "user",
	})
	if rec.Code != 200 {
		t.Fatalf("answer question code=%d body=%s", rec.Code, rec.Body.String())
	}
	var ansResp struct {
		Question tasks.TaskQuestion `json:"question"`
		Task     tasks.Task         `json:"task"`
		Resumed  bool               `json:"resumed"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &ansResp)
	if ansResp.Question.Status != "answered" || ansResp.Question.Answer != "Canary" {
		t.Fatalf("unexpected answered question: %+v", ansResp.Question)
	}
	if ansResp.Resumed {
		t.Fatalf("tracker task must not auto-dispatch on answer")
	}

	rec = doJSONReq(t, h, tok, "POST", "/api/v1/tasks/"+tracked.ID+"/track/complete", map[string]any{
		"status": "done",
		"output": "Completed rollout with Canary",
	})
	if rec.Code != 200 {
		t.Fatalf("track/complete code=%d body=%s", rec.Code, rec.Body.String())
	}
	var doneTask tasks.Task
	_ = json.Unmarshal(rec.Body.Bytes(), &doneTask)
	if doneTask.Status != tasks.Done {
		t.Fatalf("expected tracker complete status done, got %s", doneTask.Status)
	}

	// 3. Managed Task Failure + Retry endpoint
	failedTask, err := a.Tasks.Create(tasks.NewTask{
		BoardID:  board.ID,
		Title:    "Retryable Managed Task",
		Prompt:   "Run build",
		Executor: "dsh",
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = a.Tasks.Move(failedTask.ID, tasks.InProgress, "dispatcher")
	_, _ = a.Tasks.Move(failedTask.ID, tasks.Failed, "dispatcher")
	_, _ = s.DB.Exec(`UPDATE tasks SET retry_count=2, error_sig='boom' WHERE id=?`, failedTask.ID)

	falseFlag := false
	rec = doJSONReq(t, h, tok, "POST", "/api/v1/tasks/"+failedTask.ID+"/retry", map[string]any{
		"feedback":     "Use clean cache",
		"dispatch_now": falseFlag,
	})
	if rec.Code != 200 {
		t.Fatalf("retry code=%d body=%s", rec.Code, rec.Body.String())
	}
	var retryResp struct {
		Task tasks.Task `json:"task"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &retryResp)
	if retryResp.Task.Status != tasks.Todo || retryResp.Task.RetryCount != 0 {
		t.Fatalf("expected reset todo task, got status=%s retries=%d", retryResp.Task.Status, retryResp.Task.RetryCount)
	}

	// 4. Knowledge Docs CRUD endpoints
	rec = doJSONReq(t, h, tok, "POST", "/api/v1/knowledge", map[string]any{
		"slug":     "dsh-workflow",
		"title":    "DSH Workflow Notes",
		"category": "Custom Knowledge",
		"summary":  "How dsh mirrors tasks via MCP.",
		"content":  "Use start_tracked_task and ask_task_question.",
	})
	if rec.Code != 201 {
		t.Fatalf("create knowledge code=%d body=%s", rec.Code, rec.Body.String())
	}
	rec = doJSONReq(t, h, tok, "GET", "/api/v1/knowledge?q=dsh", nil)
	if rec.Code != 200 {
		t.Fatalf("list knowledge code=%d body=%s", rec.Code, rec.Body.String())
	}
	var docs []map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &docs)
	if len(docs) != 1 || docs[0]["slug"] != "dsh-workflow" {
		t.Fatalf("unexpected knowledge search result: %v", docs)
	}
	rec = doJSONReq(t, h, tok, "DELETE", "/api/v1/knowledge/dsh-workflow", nil)
	if rec.Code != 204 {
		t.Fatalf("delete knowledge code=%d body=%s", rec.Code, rec.Body.String())
	}

	_ = context.Background()
}
