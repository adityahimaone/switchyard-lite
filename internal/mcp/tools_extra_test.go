package mcp

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestExtraToolsRouteMapping(t *testing.T) {
	var mu sync.Mutex
	var hits []string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body [4096]byte
		n, _ := r.Body.Read(body[:])
		mu.Lock()
		hits = append(hits, r.Method+" "+r.URL.RequestURI()+" "+string(body[:n]))
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer ts.Close()

	cs := connect(t, NewHTTPBackend(ts.URL, "tok"))
	ctx := context.Background()

	calls := []struct {
		name string
		args map[string]any
		want string
	}{
		{
			name: "start_tracked_task",
			args: map[string]any{"board_id": "default", "title": "Watch external dsh run", "executor": "dsh", "session_id": "dsh_sess_1"},
			want: "POST /api/v1/tasks/track/start",
		},
		{
			name: "report_task_progress",
			args: map[string]any{"id": "t_1", "step": "Running migration", "percent": 55, "comment": true},
			want: "POST /api/v1/tasks/t_1/track/progress",
		},
		{
			name: "complete_tracked_task",
			args: map[string]any{"id": "t_1", "status": "done", "output": "All tests pass"},
			want: "POST /api/v1/tasks/t_1/track/complete",
		},
		{
			name: "retry_task",
			args: map[string]any{"id": "t_2", "feedback": "Try with --no-cache", "dispatch_now": true},
			want: "POST /api/v1/tasks/t_2/retry",
		},
		{
			name: "ask_task_question",
			args: map[string]any{"id": "t_2", "question": "Which store?", "options": []string{"SQLite", "Postgres"}, "author": "commandcode"},
			want: "POST /api/v1/tasks/t_2/questions",
		},
		{
			name: "answer_task_question",
			args: map[string]any{"id": "t_2", "question_id": "q_1", "selected_options": []string{"SQLite"}},
			want: "POST /api/v1/tasks/t_2/questions/answer",
		},
		{
			name: "upsert_knowledge",
			args: map[string]any{"slug": "mcp-guide", "title": "MCP Guide", "category": "API & MCP", "content": "# MCP"},
			want: "POST /api/v1/knowledge",
		},
		{
			name: "start_pipeline",
			args: map[string]any{"template": "meta7", "board_id": "default", "goal": "Build X", "workspace": "/repo", "context": "spec"},
			want: "POST /api/v1/pipelines",
		},
	}

	for _, tc := range calls {
		res, err := cs.CallTool(ctx, &sdk.CallToolParams{Name: tc.name, Arguments: tc.args})
		if err != nil {
			t.Fatalf("%s error: %v", tc.name, err)
		}
		if res.IsError {
			t.Fatalf("%s returned IsError: %+v", tc.name, res.Content)
		}
	}

	mu.Lock()
	defer mu.Unlock()
	if len(hits) != len(calls) {
		t.Fatalf("expected %d hits, got %d: %v", len(calls), len(hits), hits)
	}
	for i, tc := range calls {
		if !strings.HasPrefix(hits[i], tc.want) {
			t.Errorf("call %s hit %q, want prefix %q", tc.name, hits[i], tc.want)
		}
	}
	if !strings.Contains(hits[7], `"workspace":"/repo"`) || !strings.Contains(hits[7], `"context":"spec"`) {
		t.Errorf("start_pipeline missing enhanced fields: %s", hits[7])
	}
}
