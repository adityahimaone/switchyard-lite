// Package api exposes the REST surface under /api/v1.
package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/adityahimaone/switchyard-lite/internal/store"
	"github.com/adityahimaone/switchyard-lite/internal/tasks"
)

type API struct {
	S     *store.Store
	Tasks *tasks.Service
}

func New(s *store.Store) *API { return &API{S: s, Tasks: tasks.New(s)} }

func fail(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func ok(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func fromErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, tasks.ErrNotFound):
		fail(w, 404, err.Error())
	case errors.Is(err, tasks.ErrBadMove), errors.Is(err, tasks.ErrCycle):
		fail(w, 409, err.Error())
	case errors.Is(err, tasks.ErrBadRequest):
		fail(w, 400, err.Error())
	default:
		fail(w, 500, err.Error())
	}
}

func (a *API) Handler() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { ok(w, map[string]string{"status": "ok"}) })

	m.HandleFunc("GET /api/v1/boards", a.require("read", func(w http.ResponseWriter, r *http.Request) {
		b, err := a.Tasks.ListBoards()
		if err != nil {
			fromErr(w, err)
			return
		}
		ok(w, b)
	}))
	m.HandleFunc("POST /api/v1/boards", a.require("write", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Name            string `json:"name"`
			DefaultExecutor string `json:"default_executor"`
			DefaultModel    string `json:"default_model"`
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		b, err := a.Tasks.CreateBoardWithDefaults(in.Name, in.DefaultExecutor, in.DefaultModel)
		if err != nil {
			fromErr(w, err)
			return
		}
		w.WriteHeader(201)
		ok(w, b)
	}))
	m.HandleFunc("PATCH /api/v1/boards/{id}", a.require("write", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Name            string `json:"name"`
			DefaultExecutor string `json:"default_executor"`
			DefaultModel    string `json:"default_model"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			fail(w, 400, "invalid json")
			return
		}
		b, err := a.Tasks.UpdateBoard(r.PathValue("id"), in.Name, in.DefaultExecutor, in.DefaultModel)
		if err != nil {
			fromErr(w, err)
			return
		}
		ok(w, b)
	}))
	m.HandleFunc("DELETE /api/v1/boards/{id}", a.require("write", func(w http.ResponseWriter, r *http.Request) {
		if err := a.Tasks.DeleteBoard(r.PathValue("id")); err != nil {
			fromErr(w, err)
			return
		}
		w.WriteHeader(204)
	}))
	m.HandleFunc("GET /api/v1/boards/{id}/tasks", a.require("read", func(w http.ResponseWriter, r *http.Request) {
		t, err := a.Tasks.List(r.PathValue("id"), r.URL.Query().Get("status"))
		if err != nil {
			fromErr(w, err)
			return
		}
		ok(w, t)
	}))
	m.HandleFunc("POST /api/v1/tasks", a.require("write", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			BoardID       string   `json:"board_id"`
			ParentID      string   `json:"parent_id"`
			Title         string   `json:"title"`
			Prompt        string   `json:"prompt"`
			Acceptance    string   `json:"acceptance"`
			Status        string   `json:"status"`
			Workspace     string   `json:"workspace"`
			Executor      string   `json:"executor"`
			Model         string   `json:"model"`
			Effort        string   `json:"effort"`
			Branch        string   `json:"branch"`
			ExecutionMode string   `json:"execution_mode"`
			SessionID     string   `json:"session_id"`
			Paths         []string `json:"paths"`
			Skills        []string `json:"skills"`
			BlockedBy     []string `json:"blocked_by"`
		}
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			fail(w, 400, "invalid json")
			return
		}
		t, err := a.Tasks.Create(tasks.NewTask{BoardID: in.BoardID, ParentID: in.ParentID, Title: in.Title, Prompt: in.Prompt,
			Acceptance: in.Acceptance, Status: in.Status, Workspace: in.Workspace, Executor: in.Executor, Model: in.Model, Effort: in.Effort,
			Branch: in.Branch, ExecutionMode: in.ExecutionMode, SessionID: in.SessionID, Paths: in.Paths, Skills: in.Skills, BlockedBy: in.BlockedBy})
		if err != nil {
			fromErr(w, err)
			return
		}
		w.WriteHeader(201)
		ok(w, t)
	}))
	m.HandleFunc("GET /api/v1/tasks/{id}", a.require("read", func(w http.ResponseWriter, r *http.Request) {
		t, err := a.Tasks.Get(r.PathValue("id"))
		if err != nil {
			fromErr(w, err)
			return
		}
		ok(w, t)
	}))
	m.HandleFunc("POST /api/v1/tasks/{id}/move", a.require("write", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Status string }
		_ = json.NewDecoder(r.Body).Decode(&in)
		t, err := a.Tasks.Move(r.PathValue("id"), in.Status, "api")
		if err != nil {
			fromErr(w, err)
			return
		}
		ok(w, t)
	}))
	m.HandleFunc("POST /api/v1/tasks/{id}/dependencies", a.require("write", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			BlockedBy string `json:"blocked_by"`
		}
		_ = json.NewDecoder(r.Body).Decode(&in)
		if err := a.Tasks.AddDependency(r.PathValue("id"), in.BlockedBy); err != nil {
			fromErr(w, err)
			return
		}
		w.WriteHeader(204)
	}))
	m.HandleFunc("GET /api/v1/tasks/{id}/comments", a.require("read", func(w http.ResponseWriter, r *http.Request) {
		c, err := a.Tasks.Comments(r.PathValue("id"))
		if err != nil {
			fromErr(w, err)
			return
		}
		ok(w, c)
	}))
	m.HandleFunc("POST /api/v1/tasks/{id}/comments", a.require("write", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Author, Body string }
		_ = json.NewDecoder(r.Body).Decode(&in)
		if in.Author == "" {
			in.Author = "api"
		}
		c, err := a.Tasks.AddComment(r.PathValue("id"), in.Author, in.Body)
		if err != nil {
			fromErr(w, err)
			return
		}
		w.WriteHeader(201)
		ok(w, c)
	}))
	m.HandleFunc("GET /api/v1/events", a.require("read", func(w http.ResponseWriter, r *http.Request) {
		since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		e, err := a.Tasks.Events(r.URL.Query().Get("task_id"), since, limit)
		if err != nil {
			fromErr(w, err)
			return
		}
		ok(w, e)
	}))
	for _, reg := range registrars {
		reg(m, a)
	}
	return m
}

// registrars lets feature files add routes via init(): registrars = append(registrars, func(m *http.ServeMux, a *API){...}).
var registrars []func(*http.ServeMux, *API)
