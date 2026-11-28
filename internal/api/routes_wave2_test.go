package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/adityahimaone/switchyard-studio/internal/store"
)

func TestWave2MCPRegistryAndTerminalExec(t *testing.T) {
	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	a := New(s)
	tok, err := CreateToken(s, "test-admin", "admin")
	if err != nil {
		t.Fatal(err)
	}
	h := a.Handler()
	req := func(method, url string, body *bytes.Buffer) *http.Request {
		var r *http.Request
		if body != nil {
			r = httptest.NewRequest(method, url, body)
		} else {
			r = httptest.NewRequest(method, url, nil)
		}
		r.Header.Set("Authorization", "Bearer "+tok)
		return r
	}

	// 1. Create MCP server
	createBody := bytes.NewBufferString(`{"name":"context7","transport":"stdio","command":"npx","args":["-y","@upstash/context7-mcp"]}`)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req(http.MethodPost, "/api/v1/mcps", createBody))
	if rec.Code != 201 {
		t.Fatalf("create mcp status=%d body=%s", rec.Code, rec.Body.String())
	}
	var created MCPServer
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil || created.ID == "" {
		t.Fatalf("bad mcp response: %s", rec.Body.String())
	}

	// 2. List MCP servers
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req(http.MethodGet, "/api/v1/mcps", nil))
	if rec.Code != 200 || !bytes.Contains(rec.Body.Bytes(), []byte("context7")) {
		t.Fatalf("list mcps failed: %d %s", rec.Code, rec.Body.String())
	}

	// 3. Create board + task with mcps + local temp workspace and test terminal/exec
	wsDir := t.TempDir()
	_ = os.WriteFile(filepath.Join(wsDir, "hello.txt"), []byte("studio"), 0o644)

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req(http.MethodPost, "/api/v1/boards", bytes.NewBufferString(`{"name":"Studio","emoji":"🚀"}`)))
	var board struct {
		ID    string `json:"id"`
		Emoji string `json:"emoji"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &board)
	if board.Emoji != "🚀" {
		t.Fatalf("expected board emoji 🚀, got %q", board.Emoji)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req(http.MethodPatch, "/api/v1/boards/"+board.ID, bytes.NewBufferString(`{"name":"Studio","emoji":"⚡"}`)))
	if rec.Code != 200 || !bytes.Contains(rec.Body.Bytes(), []byte("⚡")) {
		t.Fatalf("patch board emoji failed: %d %s", rec.Code, rec.Body.String())
	}

	taskPayload, _ := json.Marshal(map[string]any{
		"board_id":  board.ID,
		"title":     "Test MCP + Terminal",
		"workspace": wsDir,
		"mcps":      []string{created.ID},
	})
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req(http.MethodPost, "/api/v1/tasks", bytes.NewBuffer(taskPayload)))
	if rec.Code != 201 {
		t.Fatalf("create task failed: %d %s", rec.Code, rec.Body.String())
	}
	var task struct {
		ID   string   `json:"id"`
		MCPs []string `json:"mcps"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &task)
	if len(task.MCPs) != 1 || task.MCPs[0] != created.ID {
		t.Fatalf("expected task.mcps=[%s], got %v", created.ID, task.MCPs)
	}

	// 4. Execute command in worktree terminal
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req(http.MethodPost, "/api/v1/tasks/"+task.ID+"/terminal/exec", bytes.NewBufferString(`{"command":"cat hello.txt"}`)))
	if rec.Code != 200 {
		t.Fatalf("terminal exec failed: %d %s", rec.Code, rec.Body.String())
	}
	var termResp struct {
		Stdout   string `json:"stdout"`
		ExitCode int    `json:"exit_code"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &termResp)
	if termResp.ExitCode != 0 || termResp.Stdout != "studio" {
		t.Fatalf("unexpected terminal output: %+v", termResp)
	}
}
