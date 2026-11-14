package api

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/catalog"
	"github.com/adityahimaone/switchyard-lite/internal/dispatch"
	"github.com/adityahimaone/switchyard-lite/internal/models"
	"github.com/adityahimaone/switchyard-lite/internal/nodes"
	"github.com/adityahimaone/switchyard-lite/internal/review"
	"github.com/adityahimaone/switchyard-lite/internal/skills"
	"github.com/adityahimaone/switchyard-lite/internal/tasks"
	"github.com/adityahimaone/switchyard-lite/internal/worker"
	"github.com/adityahimaone/switchyard-lite/internal/wsindex"
)

type dispatchDeps struct {
	d *dispatch.Dispatcher
	r *review.Service
	m *models.Catalog
	n *nodes.Registry
	c *catalog.Catalog
	s *skills.Registry
	x *wsindex.Index
	w *worker.Client
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
	deps[a] = buildDeps(a, d, r, d.Cfg)
}

func buildDeps(a *API, d *dispatch.Dispatcher, r *review.Service, cfg dispatch.Config) *dispatchDeps {
	w := worker.New(cfg.NodeAgentURL, cfg.Token)
	idx := wsindex.New()
	idx.SetRemote(w)
	r.SetRemote(w)
	return &dispatchDeps{
		d: d, r: r,
		m: models.New(cfg.NodeAgentURL, cfg.Token),
		n: nodes.New(cfg.NodeAgentURL, cfg.Token),
		c: catalog.New(cfg.NodeAgentURL, cfg.Token),
		s: skills.NewFromEnv(),
		x: idx, w: w,
	}
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
	x := buildDeps(a, d, r, cfg)
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
			list, err := queryWorkspaces(r.Context(), a, x.n, x.c)
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			ok(w, list)
		}))
		// The kanban-board live registry (node-agent's ~/.hermes/workspaces.json).
		// Read-only: it is the machine-identity source of truth used by the
		// overlay above, and the payload behind "Sync live workspaces".
		m.HandleFunc("GET /api/v1/workspaces/live", h("read", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			list, err := x.c.List(r.Context(), r.URL.Query().Get("refresh") == "1")
			if err != nil {
				fail(w, 502, err.Error())
				return
			}
			ok(w, map[string]any{"workspaces": list, "count": len(list)})
		}))
		m.HandleFunc("POST /api/v1/workspaces/sync", h("write", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			live, err := x.c.List(r.Context(), true)
			if err != nil {
				fail(w, 502, err.Error())
				return
			}
			imported, updated, err := syncLiveWorkspaces(a, live)
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			ok(w, map[string]any{"imported": imported, "updated": updated, "live": len(live)})
		}))
		m.HandleFunc("GET /api/v1/workspaces/inspect", h("read", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			p := strings.TrimSpace(r.URL.Query().Get("path"))
			st, _ := x.x.State(r.Context(), p, r.URL.Query().Get("refresh") == "1")
			var labelsRaw string
			_ = a.S.DB.QueryRow(`SELECT labels FROM dispatch_workspaces WHERE path=? LIMIT 1`, p).Scan(&labelsRaw)
			labels := splitLabels(labelsRaw)
			ok(w, map[string]any{
				"path": p, "is_git": st.IsGit, "branches": st.Branches,
				"current": st.Current, "warning": st.Warning, "hint": st.Hint,
				"local": st.Local, "source": st.Source,
				"repo_root": st.Info.Root, "git_prefix": st.Info.Prefix,
				"file_count": len(st.Files),
				"saas":       dispatch.IsSAASWorkspace(p, labels),
			})
		}))
		// Agent skills. The registry follows symlinks (npx skills add -g links
		// into ~/.claude/skills etc.) and decorates with `npx skills list` when
		// that CLI is available; the filesystem walk is always authoritative.
		m.HandleFunc("GET /api/v1/skills", h("read", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			list := x.s.List(r.URL.Query().Get("refresh") == "1")
			if q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q"))); q != "" {
				kept := make([]skills.Skill, 0, len(list))
				for _, s := range list {
					if strings.Contains(strings.ToLower(s.Name), q) || strings.Contains(strings.ToLower(s.Description), q) {
						kept = append(kept, s)
					}
				}
				list = kept
			}
			ok(w, map[string]any{"skills": list, "count": len(list)})
		}))
		m.HandleFunc("GET /api/v1/skills/content", h("read", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			name := strings.TrimSpace(r.URL.Query().Get("name"))
			content, err := x.s.Content(name)
			if err != nil {
				fail(w, 404, "skill not found")
				return
			}
			ok(w, map[string]string{"name": name, "content": content})
		}))
		// Workspace file search powers the @ omnibox. State resolves the list on
		// this host or on the owning worker, so remote workspaces get real
		// suggestions instead of the old "not indexed here" dead end.
		m.HandleFunc("GET /api/v1/workspaces/files", h("read", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			p := strings.TrimSpace(r.URL.Query().Get("path"))
			limit := worker.ParseLimit(r.URL.Query().Get("limit"), 20)
			if r.URL.Query().Get("refresh") == "1" {
				x.x.Invalidate(p)
			}
			files, hint, source, _ := x.x.FilesCtx(r.Context(), p, r.URL.Query().Get("q"), limit)
			ok(w, map[string]any{
				"path": p, "files": files, "hint": hint,
				"local": source == "local", "source": source,
			})
		}))
		m.HandleFunc("GET /api/v1/workspaces/branches", h("read", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			p := strings.TrimSpace(r.URL.Query().Get("path"))
			branches, current, warning, source, isGit, _ := x.x.BranchesCtx(r.Context(), p, r.URL.Query().Get("refresh") == "1")
			ok(w, map[string]any{
				"path": p, "branches": branches, "current": current,
				"warning": warning, "local": source == "local", "source": source,
				"is_git": isGit,
			})
		}))
		// Codegraph-style symbol suggestions for the @ omnibox, resolved on the
		// owning node so remote workspaces behave like kanban-board's composer.
		m.HandleFunc("GET /api/v1/workspaces/symbols", h("read", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			p := strings.TrimSpace(r.URL.Query().Get("path"))
			limit := worker.ParseLimit(r.URL.Query().Get("limit"), 8)
			symbols, err := x.x.SymbolsCtx(r.Context(), p, r.URL.Query().Get("q"), limit)
			if err != nil {
				fail(w, 502, err.Error())
				return
			}
			ok(w, map[string]any{"symbols": symbols, "count": len(symbols)})
		}))
		// Marker-file inferred verify/gate defaults (kanban-board parity). The
		// file list is already cached by State, so this needs no extra worker job.
		m.HandleFunc("GET /api/v1/workspaces/defaults", h("read", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			p := strings.TrimSpace(r.URL.Query().Get("path"))
			st, _ := x.x.State(r.Context(), p, false)
			gate, profile, markers := workspaceDefaults(st.Files)
			ok(w, map[string]any{
				"path": p, "suggested_gate_command": gate,
				"suggested_verify_profile": profile, "markers": markers,
			})
		}))
		m.HandleFunc("POST /api/v1/skills/refresh", h("write", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			list := x.s.List(true)
			ok(w, map[string]any{"skills": list, "count": len(list)})
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
			list, err := queryWorkspaces(r.Context(), a, x.n, x.c)
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			for i := range list {
				list[i] = pingWorkspaceRecord(r.Context(), a, x.n, x.c, list[i])
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
			ok(w, pingWorkspaceRecord(r.Context(), a, x.n, x.c, ws))
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
		m.HandleFunc("GET /api/v1/tasks/{id}/logs", h("read", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			id := r.PathValue("id")
			t, err := a.Tasks.Get(id)
			if err != nil {
				fromErr(w, err)
				return
			}
			var offset int64
			if raw := strings.TrimSpace(r.URL.Query().Get("offset")); raw != "" {
				if v, perr := strconv.ParseInt(raw, 10, 64); perr == nil && v >= 0 {
					offset = v
				}
			}
			text, nextOffset, err := dispatch.WorkerLogTail(x.d.WorkerLogDir(), id, offset)
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			if text == "" && nextOffset == 0 && offset == 0 && t.Result != "" {
				text = t.Result
				nextOffset = int64(len(t.Result))
			}
			ok(w, map[string]any{
				"text":    text,
				"offset":  nextOffset,
				"running": t.Status == tasks.InProgress,
			})
		}))
		m.HandleFunc("GET /api/v1/tasks/{id}/runs", h("read", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			id := r.PathValue("id")
			t, err := a.Tasks.Get(id)
			if err != nil {
				fromErr(w, err)
				return
			}
			var all []tasks.Event
			var since int64
			for len(all) < 5000 {
				batch, err := a.Tasks.Events(id, since, 500)
				if err != nil {
					fail(w, 500, err.Error())
					return
				}
				all = append(all, batch...)
				if len(batch) < 500 {
					break
				}
				since = batch[len(batch)-1].ID
			}
			runs := dispatch.GroupTaskRuns(all)
			if len(runs) == 0 && (t.StartedAt > 0 || t.Result != "" || t.ErrorSig != "") {
				status := string(t.Status)
				switch t.Status {
				case tasks.InProgress:
					status = "running"
				case tasks.Review, tasks.Done:
					status = "completed"
				}
				var durS, durMS int64
				if t.StartedAt > 0 && t.CompletedAt >= t.StartedAt {
					durS = t.CompletedAt - t.StartedAt
					durMS = durS * 1000
				}
				runs = append(runs, dispatch.TaskRun{
					Run:        1,
					Executor:   t.Executor,
					Model:      t.Model,
					Status:     status,
					StartedAt:  t.StartedAt,
					EndedAt:    t.CompletedAt,
					DurationS:  durS,
					DurationMS: durMS,
					Error:      t.ErrorSig,
					Output:     t.Result,
					Usage:      dispatch.UsageFromJSON(nil, t.Result),
				})
			}
			ok(w, map[string]any{"runs": runs})
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
		m.HandleFunc("POST /api/v1/tasks/{id}/retry", h("write", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			id := r.PathValue("id")
			t, err := a.Tasks.Get(id)
			if err != nil {
				fromErr(w, err)
				return
			}
			var in struct {
				Feedback     string `json:"feedback"`
				Prompt       string `json:"prompt"`
				ResetRetries *bool  `json:"reset_retries"`
				DispatchNow  *bool  `json:"dispatch_now"`
			}
			_ = json.NewDecoder(r.Body).Decode(&in)
			if fb := strings.TrimSpace(in.Feedback); fb != "" {
				_, _ = a.Tasks.AddComment(id, "retry", fb)
			}
			if extra := strings.TrimSpace(in.Prompt); extra != "" {
				merged := strings.TrimSpace(t.Prompt)
				if merged != "" {
					merged += "\n\n" + extra
				} else {
					merged = extra
				}
				_, _ = a.Tasks.Update(id, tasks.Patch{Prompt: &merged})
			}
			resetRetries := in.ResetRetries == nil || *in.ResetRetries
			if resetRetries {
				_, _ = a.S.DB.Exec(`UPDATE tasks SET retry_count=0, error_sig='' WHERE id=?`, id)
			} else {
				_, _ = a.S.DB.Exec(`UPDATE tasks SET error_sig='' WHERE id=?`, id)
			}
			_, _ = a.S.DB.Exec(`DELETE FROM dispatch_claims WHERE task_id=?`, id)
			if t.Status != tasks.Todo {
				if _, err := a.Tasks.Move(id, tasks.Todo, "retry"); err != nil {
					fromErr(w, err)
					return
				}
			}
			_ = a.Tasks.RecordEvent(id, "retried", map[string]any{"feedback": strings.TrimSpace(in.Feedback)})
			dispatchNow := in.DispatchNow == nil || *in.DispatchNow
			var runID string
			if dispatchNow && t.ExecutionMode != tasks.ExecTracker {
				if rid, serr := x.d.Start(context.Background(), id); serr == nil {
					runID = rid
				} else {
					x.d.Wake()
				}
			} else {
				x.d.Wake()
			}
			updated, _ := a.Tasks.Get(id)
			ok(w, map[string]any{"task": updated, "run_id": runID})
		}))
		startTracker := h("write", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			var in struct {
				ID         string   `json:"id"`
				BoardID    string   `json:"board_id"`
				Title      string   `json:"title"`
				Prompt     string   `json:"prompt"`
				Acceptance string   `json:"acceptance"`
				Workspace  string   `json:"workspace"`
				Executor   string   `json:"executor"`
				Model      string   `json:"model"`
				SessionID  string   `json:"session_id"`
				Paths      []string `json:"paths"`
				Skills     []string `json:"skills"`
			}
			_ = json.NewDecoder(r.Body).Decode(&in)
			id := strings.TrimSpace(r.PathValue("id"))
			if id == "" {
				id = strings.TrimSpace(in.ID)
			}
			if id == "" {
				created, err := a.Tasks.Create(tasks.NewTask{
					BoardID:       in.BoardID,
					Title:         in.Title,
					Prompt:        in.Prompt,
					Acceptance:    in.Acceptance,
					Status:        tasks.InProgress,
					Workspace:     in.Workspace,
					Executor:      firstNonEmpty(in.Executor, "external"),
					Model:         in.Model,
					ExecutionMode: tasks.ExecTracker,
					SessionID:     in.SessionID,
					Paths:         in.Paths,
					Skills:        in.Skills,
				})
				if err != nil {
					fromErr(w, err)
					return
				}
				id = created.ID
			} else {
				if _, err := a.Tasks.Get(id); err != nil {
					fromErr(w, err)
					return
				}
				mode := tasks.ExecTracker
				patch := tasks.Patch{ExecutionMode: &mode}
				if in.Executor != "" {
					patch.Executor = &in.Executor
				}
				if in.Model != "" {
					patch.Model = &in.Model
				}
				if in.Workspace != "" {
					patch.Workspace = &in.Workspace
				}
				_, _ = a.Tasks.Update(id, patch)
				if in.SessionID != "" {
					_, _ = a.S.DB.Exec(`UPDATE tasks SET session_id=? WHERE id=?`, in.SessionID, id)
				}
				_, _ = a.Tasks.Move(id, tasks.InProgress, "tracker")
			}
			now := time.Now().Unix()
			_, _ = a.S.DB.Exec(`DELETE FROM dispatch_claims WHERE task_id=?`, id)
			_, _ = a.S.DB.Exec(`UPDATE tasks SET execution_mode='tracker', started_at=CASE WHEN started_at=0 THEN ? ELSE started_at END, updated_at=? WHERE id=?`, now, now, id)
			_ = dispatch.ResetWorkerLog(x.d.WorkerLogDir(), id)
			t, err := a.Tasks.Get(id)
			if err != nil {
				fromErr(w, err)
				return
			}
			runID := "track_" + id
			_ = a.Tasks.RecordEvent(id, "claimed", map[string]any{
				"run_id":         runID,
				"worker_id":      "external-tracker",
				"executor":       firstNonEmpty(t.Executor, "external"),
				"model":          t.Model,
				"session_id":     t.SessionID,
				"execution_mode": "tracker",
			})
			_ = a.Tasks.RecordEvent(id, "tracker.started", map[string]any{
				"executor":   firstNonEmpty(t.Executor, "external"),
				"session_id": t.SessionID,
			})
			ok(w, t)
		})
		m.HandleFunc("POST /api/v1/tasks/track/start", startTracker)
		m.HandleFunc("POST /api/v1/tasks/{id}/track/start", startTracker)
		m.HandleFunc("POST /api/v1/tasks/{id}/track/progress", h("write", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			id := r.PathValue("id")
			t, err := a.Tasks.Get(id)
			if err != nil {
				fromErr(w, err)
				return
			}
			var in struct {
				Text    string `json:"text"`
				Step    string `json:"step"`
				Percent *int   `json:"percent"`
				Author  string `json:"author"`
				Comment bool   `json:"comment"`
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				fail(w, 400, "invalid json")
				return
			}
			line := in.Text
			if line == "" && in.Step != "" {
				line = in.Step
			}
			if line != "" {
				chunk := line
				if !strings.HasSuffix(chunk, "\n") {
					chunk += "\n"
				}
				_ = dispatch.AppendWorkerLog(x.d.WorkerLogDir(), id, chunk)
				_ = a.Tasks.RecordEvent(id, "worker_output", map[string]any{
					"run_id": "track_" + id,
					"output": chunk,
				})
			}
			if in.Step != "" || in.Percent != nil {
				payload := map[string]any{"step": in.Step}
				if in.Percent != nil {
					payload["percent"] = *in.Percent
				}
				_ = a.Tasks.RecordEvent(id, "agent.progress", payload)
			}
			if in.Comment && strings.TrimSpace(line) != "" {
				_, _ = a.Tasks.AddComment(id, firstNonEmpty(in.Author, firstNonEmpty(t.Executor, "tracker")), strings.TrimSpace(line))
			}
			_, _ = a.S.DB.Exec(`UPDATE tasks SET updated_at=? WHERE id=?`, time.Now().Unix(), id)
			ok(w, map[string]any{"ok": true, "task_id": id})
		}))
		m.HandleFunc("POST /api/v1/tasks/{id}/track/complete", h("write", func(w http.ResponseWriter, r *http.Request, x *dispatchDeps) {
			id := r.PathValue("id")
			t, err := a.Tasks.Get(id)
			if err != nil {
				fromErr(w, err)
				return
			}
			var in struct {
				Status    string         `json:"status"`
				Output    string         `json:"output"`
				Error     string         `json:"error"`
				SessionID string         `json:"session_id"`
				Usage     map[string]any `json:"usage"`
			}
			_ = json.NewDecoder(r.Body).Decode(&in)
			targetStatus := strings.TrimSpace(in.Status)
			if targetStatus == "" {
				if strings.TrimSpace(in.Error) != "" {
					targetStatus = tasks.Failed
				} else {
					targetStatus = tasks.Done
				}
			}
			switch targetStatus {
			case tasks.Done, tasks.Review, tasks.Failed:
			default:
				fail(w, 400, "status must be done, review, or failed")
				return
			}
			now := time.Now().Unix()
			if in.Output != "" {
				chunk := in.Output
				if !strings.HasSuffix(chunk, "\n") {
					chunk += "\n"
				}
				_ = dispatch.AppendWorkerLog(x.d.WorkerLogDir(), id, chunk)
				_ = a.Tasks.RecordEvent(id, "worker_output", map[string]any{
					"run_id": "track_" + id,
					"output": chunk,
				})
				_, _ = a.Tasks.AddComment(id, firstNonEmpty(t.Executor, "tracker"), in.Output)
			}
			sid := firstNonEmpty(in.SessionID, t.SessionID)
			_, _ = a.S.DB.Exec(`UPDATE tasks SET execution_mode='tracker', result=?, error_sig=?, session_id=?, completed_at=?, updated_at=? WHERE id=?`,
				in.Output, in.Error, sid, now, now, id)
			kind := "completed"
			payload := map[string]any{
				"run_id":     "track_" + id,
				"worker_id":  "external-tracker",
				"executor":   firstNonEmpty(t.Executor, "external"),
				"model":      t.Model,
				"session_id": sid,
				"output":     in.Output,
			}
			if len(in.Usage) > 0 {
				payload["usage"] = in.Usage
			}
			if targetStatus == tasks.Failed {
				kind = "failed"
				payload["error"] = firstNonEmpty(in.Error, "external run failed")
			}
			_ = a.Tasks.RecordEvent(id, kind, payload)
			updated, merr := a.Tasks.Move(id, targetStatus, "tracker")
			if merr != nil {
				fromErr(w, merr)
				return
			}
			ok(w, updated)
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
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	Path   string   `json:"path"`
	Host   string   `json:"host"`
	OS     string   `json:"os"`
	Kind   string   `json:"kind"`
	Labels []string `json:"labels"`
	Note   string   `json:"note"`
	Git    bool     `json:"git"`
	Status string   `json:"status"`
	// Node / Hostname come from the node-agent's live report and say which
	// machine can actually serve this path. Empty when nothing claims it.
	Node     string `json:"node,omitempty"`
	Hostname string `json:"hostname,omitempty"`
	// Machine is the resolved platform (mac / windows / current / linux).
	// It is derived from the live kanban-board registry, the node report and
	// finally the path shape — never from a stale "mac: " name prefix.
	Machine string `json:"machine,omitempty"`
	// Live marks a workspace found in kanban-board's workspaces.json.
	Live      bool   `json:"live,omitempty"`
	LiveID    string `json:"live_id,omitempty"`
	Source    string `json:"source,omitempty"`
	LatencyMs int64  `json:"latency_ms,omitempty"`
	CreatedAt int64  `json:"created_at"`
}

// syncLiveWorkspaces imports the kanban-board registry into the local table.
// Existing rows keep their id and any user-authored name; stale "mac: " names
// and missing os/host/labels are repaired from the live record.
func syncLiveWorkspaces(a *API, live []catalog.Workspace) (imported, updated int, err error) {
	type row struct{ id, name, path, host, os, kind, labels string }
	rows, err := a.S.DB.Query(`SELECT id,name,path,host,os,kind,labels FROM dispatch_workspaces`)
	if err != nil {
		return 0, 0, err
	}
	existing := map[string]row{}
	for rows.Next() {
		var v row
		if err := rows.Scan(&v.id, &v.name, &v.path, &v.host, &v.os, &v.kind, &v.labels); err != nil {
			rows.Close()
			return 0, 0, err
		}
		existing[catalog.Normalize(v.path)] = v
	}
	rows.Close()

	for _, lw := range live {
		key := catalog.Normalize(lw.Path)
		if key == "" {
			continue
		}
		if cur, found := existing[key]; found {
			name := cur.name
			if catalog.HasStalePrefix(name) && strings.TrimSpace(lw.Name) != "" {
				name = strings.TrimSpace(lw.Name)
			}
			osName := cur.os
			if osName == "" || (lw.OS != "" && catalog.MachineFor(cur.path, cur.os, cur.host, "") != catalog.MachineOf(lw)) {
				osName = lw.OS
			}
			host := cur.host
			if host == "" {
				host = lw.Host
			}
			labels := cur.labels
			if labels == "" && len(lw.Labels) > 0 {
				labels = joinLabels(lw.Labels)
			}
			kind := cur.kind
			if (kind == "" || kind == "dir") && lw.Kind != "" {
				kind = lw.Kind
			}
			res, e := a.S.DB.Exec(
				`UPDATE dispatch_workspaces SET name=?, host=?, os=?, kind=?, labels=? WHERE id=?`,
				name, host, osName, kind, labels, cur.id,
			)
			if e != nil {
				return imported, updated, e
			}
			if n, _ := res.RowsAffected(); n > 0 {
				updated++
			}
			continue
		}
		id := strings.TrimSpace(lw.ID)
		if id == "" {
			sum := sha256.Sum256([]byte(key))
			id = "ws_" + hex.EncodeToString(sum[:])[:12]
		}
		name := strings.TrimSpace(lw.Name)
		if name == "" {
			name = catalog.CleanName("", lw.Path)
		}
		_, e := a.S.DB.Exec(
			`INSERT OR IGNORE INTO dispatch_workspaces(id,name,path,host,os,kind,labels,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
			id, name, strings.TrimSpace(lw.Path), lw.Host, lw.OS, firstNonEmpty(lw.Kind, "dir"), joinLabels(lw.Labels), lw.Note, time.Now().Unix(),
		)
		if e != nil {
			return imported, updated, e
		}
		existing[key] = row{id: id, path: lw.Path, name: name, host: lw.Host, os: lw.OS, kind: lw.Kind, labels: joinLabels(lw.Labels)}
		imported++
	}
	return imported, updated, nil
}

func firstNonEmpty(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return b
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

// applyLiveMetadata overlays kanban-board's live workspaces.json onto a local
// row. Imported rows carry no os/host/labels and often a wrong "mac: " name;
// the live registry is the source of truth for machine identity. User edits
// (a custom name, an explicit os) are preserved unless they contradict the
// path shape, which is unambiguous.
func applyLiveMetadata(w *workspaceRecord, live []catalog.Workspace) {
	machine := catalog.MachineFor(w.Path, w.OS, w.Host, "")
	if rec, found := catalog.Match(live, w.Path); found {
		w.Live, w.LiveID, w.Source = true, rec.ID, "kanban-board"
		if rec.Name != "" && (catalog.HasStalePrefix(w.Name) || w.Name == w.Path || w.Name == catalog.CleanName("", w.Path)) {
			w.Name = rec.Name
		}
		if rec.OS != "" && (w.OS == "" || catalog.MachineFor(w.Path, w.OS, w.Host, "") != machine) {
			w.OS = rec.OS
		}
		if rec.Host != "" && w.Host == "" {
			w.Host = rec.Host
		}
		if len(rec.Labels) > 0 && len(w.Labels) == 0 {
			w.Labels = append([]string(nil), rec.Labels...)
		}
		if rec.Kind != "" && (w.Kind == "" || w.Kind == "dir") {
			w.Kind = rec.Kind
		}
		machine = catalog.MachineFor(w.Path, w.OS, w.Host, "")
	} else {
		w.Source = "local"
		if catalog.HasStalePrefix(w.Name) {
			w.Name = catalog.CleanName(w.Name, w.Path)
		}
	}
	w.Machine = machine
}

// resolveWorkspace decides machine attribution and liveness. A path that
// exists on the control plane is local; otherwise the node-agent heartbeat
// is authoritative, because stat() on the control plane cannot see a remote
// Mac/Windows checkout.
func resolveWorkspace(w *workspaceRecord, list []nodes.Node, live []catalog.Workspace, now time.Time) {
	applyLiveMetadata(w, live)
	w.Git = dispatch.IsGit(w.Path) || w.Kind == "repo"
	if w.Machine == "current" {
		if _, err := os.Stat(w.Path); err == nil {
			w.Status = "local"
			return
		}
	}
	if len(list) > 0 {
		if n, _ := nodes.Find(list, w.Path, w.Machine); n.NodeID != "" {
			w.Node, w.Hostname = n.NodeID, n.Hostname
			if n.Fresh(now) {
				w.Status = "connected"
			} else {
				w.Status = "unreachable"
			}
			return
		}
	}
	w.Status = workspaceStatus(*w)
}

func queryWorkspaces(ctx context.Context, a *API, reg *nodes.Registry, cat *catalog.Catalog) ([]workspaceRecord, error) {
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
		out = append(out, w)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	live, _ := cat.List(ctx, false)
	list, _ := reg.List(ctx)
	now := time.Now()
	for i := range out {
		resolveWorkspace(&out[i], list, live, now)
	}
	return out, nil
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

func pingWorkspaceRecord(ctx context.Context, a *API, reg *nodes.Registry, cat *catalog.Catalog, w workspaceRecord) workspaceRecord {
	start := time.Now()
	live, _ := cat.List(ctx, false)
	list, _ := reg.List(ctx)
	resolveWorkspace(&w, list, live, time.Now())
	if w.Status != "unknown" {
		w.LatencyMs = max(1, time.Since(start).Milliseconds())
		return w
	}

	if w.Host == "" || w.Host == "localhost" || w.Host == "127.0.0.1" {
		w.LatencyMs = max(1, time.Since(start).Milliseconds())
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
		w.LatencyMs = max(1, time.Since(start).Milliseconds())
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

// workspaceDefaults infers the usual verify gate from marker files. It mirrors
// kanban-board's /workspaces/{id}/defaults without needing a second index.
func workspaceDefaults(files []string) (gate, profile string, markers []string) {
	markers = []string{}
	has := func(name string) bool {
		for _, f := range files {
			base := strings.ToLower(f[strings.LastIndexAny(f, "/\\")+1:])
			if base == name {
				return true
			}
		}
		return false
	}
	checks := []struct{ file, gate, profile string }{
		{"go.mod", "go test ./...", "go"},
		{"package.json", "npm test", "node"},
		{"pyproject.toml", "pytest", "python"},
		{"requirements.txt", "pytest", "python"},
		{"pom.xml", "mvn test", "java"},
		{"cargo.toml", "cargo test", "rust"},
		{"makefile", "make test", "make"},
	}
	for _, c := range checks {
		if has(c.file) {
			markers = append(markers, c.file)
			if gate == "" {
				gate, profile = c.gate, c.profile
			}
		}
	}
	if gate == "" {
		gate = "manual review"
		profile = "manual"
	}
	return gate, profile, markers
}

var _ = tasks.Todo
