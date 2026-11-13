package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
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
			list, err := queryWorkspaces(a)
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			ok(w, list)
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
			var in workspaceInput
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				fail(w, 400, "invalid json")
				return
			}
			if strings.TrimSpace(in.Path) == "" {
				fail(w, 400, "path required")
				return
			}
			if strings.TrimSpace(in.Name) == "" {
				in.Name = in.Path
			}
			id := strings.TrimSpace(in.ID)
			if id == "" {
				id = "ws_" + time.Now().Format("150405.000000")
			}
			kind := in.Kind
			if kind == "" {
				if dispatch.IsGit(in.Path) {
					kind = "repo"
				} else {
					kind = "dir"
				}
			}
			now := time.Now().Unix()
			if _, err := a.S.DB.Exec(
				`INSERT INTO dispatch_workspaces(id,name,path,host,os,kind,labels,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
				id, strings.TrimSpace(in.Name), strings.TrimSpace(in.Path), strings.TrimSpace(in.Host), strings.TrimSpace(in.OS), kind, joinLabels(in.Labels), strings.TrimSpace(in.Note), now,
			); err != nil {
				fail(w, 409, err.Error())
				return
			}
			ws, err := getWorkspaceByID(a, id)
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			w.WriteHeader(201)
			ok(w, ws)
		}))
		updateWorkspace := h("write", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			id := r.PathValue("id")
			cur, err := getWorkspaceByID(a, id)
			if err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					fail(w, 404, "workspace not found")
					return
				}
				fail(w, 500, err.Error())
				return
			}
			var in workspaceInput
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				fail(w, 400, "invalid json")
				return
			}
			name := strings.TrimSpace(in.Name)
			if name == "" {
				name = cur.Name
			}
			path := strings.TrimSpace(in.Path)
			if path == "" {
				path = cur.Path
			}
			kind := in.Kind
			if kind == "" {
				kind = cur.Kind
			}
			labels := joinLabels(in.Labels)
			if in.Labels == nil {
				labels = joinLabels(cur.Labels)
			}
			if _, err := a.S.DB.Exec(
				`UPDATE dispatch_workspaces SET name=?, path=?, host=?, os=?, kind=?, labels=?, note=? WHERE id=?`,
				name, path, strings.TrimSpace(in.Host), strings.TrimSpace(in.OS), kind, labels, strings.TrimSpace(in.Note), id,
			); err != nil {
				fail(w, 409, err.Error())
				return
			}
			ws, err := getWorkspaceByID(a, id)
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			ok(w, ws)
		})
		m.HandleFunc("PUT /api/v1/workspaces/{id}", updateWorkspace)
		m.HandleFunc("PATCH /api/v1/workspaces/{id}", updateWorkspace)
		m.HandleFunc("POST /api/v1/workspaces/ping", h("read", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			list, err := queryWorkspaces(a)
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			for i := range list {
				list[i] = pingWorkspaceRecord(a, list[i])
			}
			ok(w, list)
		}))
		m.HandleFunc("POST /api/v1/workspaces/{id}/ping", h("read", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			ws, err := getWorkspaceByID(a, r.PathValue("id"))
			if err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					fail(w, 404, "workspace not found")
					return
				}
				fail(w, 500, err.Error())
				return
			}
			ok(w, pingWorkspaceRecord(a, ws))
		}))
		m.HandleFunc("GET /api/v1/tasks/{id}/worktree", h("read", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			var repo, path, branch, baseSHA string
			err := a.S.DB.QueryRow(
				`SELECT repo,path,branch,base_sha FROM task_worktrees WHERE task_id=?`,
				r.PathValue("id"),
			).Scan(&repo, &path, &branch, &baseSHA)
			if errors.Is(err, sql.ErrNoRows) {
				ok(w, map[string]any{"exists": false})
				return
			}
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			ok(w, map[string]any{"exists": true, "repo": repo, "path": path, "branch": branch, "base_sha": baseSHA})
		}))
		m.HandleFunc("DELETE /api/v1/workspaces/{id}", h("write", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			_, _ = a.S.DB.Exec(`DELETE FROM dispatch_workspaces WHERE id=?`, r.PathValue("id"))
			w.WriteHeader(204)
		}))
		m.HandleFunc("DELETE /api/v1/workers/{id}", h("admin", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			_, _ = a.S.DB.Exec(`DELETE FROM dispatch_workers WHERE id=?`, r.PathValue("id"))
			w.WriteHeader(204)
		}))
		m.HandleFunc("GET /api/v1/settings/review", h("read", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			ok(w, map[string]bool{"auto_merge": x.r.AutoMerge()})
		}))
		m.HandleFunc("POST /api/v1/settings/review", h("write", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			var in struct {
				AutoMerge bool `json:"auto_merge"`
			}
			_ = json.NewDecoder(r.Body).Decode(&in)
			if err := x.r.SetAutoMerge(in.AutoMerge); err != nil {
				fail(w, 500, err.Error())
				return
			}
			ok(w, map[string]bool{"auto_merge": x.r.AutoMerge()})
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

type workspaceInput struct {
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	Path   string   `json:"path"`
	Host   string   `json:"host"`
	OS     string   `json:"os"`
	Kind   string   `json:"kind"`
	Labels []string `json:"labels"`
	Note   string   `json:"note"`
}

type workspaceRecord struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Path      string   `json:"path"`
	Host      string   `json:"host"`
	OS        string   `json:"os"`
	Kind      string   `json:"kind"`
	Labels    []string `json:"labels"`
	Note      string   `json:"note"`
	Git       bool     `json:"git"`
	Status    string   `json:"status"`
	LatencyMs int64    `json:"latency_ms,omitempty"`
	CreatedAt int64    `json:"created_at"`
}

func joinLabels(labels []string) string {
	var clean []string
	seen := map[string]bool{}
	for _, l := range labels {
		t := strings.TrimSpace(l)
		if t != "" && !seen[t] {
			seen[t] = true
			clean = append(clean, t)
		}
	}
	return strings.Join(clean, ",")
}

func splitLabels(raw string) []string {
	out := []string{}
	for _, p := range strings.Split(raw, ",") {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func workspaceStatus(w workspaceRecord) string {
	if w.Host == "" || w.Host == "localhost" || w.Host == "127.0.0.1" {
		if _, err := os.Stat(w.Path); err == nil {
			return "local"
		}
		return "unreachable"
	}
	return "unknown"
}

func queryWorkspaces(a *API) ([]workspaceRecord, error) {
	rows, err := a.S.DB.Query(`SELECT id,name,path,host,os,kind,labels,note,created_at FROM dispatch_workspaces ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []workspaceRecord{}
	for rows.Next() {
		var w workspaceRecord
		var labelsRaw string
		if err := rows.Scan(&w.ID, &w.Name, &w.Path, &w.Host, &w.OS, &w.Kind, &labelsRaw, &w.Note, &w.CreatedAt); err != nil {
			return nil, err
		}
		w.Labels = splitLabels(labelsRaw)
		w.Git = dispatch.IsGit(w.Path) || w.Kind == "repo"
		w.Status = workspaceStatus(w)
		out = append(out, w)
	}
	return out, rows.Err()
}

