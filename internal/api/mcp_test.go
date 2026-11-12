package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/adityahimaone/switchyard-lite/internal/store"
	"github.com/adityahimaone/switchyard-lite/internal/tasks"
)

func TestMCPHTTPScopesAndUpdate(t *testing.T) {
	s, _ := store.Open(":memory:")
	defer s.Close()
	ts := httptest.NewServer(New(s).Handler())
	defer ts.Close()
	rd, _ := CreateToken(s, "r", "read")
	wr, _ := CreateToken(s, "w", "write")

	run := func(tok, tool string, args map[string]any) *sdk.CallToolResult {
		cl := ts.Client()
		cl.Transport = bearer{tok}
		cs, err := sdk.NewClient(&sdk.Implementation{Name: "c", Version: "1"}, nil).
			Connect(context.Background(), &sdk.StreamableClientTransport{Endpoint: ts.URL + "/mcp", HTTPClient: cl}, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer cs.Close()
		res, err := cs.CallTool(context.Background(), &sdk.CallToolParams{Name: tool, Arguments: args})
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	if res := run(rd, "create_board", map[string]any{"name": "x"}); !res.IsError || !strings.Contains(res.Content[0].(*sdk.TextContent).Text, "403") {
		t.Fatalf("read token must be forbidden: %+v", res)
	}
	b, _ := New(s).Tasks.CreateBoard("x")
	tk, _ := New(s).Tasks.Create(tasksNew(b.ID))
	res := run(wr, "update_task", map[string]any{"id": tk.ID, "title": "renamed"})
	if res.IsError {
		t.Fatalf("%+v", res)
	}
	got, _ := New(s).Tasks.Get(tk.ID)
	if got.Title != "renamed" || got.Prompt != "p" {
		t.Fatalf("%+v", got)
	}
}

type bearer struct{ tok string }

func (b bearer) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+b.tok)
	return http.DefaultTransport.RoundTrip(r)
}

func tasksNew(board string) tasks.NewTask {
	return tasks.NewTask{BoardID: board, Title: "t", Prompt: "p"}
}
