package mcp

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

func connect(t *testing.T, b Backend) *sdk.ClientSession {
	t.Helper()
	ct, st := sdk.NewInMemoryTransports()
	ctx := context.Background()
	if _, err := NewServer(b).Connect(ctx, st, nil); err != nil {
		t.Fatal(err)
	}
	cs, err := sdk.NewClient(&sdk.Implementation{Name: "c", Version: "1"}, nil).Connect(ctx, ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cs.Close() })
	return cs
}

func TestToolsProxyREST(t *testing.T) {
	var got []string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		bb, _ := io.ReadAll(r.Body)
		buf := string(bb)
		got = append(got, r.Method+" "+r.URL.RequestURI()+" "+r.Header.Get("Authorization")+" "+buf)
		switch {
		case strings.HasSuffix(r.URL.Path, "/dispatch"):
			http.Error(w, `{"error":"nope"}`, 404)
		default:
			w.Write([]byte(`{"id":"t_1"}`))
		}
	}))
	defer ts.Close()
	cs := connect(t, NewHTTPBackend(ts.URL, "tok"))
	ctx := context.Background()

	tl, err := cs.ListTools(ctx, nil)
	if err != nil || len(tl.Tools) != 20 {
		t.Fatalf("tools: %v %d", err, len(tl.Tools))
	}
	res, err := cs.CallTool(ctx, &sdk.CallToolParams{Name: "list_tasks", Arguments: map[string]any{"board_id": "b1", "status": "todo"}})
	if err != nil || res.IsError {
		t.Fatalf("list_tasks: %v %+v", err, res)
	}
	b, _ := json.Marshal(res.StructuredContent)
	if !strings.Contains(string(b), "t_1") {
		t.Fatalf("content %s", b)
	}
	if _, err = cs.CallTool(ctx, &sdk.CallToolParams{Name: "update_task", Arguments: map[string]any{"id": "t_1", "title": "x"}}); err != nil {
		t.Fatal(err)
	}
	res, _ = cs.CallTool(ctx, &sdk.CallToolParams{Name: "dispatch_task", Arguments: map[string]any{"id": "t_1"}})
	if !res.IsError || !strings.Contains(res.Content[0].(*sdk.TextContent).Text, "404") {
		t.Fatalf("expected 404 error: %+v", res)
	}
	want := []string{"GET /api/v1/boards/b1/tasks?status=todo Bearer tok ", `PATCH /api/v1/tasks/t_1 Bearer tok {"acceptance":null,"effort":null,"executor":null,"model":null,"prompt":null,"title":"x","workspace":null}`}
	for i, w := range want {
		if got[i] != w {
			t.Errorf("req %d: %q want %q", i, got[i], w)
		}
	}
}
