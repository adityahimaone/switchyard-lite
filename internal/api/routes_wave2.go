package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/worker"
)

type MCPServer struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Transport string            `json:"transport"`
	Command   string            `json:"command,omitempty"`
	Args      []string          `json:"args,omitempty"`
	URL       string            `json:"url,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
	Enabled   bool              `json:"enabled"`
	CreatedAt int64             `json:"created_at"`
	UpdatedAt int64             `json:"updated_at"`
}

func init() {
	registrars = append(registrars, func(m *http.ServeMux, a *API) {
		// ── Unified MCP Registry ──────────────────────────────────────────────
		m.HandleFunc("GET /api/v1/mcps", a.require("read", func(w http.ResponseWriter, r *http.Request) {
			rows, err := a.S.DB.Query(`SELECT id,name,transport,command,args_json,url,env_json,enabled,created_at,updated_at FROM mcp_servers ORDER BY name`)
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			defer rows.Close()
			out := []MCPServer{}
			for rows.Next() {
				var s MCPServer
				var argsRaw, envRaw string
				var en int
				if rows.Scan(&s.ID, &s.Name, &s.Transport, &s.Command, &argsRaw, &s.URL, &envRaw, &en, &s.CreatedAt, &s.UpdatedAt) == nil {
					s.Enabled = en == 1
					_ = json.Unmarshal([]byte(argsRaw), &s.Args)
					_ = json.Unmarshal([]byte(envRaw), &s.Env)
					out = append(out, s)
				}
			}
			ok(w, out)
		}))

		m.HandleFunc("POST /api/v1/mcps", a.require("write", func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				Name      string            `json:"name"`
				Transport string            `json:"transport"`
				Command   string            `json:"command"`
				Args      []string          `json:"args"`
				URL       string            `json:"url"`
				Env       map[string]string `json:"env"`
				Enabled   *bool             `json:"enabled"`
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				fail(w, 400, "invalid json")
				return
			}
			in.Name = strings.TrimSpace(in.Name)
			if in.Name == "" {
				fail(w, 400, "name required")
				return
			}
			if strings.TrimSpace(in.Transport) == "" {
				if strings.TrimSpace(in.URL) != "" {
					in.Transport = "http"
				} else {
					in.Transport = "stdio"
				}
			}
			en := 1
			if in.Enabled != nil && !*in.Enabled {
				en = 0
			}
			var rb [4]byte
			_, _ = rand.Read(rb[:])
			id := "mcp_" + hex.EncodeToString(rb[:])
			now := time.Now().Unix()
			argsB, _ := json.Marshal(in.Args)
			if len(in.Args) == 0 {
				argsB = []byte("[]")
			}
			envB, _ := json.Marshal(in.Env)
			if len(in.Env) == 0 {
				envB = []byte("{}")
			}
			_, err := a.S.DB.Exec(`INSERT INTO mcp_servers(id,name,transport,command,args_json,url,env_json,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
				id, in.Name, in.Transport, strings.TrimSpace(in.Command), string(argsB), strings.TrimSpace(in.URL), string(envB), en, now, now)
			if err != nil {
				fail(w, 409, err.Error())
				return
			}
			w.WriteHeader(201)
			ok(w, MCPServer{
				ID: id, Name: in.Name, Transport: in.Transport, Command: strings.TrimSpace(in.Command),
				Args: in.Args, URL: strings.TrimSpace(in.URL), Env: in.Env, Enabled: en == 1,
				CreatedAt: now, UpdatedAt: now,
			})
		}))

		m.HandleFunc("PATCH /api/v1/mcps/{id}", a.require("write", func(w http.ResponseWriter, r *http.Request) {
			id := r.PathValue("id")
			var in struct {
				Name      *string           `json:"name"`
				Transport *string           `json:"transport"`
				Command   *string           `json:"command"`
				Args      []string          `json:"args"`
				URL       *string           `json:"url"`
				Env       map[string]string `json:"env"`
				Enabled   *bool             `json:"enabled"`
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				fail(w, 400, "invalid json")
				return
			}
			var cur MCPServer
			var argsRaw, envRaw string
			var en int
			if err := a.S.DB.QueryRow(`SELECT id,name,transport,command,args_json,url,env_json,enabled,created_at,updated_at FROM mcp_servers WHERE id=?`, id).
				Scan(&cur.ID, &cur.Name, &cur.Transport, &cur.Command, &argsRaw, &cur.URL, &envRaw, &en, &cur.CreatedAt, &cur.UpdatedAt); err != nil {
				fail(w, 404, "mcp server not found")
				return
			}
			cur.Enabled = en == 1
			_ = json.Unmarshal([]byte(argsRaw), &cur.Args)
			_ = json.Unmarshal([]byte(envRaw), &cur.Env)
			if in.Name != nil && strings.TrimSpace(*in.Name) != "" {
				cur.Name = strings.TrimSpace(*in.Name)
			}
			if in.Transport != nil && strings.TrimSpace(*in.Transport) != "" {
				cur.Transport = strings.TrimSpace(*in.Transport)
			}
			if in.Command != nil {
				cur.Command = strings.TrimSpace(*in.Command)
			}
			if in.Args != nil {
				cur.Args = in.Args
			}
			if in.URL != nil {
				cur.URL = strings.TrimSpace(*in.URL)
			}
			if in.Env != nil {
				cur.Env = in.Env
			}
			if in.Enabled != nil {
				cur.Enabled = *in.Enabled
			}
			enVal := 0
			if cur.Enabled {
				enVal = 1
			}
			argsB, _ := json.Marshal(cur.Args)
			envB, _ := json.Marshal(cur.Env)
			cur.UpdatedAt = time.Now().Unix()
			if _, err := a.S.DB.Exec(`UPDATE mcp_servers SET name=?,transport=?,command=?,args_json=?,url=?,env_json=?,enabled=?,updated_at=? WHERE id=?`,
				cur.Name, cur.Transport, cur.Command, string(argsB), cur.URL, string(envB), enVal, cur.UpdatedAt, id); err != nil {
				fail(w, 409, err.Error())
				return
			}
			ok(w, cur)
		}))

		m.HandleFunc("DELETE /api/v1/mcps/{id}", a.require("write", func(w http.ResponseWriter, r *http.Request) {
			res, err := a.S.DB.Exec(`DELETE FROM mcp_servers WHERE id=?`, r.PathValue("id"))
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			if n, _ := res.RowsAffected(); n == 0 {
				fail(w, 404, "mcp server not found")
				return
			}
			w.WriteHeader(204)
		}))

		// ── Live Git Switcher (via Lane A Control RPC or Local) ───────────────
		m.HandleFunc("POST /api/v1/workspaces/{id}/git/checkout", a.require("write", func(w http.ResponseWriter, r *http.Request) {
			wsPath, err := a.workspacePathByID(r.PathValue("id"))
			if err != nil {
				fail(w, 404, "workspace not found")
				return
			}
			var in struct {
				Branch string `json:"branch"`
				Create bool   `json:"create"`
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				fail(w, 400, "invalid json")
				return
			}
			branch := strings.TrimSpace(in.Branch)
			if branch == "" {
				fail(w, 400, "branch required")
				return
			}
			argv := []string{"git", "checkout", branch}
			if in.Create {
				argv = []string{"git", "checkout", "-b", branch}
			}
			out, err := a.execInWorkspace(r.Context(), wsPath, argv)
			if err != nil {
				fail(w, 409, strings.TrimSpace(out+" "+err.Error()))
				return
			}
			ok(w, map[string]any{"ok": true, "branch": branch, "output": strings.TrimSpace(out)})
		}))

		m.HandleFunc("POST /api/v1/workspaces/{id}/git/pull", a.require("write", func(w http.ResponseWriter, r *http.Request) {
			wsPath, err := a.workspacePathByID(r.PathValue("id"))
			if err != nil {
				fail(w, 404, "workspace not found")
				return
			}
			out, err := a.execInWorkspace(r.Context(), wsPath, []string{"git", "pull", "--ff-only"})
			if err != nil {
				fail(w, 409, strings.TrimSpace(out+" "+err.Error()))
				return
			}
			ok(w, map[string]any{"ok": true, "output": strings.TrimSpace(out)})
		}))

		// ── CodeGraph Status, Query & Sync ────────────────────────────────────
		m.HandleFunc("GET /api/v1/workspaces/{id}/codegraph/status", a.require("read", func(w http.ResponseWriter, r *http.Request) {
			wsPath, err := a.workspacePathByID(r.PathValue("id"))
			if err != nil {
				fail(w, 404, "workspace not found")
				return
			}
			out, err := a.execInWorkspace(r.Context(), wsPath, []string{"codegraph", "status"})
			if err != nil {
				ok(w, map[string]any{"available": false, "status": "unavailable", "detail": strings.TrimSpace(out)})
				return
			}
			ok(w, map[string]any{"available": true, "status": "ready", "detail": strings.TrimSpace(out)})
		}))

		m.HandleFunc("GET /api/v1/workspaces/{id}/codegraph/query", a.require("read", func(w http.ResponseWriter, r *http.Request) {
			wsPath, err := a.workspacePathByID(r.PathValue("id"))
			if err != nil {
				fail(w, 404, "workspace not found")
				return
			}
			q := strings.TrimSpace(r.URL.Query().Get("q"))
			if q == "" {
				ok(w, map[string]any{"source": "codegraph", "items": []any{}})
				return
			}
			out, err := a.execInWorkspace(r.Context(), wsPath, []string{"codegraph", "query", q})
			if err == nil && strings.TrimSpace(out) != "" {
				lines := strings.Split(strings.TrimSpace(out), "\n")
				items := make([]map[string]string, 0, len(lines))
				for _, ln := range lines {
					ln = strings.TrimSpace(ln)
					if ln != "" {
						items = append(items, map[string]string{"label": ln, "kind": "symbol"})
					}
					if len(items) >= 25 {
						break
					}
				}
				ok(w, map[string]any{"source": "codegraph", "items": items})
				return
			}
			// Graceful fallback: local filepath match when codegraph CLI isn't present.
			items := fallbackSearchWorkspace(wsPath, q, 20)
			ok(w, map[string]any{"source": "fallback", "items": items})
		}))

		m.HandleFunc("POST /api/v1/workspaces/{id}/codegraph/sync", a.require("write", func(w http.ResponseWriter, r *http.Request) {
			wsPath, err := a.workspacePathByID(r.PathValue("id"))
			if err != nil {
				fail(w, 404, "workspace not found")
				return
			}
			out, err := a.execInWorkspace(r.Context(), wsPath, []string{"codegraph", "sync"})
			if err != nil {
				fail(w, 502, strings.TrimSpace(out+" "+err.Error()))
				return
			}
			ok(w, map[string]any{"ok": true, "output": strings.TrimSpace(out)})
		}))
	})
}