func getWorkspaceByID(a *API, id string) (workspaceRecord, error) {
	var w workspaceRecord
	var labelsRaw string
	err := a.S.DB.QueryRow(
		`SELECT id,name,path,host,os,kind,labels,note,created_at FROM dispatch_workspaces WHERE id=?`,
		id,
	).Scan(&w.ID, &w.Name, &w.Path, &w.Host, &w.OS, &w.Kind, &labelsRaw, &w.Note, &w.CreatedAt)
	if err != nil {
		return workspaceRecord{}, err
	}
	w.Labels = splitLabels(labelsRaw)
	w.Git = dispatch.IsGit(w.Path) || w.Kind == "repo"
	w.Status = workspaceStatus(w)
	return w, nil
}

func pingWorkspaceRecord(a *API, w workspaceRecord) workspaceRecord {
	start := time.Now()
	if w.Host == "" || w.Host == "localhost" || w.Host == "127.0.0.1" {
		if _, err := os.Stat(w.Path); err == nil {
			w.Status = "local"
			w.Git = dispatch.IsGit(w.Path)
		} else {
			w.Status = "unreachable"
		}
		w.LatencyMs = time.Since(start).Milliseconds()
		if w.LatencyMs == 0 {
			w.LatencyMs = 1
		}
		return w
	}
	var workerURL string
	_ = a.S.DB.QueryRow(
		`SELECT url FROM dispatch_workers WHERE LOWER(name)=LOWER(?) OR LOWER(id)=LOWER(?) OR LOWER(url) LIKE ? LIMIT 1`,
		w.Host, w.Host, "%"+strings.ToLower(w.Host)+"%",
	).Scan(&workerURL)
	if workerURL != "" {
		client := &http.Client{Timeout: 2 * time.Second}
		resp, err := client.Get(strings.TrimRight(workerURL, "/") + "/healthz")
		w.LatencyMs = time.Since(start).Milliseconds()
		if err == nil && resp != nil {
			_ = resp.Body.Close()
			if resp.StatusCode < 500 {
				w.Status = "connected"
				return w
			}
		}
		w.Status = "unreachable"
		return w
	}
	w.Status = "unknown"
	return w
}

var _ = tasks.Todo
