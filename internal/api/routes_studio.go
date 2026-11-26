package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/worker"
)

func init() {
	registrars = append(registrars, func(m *http.ServeMux, a *API) {
		// ── Worktree Terminal Exec ────────────────────────────────────────────
		m.HandleFunc("POST /api/v1/tasks/{id}/terminal/exec", a.require("write", func(w http.ResponseWriter, r *http.Request) {
			taskID := r.PathValue("id")
			t, err := a.Tasks.Get(taskID)
			if err != nil {
				fromErr(w, err)
				return
			}
			var in struct {
				Command string `json:"command"`
				Cwd     string `json:"cwd"`
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				fail(w, 400, "invalid json")
				return
			}
			cmdStr := strings.TrimSpace(in.Command)
			if cmdStr == "" {
				fail(w, 400, "command required")
				return
			}
			cwd := strings.TrimSpace(in.Cwd)
			if cwd == "" {
				var wtPath string
				_ = a.S.DB.QueryRow(`SELECT path FROM task_worktrees WHERE task_id=?`, taskID).Scan(&wtPath)
				if wtPath != "" {
					cwd = wtPath
				} else {
					cwd = t.Workspace
				}
			}
			started := time.Now()
			ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
			defer cancel()

			if cwd != "" {
				if st, err := os.Stat(cwd); err == nil && st.IsDir() {
					cmd := exec.CommandContext(ctx, "sh", "-lc", cmdStr)
					cmd.Dir = cwd
					var stdout, stderr bytes.Buffer
					cmd.Stdout = &stdout
					cmd.Stderr = &stderr
					runErr := cmd.Run()
					exitCode := 0
					if runErr != nil {
						if ee, ok := runErr.(*exec.ExitError); ok {
							exitCode = ee.ExitCode()
						} else {
							exitCode = 1
						}
					}
					ok(w, map[string]any{
						"stdout":      stdout.String(),
						"stderr":      stderr.String(),
						"exit_code":   exitCode,
						"cwd":         cwd,
						"duration_ms": time.Since(started).Milliseconds(),
					})
					return
				}
			}
			wc := worker.New(os.Getenv("NODE_AGENT_URL"), os.Getenv("NODE_AGENT_TOKEN"))
			if wc != nil && wc.Enabled() && cwd != "" {
				out, runErr := wc.Shell(ctx, cwd, cmdStr)
				exitCode := 0
				errMsg := ""
				if runErr != nil {
					exitCode = 1
					errMsg = runErr.Error()
				}
				ok(w, map[string]any{
					"stdout":      out,
					"stderr":      errMsg,
					"exit_code":   exitCode,
					"cwd":         cwd,
					"duration_ms": time.Since(started).Milliseconds(),
				})
				return
			}
			fail(w, 400, "workspace directory not accessible locally or via worker")
		}))

		// ── Tunneled Live Preview Browser ─────────────────────────────────────
		previewHandler := a.require("read", func(w http.ResponseWriter, r *http.Request) {
			taskID := r.PathValue("id")
			portStr := r.PathValue("port")
			port, err := strconv.Atoi(portStr)
			if err != nil || port < 1 || port > 65535 {
				fail(w, 400, "invalid port")
				return
			}
			rest := "/" + strings.TrimPrefix(r.PathValue("rest"), "/")
			if r.URL.RawQuery != "" {
				rest += "?" + r.URL.RawQuery
			}

			var wtPath, transport string
			_ = a.S.DB.QueryRow(`SELECT path, transport FROM task_worktrees WHERE task_id=?`, taskID).Scan(&wtPath, &transport)
			t, _ := a.Tasks.Get(taskID)
			ws := wtPath
			if ws == "" {
				ws = t.Workspace
			}

			// If remote worker, tunnel via node-agent POST /api/rpc http_proxy.
			if transport == "worker" || (ws != "" && !dirExists(ws)) {
				if a.tunnelPreviewRemote(w, r, ws, port, rest) {
					return
				}
			}

			// Local reverse proxy to http://127.0.0.1:<port><rest>.
			targetURL := fmt.Sprintf("http://127.0.0.1:%d%s", port, rest)
			req, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL, r.Body)
			if err != nil {
				fail(w, 502, err.Error())
				return
			}
			client := &http.Client{Timeout: 10 * time.Second}
			resp, err := client.Do(req)
			if err != nil {
				fail(w, 502, fmt.Sprintf("preview localhost:%d unreachable: %v", port, err))
				return
			}
			defer resp.Body.Close()
			if ct := resp.Header.Get("Content-Type"); ct != "" {
				w.Header().Set("Content-Type", ct)
			}
			w.WriteHeader(resp.StatusCode)
			_, _ = io.Copy(w, io.LimitReader(resp.Body, 4<<20))
		})
		m.HandleFunc("GET /api/v1/preview/{id}/{port}", previewHandler)
		m.HandleFunc("GET /api/v1/preview/{id}/{port}/{rest...}", previewHandler)
	})
}

func dirExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

func (a *API) tunnelPreviewRemote(w http.ResponseWriter, r *http.Request, ws string, port int, path string) bool {
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("NODE_AGENT_URL")), "/")
	if base == "" {
		return false
	}
	payload, _ := json.Marshal(map[string]any{
		"method": r.Method,
		"port":   port,
		"path":   path,
	})
	rpcBody, _ := json.Marshal(map[string]any{
		"workspace":  ws,
		"op":         "http_proxy",
		"command":    string(payload),
		"timeout_ms": 10000,
	})
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, base+"/api/rpc", bytes.NewReader(rpcBody))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/json")
	if tok := strings.TrimSpace(os.Getenv("NODE_AGENT_TOKEN")); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return false
	}
	var rpcResp struct {
		Output string `json:"output"`
		Error  string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rpcResp); err != nil || rpcResp.Error != "" {
		return false
	}
	var proxied struct {
		Status      int    `json:"status"`
		ContentType string `json:"content_type"`
		BodyBase64  string `json:"body_base64"`
	}
	if err := json.Unmarshal([]byte(rpcResp.Output), &proxied); err != nil || proxied.Status == 0 {
		return false
	}
	raw, _ := base64.StdEncoding.DecodeString(proxied.BodyBase64)
	if proxied.ContentType != "" {
		w.Header().Set("Content-Type", proxied.ContentType)
	}
	w.WriteHeader(proxied.Status)
	_, _ = w.Write(raw)
	return true
}
