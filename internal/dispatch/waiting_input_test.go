package dispatch

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/adityahimaone/switchyard-studio/internal/store"
	"github.com/adityahimaone/switchyard-studio/internal/tasks"
)

func TestOpenQuestionMovesTaskToWaitingInputAndResumesWithHandoff(t *testing.T) {
	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	var mu sync.Mutex
	var captured []Request
	turn := 0

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/dispatch" && r.Method == http.MethodPost {
			var req Request
			_ = json.NewDecoder(r.Body).Decode(&req)
			mu.Lock()
			captured = append(captured, req)
			turn++
			mu.Unlock()
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"accepted":true,"executor":"dsh","session_id":"dsh_sess_1"}`))
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/events/") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/progress/") {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/results/") {
			mu.Lock()
			curTurn := turn
			mu.Unlock()
			if curTurn == 1 {
				_ = json.NewEncoder(w).Encode(Result{
					TaskID:       "t1",
					Success:      true,
					Executor:     "dsh",
					DshSessionID: "dsh_sess_1",
					Output:       `{"type":"assistant","text":"Checking repo..."}` + "\n" + `{"type":"tool_call","name":"ask_question","question":"Which storage?","options":["(Recommended) SQLite","Postgres"],"multi_select":false}`,
				})
				return
			}
			_ = json.NewEncoder(w).Encode(Result{
				TaskID:   "t1",
				Success:  true,
				Executor: "commandcode",
				Output:   "Implemented with SQLite.",
			})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	d, err := New(s, Config{NodeAgentURL: srv.URL, Poll: 10, Tick: 10})
	if err != nil {
		t.Fatal(err)
	}
	b, err := d.Tasks.CreateBoard("Main")
	if err != nil {
		t.Fatal(err)
	}
	tk, err := d.Tasks.Create(tasks.NewTask{
		BoardID:  b.ID,
		Title:    "Add persistence",
		Prompt:   "Persist jobs",
		Executor: "dsh",
		GrillMe:  true,
	})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := d.Start(context.Background(), tk.ID); err != nil {
		t.Fatal(err)
	}
	d.Wait()

	afterAsk, err := d.Tasks.Get(tk.ID)
	if err != nil {
		t.Fatal(err)
	}
	if afterAsk.Status != tasks.WaitingInput {
		t.Fatalf("expected status %q, got %q", tasks.WaitingInput, afterAsk.Status)
	}
	if afterAsk.Question == nil || afterAsk.Question.Question != "Which storage?" {
		t.Fatalf("expected pending question, got %+v", afterAsk.Question)
	}
	if afterAsk.HarnessSessions["dsh"] != "dsh_sess_1" {
		t.Fatalf("expected dsh session stored in harness_sessions, got %+v", afterAsk.HarnessSessions)
	}
	if len(captured) == 0 || !strings.Contains(captured[0].Message, "[GRILL-ME INTERVIEW MODE ACTIVE]") {
		t.Fatalf("expected Grill-Me prompt injection, got %+v", captured)
	}

	// Answer AND switch harness mid-card from dsh -> commandcode.
	newExec := "commandcode"
	newModel := "gpt-5"
	if _, err := d.Tasks.Update(tk.ID, tasks.Patch{Executor: &newExec, Model: &newModel}); err != nil {
		t.Fatal(err)
	}
	q, _, err := d.Tasks.AnswerQuestion(tk.ID, tasks.AnswerQuestionInput{
		QuestionID:      afterAsk.Question.ID,
		SelectedOptions: []string{"(Recommended) SQLite"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, resumed, err := d.ResumeWithAnswer(context.Background(), tk.ID, q, q.Answer); err != nil || !resumed {
		t.Fatalf("resume failed: resumed=%v err=%v", resumed, err)
	}
	d.Wait()

	mu.Lock()
	defer mu.Unlock()
	if len(captured) < 2 {
		t.Fatalf("expected 2nd dispatch after answer, got %d", len(captured))
	}
	if !strings.Contains(captured[1].Message, "[CROSS-HARNESS HANDOFF]") {
		t.Fatalf("expected cross-harness handoff on 2nd dispatch, got:\n%s", captured[1].Message)
	}
	if captured[1].Spawn == nil || len(captured[1].Spawn.Argv) == 0 || captured[1].Spawn.Argv[0] != "commandcode" {
		t.Fatalf("expected SpawnSpec for commandcode, got %+v", captured[1].Spawn)
	}
}
