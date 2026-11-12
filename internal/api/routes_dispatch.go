package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/dispatch"
	"github.com/adityahimaone/switchyard-lite/internal/models"
	"github.com/adityahimaone/switchyard-lite/internal/review"
	"github.com/adityahimaone/switchyard-lite/internal/tasks"
)

type dispatchDeps struct {
	d *dispatch.Dispatcher
	r *review.Service
	m *models.Catalog
}

var (
	depsMu sync.Mutex
	deps   = map[*API]*dispatchDeps{}
)

// UseDispatcher shares the serve-time dispatcher with the routes.
func UseDispatcher(a *API, d *dispatch.Dispatcher) {
	depsMu.Lock()
	defer depsMu.Unlock()
	r, _ := review.New(a.S)
	deps[a] = &dispatchDeps{d: d, r: r, m: models.New(d.Cfg.NodeAgentURL, d.Cfg.Token)}
}

func getDeps(a *API) (*dispatchDeps, error) {
	depsMu.Lock()
	defer depsMu.Unlock()
	if x, ok := deps[a]; ok {
		return x, nil
	}
	cfg := dispatch.ConfigFromEnv()
	d, err := dispatch.New(a.S, cfg)
	if err != nil {
		return nil, err
	}
	r, err := review.New(a.S)
	if err != nil {
		return nil, err
	}
	x := &dispatchDeps{d: d, r: r, m: models.New(cfg.NodeAgentURL, cfg.Token)}
	deps[a] = x
	return x, nil
}

func reviewErr(w http.ResponseWriter, err error) {
	if errors.Is(err, review.ErrNoWorktree) {
		fail(w, 409, err.Error())
		return
	}
	fromErr(w, err)
}

func init() {
	registrars = append(registrars, func(m *http.ServeMux, a *API) {
		h := func(scope string, f func(w http.ResponseWriter, r *http.Request, x *dispatchDeps)) http.HandlerFunc {
			return a.require(scope, func(w http.ResponseWriter, r *http.Request) {
				x, err := getDeps(a)
				if err != nil {
					fail(w, 500, err.Error())
					return
				}
				f(w, r, x)
			})
		}
		m.HandleFunc("POST /api/v1/tasks/{id}/dispatch", h("write", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			id := r.PathValue("id")
			if _, err := a.Tasks.Get(id); err != nil {
				fromErr(w, err)
				return
			}
			run, err := x.d.Start(context.Background(), id)
			if errors.Is(err, dispatch.ErrNotClaimable) {
				fail(w, 409, err.Error())
				return
			}
			if err != nil {
				fromErr(w, err)
				return
			}
			w.WriteHeader(202)
			ok(w, map[string]string{"task_id": id, "run_id": run})
		}))
		m.HandleFunc("GET /api/v1/tasks/{id}/diff", h("read", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			d, err := x.r.Diff(r.PathValue("id"))
			if err != nil {
				reviewErr(w, err)
				return
			}
			ok(w, map[string]string{"diff": d})
		}))
		m.HandleFunc("POST /api/v1/tasks/{id}/approve", h("write", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			t, err := x.r.Approve(r.PathValue("id"))
			if err != nil {
				reviewErr(w, err)
				return
			}
			ok(w, t)
		}))
		m.HandleFunc("POST /api/v1/tasks/{id}/reject", h("write", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			var in struct {
				Feedback string `json:"feedback"`
				Reason   string `json:"reason"`
			}
			_ = json.NewDecoder(r.Body).Decode(&in)
			fb := in.Feedback
			if fb == "" {
				fb = in.Reason
			}
			t, err := x.r.Reject(r.PathValue("id"), fb)
			if err != nil {
				reviewErr(w, err)
				return
			}
			x.d.Wake()
			ok(w, t)
		}))
		m.HandleFunc("GET /api/v1/models", h("read", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			raw, err := x.m.List(r.Context(), r.URL.Query().Get("executor"), r.URL.Query().Get("refresh") == "1")
			if err != nil {
				fail(w, 502, err.Error())
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(raw)
		}))
		m.HandleFunc("GET /api/v1/workers", h("read", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			listRows(w, a, `SELECT id,name,url,created_at FROM dispatch_workers ORDER BY created_at`, "id", "name", "url")
		}))
		m.HandleFunc("POST /api/v1/workers", h("admin", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			var in struct{ Name, URL string }
			_ = json.NewDecoder(r.Body).Decode(&in)
			if in.Name == "" {
				fail(w, 400, "name required")
				return
			}
			id := "w_" + time.Now().Format("150405.000000")
			if _, err := a.S.DB.Exec(`INSERT INTO dispatch_workers(id,name,url,created_at) VALUES(?,?,?,?)`, id, in.Name, in.URL, time.Now().Unix()); err != nil {
				fail(w, 500, err.Error())
				return
			}
			w.WriteHeader(201)
			ok(w, map[string]string{"id": id, "name": in.Name, "url": in.URL})
		}))
		m.HandleFunc("GET /api/v1/workspaces", h("read", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			listRows(w, a, `SELECT id,name,path,created_at FROM dispatch_workspaces ORDER BY created_at`, "id", "name", "path")
		}))
		m.HandleFunc("GET /api/v1/workspaces/inspect", h("read", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			p := r.URL.Query().Get("path")
			isGit := dispatch.IsGit(p)
			branches := []string{}
			if isGit {
				if out, err := dispatch.Git(p, "branch", "--format=%(refname:short)"); err == nil && out != "" {
					for _, b := range splitLines(out) {
						branches = append(branches, b)
					}
				}
			}
			ok(w, map[string]any{"path": p, "is_git": isGit, "branches": branches})
		}))
		m.HandleFunc("POST /api/v1/workspaces", h("write", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			var in struct{ Name, Path string }
			_ = json.NewDecoder(r.Body).Decode(&in)
			if in.Path == "" {
				fail(w, 400, "path required")
				return
			}
			if in.Name == "" {
				in.Name = in.Path
			}
			id := "ws_" + time.Now().Format("150405.000000")
			if _, err := a.S.DB.Exec(`INSERT INTO dispatch_workspaces(id,name,path,created_at) VALUES(?,?,?,?)`, id, in.Name, in.Path, time.Now().Unix()); err != nil {
				fail(w, 409, err.Error())
				return
			}
			w.WriteHeader(201)
			ok(w, map[string]any{"id": id, "name": in.Name, "path": in.Path, "git": dispatch.IsGit(in.Path)})
		}))
	})
}

func listRows(w http.ResponseWriter, a *API, q string, k1, k2, k3 string) {
	rows, err := a.S.DB.Query(q)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var s1, s2, s3 string
		var at int64
		if err := rows.Scan(&s1, &s2, &s3, &at); err != nil {
			fail(w, 500, err.Error())
			return
		}
		out = append(out, map[string]any{k1: s1, k2: s2, k3: s3, "created_at": at})
	}
	ok(w, out)
}

func splitLines(s string) []string {
	var out []string
	for _, x := range stringsSplit(s, "\n") {
		if x != "" {
			out = append(out, x)
		}
	}
	return out
}

func stringsSplit(s, sep string) []string {
	var res []string
	start := 0
	for i := 0; i+len(sep) <= len(s); i++ {
		if s[i:i+len(sep)] == sep {
			res = append(res, s[start:i])
			start = i + len(sep)
		}
	}
	res = append(res, s[start:])
	return res
}

var _ = tasks.Todo
