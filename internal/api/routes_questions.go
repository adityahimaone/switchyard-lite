package api

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/adityahimaone/switchyard-lite/internal/tasks"
)

func init() {
	registrars = append(registrars, func(m *http.ServeMux, a *API) {
		m.HandleFunc("GET /api/v1/tasks/{id}/questions", a.require("read", func(w http.ResponseWriter, r *http.Request) {
			list, err := a.Tasks.ListQuestions(r.PathValue("id"))
			if err != nil {
				fromErr(w, err)
				return
			}
			ok(w, list)
		}))

		m.HandleFunc("POST /api/v1/tasks/{id}/questions", a.require("write", func(w http.ResponseWriter, r *http.Request) {
			var in tasks.AskQuestionInput
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				fail(w, 400, "invalid json")
				return
			}
			q, err := a.Tasks.AskQuestion(r.PathValue("id"), in)
			if err != nil {
				fromErr(w, err)
				return
			}
			w.WriteHeader(201)
			ok(w, q)
		}))

		m.HandleFunc("POST /api/v1/tasks/{id}/questions/answer", a.require("write", func(w http.ResponseWriter, r *http.Request) {
			id := r.PathValue("id")
			var in struct {
				QuestionID      string   `json:"question_id"`
				SelectedOptions []string `json:"selected_options"`
				Answer          string   `json:"answer"`
				Author          string   `json:"author"`
				AutoResume      *bool    `json:"auto_resume"`
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				fail(w, 400, "invalid json")
				return
			}
			q, updated, err := a.Tasks.AnswerQuestion(id, tasks.AnswerQuestionInput{
				QuestionID:      in.QuestionID,
				SelectedOptions: in.SelectedOptions,
				Answer:          in.Answer,
				Author:          in.Author,
			})
			if err != nil {
				fromErr(w, err)
				return
			}
			resumed := false
			var runID string
			shouldResume := in.AutoResume == nil || *in.AutoResume
			if shouldResume && updated.ExecutionMode != tasks.ExecTracker {
				if x, err := getDeps(a); err == nil && x.d != nil {
					rid, okRes, _ := x.d.ResumeWithAnswer(context.Background(), id, q, q.Answer)
					resumed = okRes || rid != ""
					runID = rid
					if refreshed, err := a.Tasks.Get(id); err == nil {
						updated = refreshed
					}
				}
			}
			ok(w, map[string]any{
				"question": q,
				"task":     updated,
				"resumed":  resumed,
				"run_id":   runID,
			})
		}))
	})
}
