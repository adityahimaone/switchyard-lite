package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/pipeline"
)

func init() {
	registrars = append(registrars, func(m *http.ServeMux, a *API) {
		eng := func(w http.ResponseWriter) (*pipeline.Engine, bool) {
			e, err := pipeline.New(a.S)
			if err != nil {
				fail(w, 500, err.Error())
				return nil, false
			}
			return e, true
		}

		m.HandleFunc("GET /api/v1/pipelines/templates", a.require("read", func(w http.ResponseWriter, r *http.Request) {
			e, okEng := eng(w)
			if !okEng {
				return
			}
			ok(w, e.Templates())
		}))

		m.HandleFunc("GET /api/v1/pipelines", a.require("read", func(w http.ResponseWriter, r *http.Request) {
			e, okEng := eng(w)
			if !okEng {
				return
			}
			runs, err := e.ListRuns()
			if err != nil {
				fromErr(w, err)
				return
			}
			ok(w, runs)
		}))

		m.HandleFunc("POST /api/v1/pipelines", a.require("write", func(w http.ResponseWriter, r *http.Request) {
			e, okEng := eng(w)
			if !okEng {
				return
			}
			var in pipeline.StartInput
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				fail(w, 400, "invalid json")
				return
			}
			run, err := e.Start(in)
			if errors.Is(err, pipeline.ErrInvalidTemplate) {
				fail(w, 400, err.Error())
				return
			}
			if err != nil {
				fromErr(w, err)
				return
			}
			if x, err := getDeps(a); err == nil && x.d != nil {
				x.d.Wake()
			}
			w.WriteHeader(201)
			ok(w, run)
		}))

		m.HandleFunc("GET /api/v1/pipelines/{id}", a.require("read", func(w http.ResponseWriter, r *http.Request) {
			e, okEng := eng(w)
			if !okEng {
				return
			}
			run, err := e.Tick(r.PathValue("id"))
			if errors.Is(err, pipeline.ErrNotFound) {
				fail(w, 404, err.Error())
				return
			}
			if err != nil {
				fromErr(w, err)
				return
			}
			ok(w, run)
		}))

		m.HandleFunc("POST /api/v1/pipelines/{id}/cancel", a.require("write", func(w http.ResponseWriter, r *http.Request) {
			e, okEng := eng(w)
			if !okEng {
				return
			}
			run, err := e.Cancel(r.PathValue("id"))
			if errors.Is(err, pipeline.ErrNotFound) {
				fail(w, 404, err.Error())
				return
			}
			if err != nil {
				fromErr(w, err)
				return
			}
			ok(w, run)
		}))

		// Admin token management for Settings screen.
		m.HandleFunc("GET /api/v1/tokens", a.require("admin", func(w http.ResponseWriter, r *http.Request) {
			rows, err := a.S.DB.Query(`SELECT id,name,scope,created_at FROM api_tokens ORDER BY id`)
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			defer rows.Close()
			out := []map[string]any{}
			for rows.Next() {
				var id, at int64
				var name, scope string
				if err := rows.Scan(&id, &name, &scope, &at); err != nil {
					fail(w, 500, err.Error())
					return
				}
				out = append(out, map[string]any{"id": id, "name": name, "scope": scope, "created_at": at})
			}
			ok(w, out)
		}))

		m.HandleFunc("POST /api/v1/tokens", a.require("admin", func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				Name  string `json:"name"`
				Scope string `json:"scope"`
			}
			_ = json.NewDecoder(r.Body).Decode(&in)
			if in.Name == "" {
				in.Name = "agent"
			}
			if in.Scope == "" {
				in.Scope = "write"
			}
			tok, err := CreateToken(a.S, in.Name, in.Scope)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			w.WriteHeader(201)
			ok(w, map[string]string{"token": tok, "name": in.Name, "scope": in.Scope})
		}))

		// SSE live event stream (/api/v1/events/stream).
		m.HandleFunc("GET /api/v1/events/stream", a.require("read", func(w http.ResponseWriter, r *http.Request) {
			fl, okFl := w.(http.Flusher)
			if !okFl {
				fail(w, 500, "streaming unsupported")
				return
			}
			since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
			taskID := r.URL.Query().Get("task_id")
			w.Header().Set("Content-Type", "text/event-stream")
			w.Header().Set("Cache-Control", "no-cache")
			w.Header().Set("Connection", "keep-alive")
			sendBatch := func() {
				evts, err := a.Tasks.Events(taskID, since, 100)
				if err != nil {
					return
				}
				for _, ev := range evts {
					b, _ := json.Marshal(ev)
					fmt.Fprintf(w, "id: %d\ndata: %s\n\n", ev.ID, b)
					since = ev.ID
				}
				fl.Flush()
			}
			sendBatch()
			if r.URL.Query().Get("once") == "1" {
				return
			}
			t := time.NewTicker(1 * time.Second)
			defer t.Stop()
			for {
				select {
				case <-r.Context().Done():
					return
				case <-t.C:
					sendBatch()
				}
			}
		}))
	})
}