func (a *API) workspacePathByID(id string) (string, error) {
	var p string
	err := a.S.DB.QueryRow(`SELECT path FROM dispatch_workspaces WHERE id=?`, id).Scan(&p)
	return p, err
}

func (a *API) execInWorkspace(ctx context.Context, wsPath string, argv []string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if st, err := os.Stat(wsPath); err == nil && st.IsDir() {
		cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
		cmd.Dir = wsPath
		out, err := cmd.CombinedOutput()
		return string(out), err
	}
	wc := worker.New(os.Getenv("NODE_AGENT_URL"), os.Getenv("NODE_AGENT_TOKEN"))
	if wc != nil && wc.Enabled() {
		return wc.ExecArgv(ctx, wsPath, argv)
	}
	return "", os.ErrNotExist
}

func fallbackSearchWorkspace(wsPath, q string, limit int) []map[string]string {
	out := []map[string]string{}
	st, err := os.Stat(wsPath)
	if err != nil || !st.IsDir() {
		return out
	}
	ql := strings.ToLower(q)
	_ = filepath.WalkDir(wsPath, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			name := d.Name()
			if name == ".git" || name == "node_modules" || name == "dist" || name == ".next" {
				return filepath.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(wsPath, p)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if strings.Contains(strings.ToLower(rel), ql) {
			out = append(out, map[string]string{"label": rel, "kind": "file"})
			if len(out) >= limit {
				return filepath.SkipAll
			}
		}
		return nil
	})
	return out
}
