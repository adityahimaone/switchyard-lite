package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/adityahimaone/switchyard-lite/internal/store"
)

func TestMCPCreateDummyTaskSmoke(t *testing.T) {
	s, _ := store.Open(":memory:")
	defer s.Close()
	ts := httptest.NewServer(New(s).Handler())
	defer ts.Close()

	tok, _ := CreateToken(s, "w", "write")
	cl := ts.Client()
	cl.Transport = bearer{tok}
	cs, err := sdk.NewClient(&sdk.Implementation{Name: "smoke", Version: "1"}, nil).
		Connect(context.Background(), &sdk.StreamableClientTransport{Endpoint: ts.URL + "/mcp", HTTPClient: cl}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer cs.Close()

	call := func(name string, args map[string]any) any {
		t.Helper()
		res, err := cs.CallTool(context.Background(), &sdk.CallToolParams{Name: name, Arguments: args})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if res.IsError {
			t.Fatalf("%s isError: %+v", name, res.Content)
		}
		b, _ := json.Marshal(res.StructuredContent)
		var out struct {
			Status int             `json:"status"`
			Data   json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(b, &out); err != nil {
			t.Fatalf("%s decode: %v (%s)", name, err, b)
		}
		var v any
		_ = json.Unmarshal(out.Data, &v)
		t.Logf("%s -> %d %s", name, out.Status, out.Data)
		return v
	}

	board := call("create_board", map[string]any{"name": "smoke"}).(map[string]any)
	boardID, _ := board["id"].(string)
	if boardID == "" {
		t.Fatalf("no board id: %+v", board)
	}

	task := call("create_task", map[string]any{
		"board_id": boardID,
		"title":    "dummy smoke task",
		"prompt":   "do nothing",
	}).(map[string]any)
	taskID, _ := task["id"].(string)
	if taskID == "" || !strings.HasPrefix(taskID, "t_") {
		t.Fatalf("bad task: %+v", task)
	}
	if task["title"] != "dummy smoke task" || task["status"] != "todo" {
		t.Fatalf("unexpected task fields: %+v", task)
	}

	list := call("list_tasks", map[string]any{"board_id": boardID}).([]any)
	if len(list) != 1 {
		t.Fatalf("list_tasks len=%d", len(list))
	}

	got := call("get_task", map[string]any{"id": taskID}).(map[string]any)
	if got["id"] != taskID || got["prompt"] != "do nothing" {
		t.Fatalf("get_task mismatch: %+v", got)
	}

	// tracker mode card must not be claimable by dispatch but must still exist
	tr := call("create_task", map[string]any{
		"board_id":       boardID,
		"title":          "dummy tracker",
		"execution_mode": "tracker",
	}).(map[string]any)
	if tr["execution_mode"] != "tracker" {
		t.Fatalf("tracker mode lost: %+v", tr)
	}

	// invalid: empty title must be rejected
	res, err := cs.CallTool(context.Background(), &sdk.CallToolParams{Name: "create_task", Arguments: map[string]any{"board_id": boardID}})
	if err != nil {
		t.Fatal(err)
	}
	if !res.IsError {
		t.Fatalf("empty title should fail: %+v", res.StructuredContent)
	}
	t.Logf("empty title rejected: %+v", res.Content)
}
