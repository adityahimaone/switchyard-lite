package mcp

import (
	"context"
	"encoding/json"
	"net/url"
	"strconv"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// Result wraps a JSON REST response.
type Result struct {
	Status int `json:"status"`
	Data   any `json:"data,omitempty"`
}

type empty struct{}
type idArg struct {
	ID string `json:"id" jsonschema:"task id"`
}

// tool registers a tool that maps typed input to one REST call.
func tool[In any](s *sdk.Server, b Backend, name, desc, method string, build func(In) (string, any)) {
	sdk.AddTool(s, &sdk.Tool{Name: name, Description: desc},
		func(ctx context.Context, _ *sdk.CallToolRequest, in In) (*sdk.CallToolResult, Result, error) {
			path, body := build(in)
			st, data, err := b.Do(ctx, method, path, body)
			if err != nil {
				return nil, Result{}, err
			}
			if st >= 400 {
				return nil, Result{}, httpErr(st, data)
			}
			return nil, Result{Status: st, Data: rawJSON(data)}, nil
		})
}

func q(kv ...string) string {
	v := url.Values{}
	for i := 0; i+1 < len(kv); i += 2 {
		if kv[i+1] != "" {
			v.Set(kv[i], kv[i+1])
		}
	}
	if len(v) == 0 {
		return ""
	}
	return "?" + v.Encode()
}

func esc(s string) string { return url.PathEscape(s) }

// NewServer builds an MCP server whose tools proxy to the REST API through b.
func NewServer(b Backend) *sdk.Server {
	s := sdk.NewServer(&sdk.Implementation{Name: "switchyard-lite", Version: "0.1.0"}, nil)

	tool(s, b, "list_boards", "List boards", "GET", func(empty) (string, any) { return "/api/v1/boards", nil })
	tool(s, b, "create_board", "Create a board", "POST", func(in struct {
		Name string `json:"name"`
	}) (string, any) {
		return "/api/v1/boards", in
	})
	tool(s, b, "list_tasks", "List tasks on a board, optionally by status", "GET", func(in struct {
		BoardID string `json:"board_id"`
		Status  string `json:"status,omitempty"`
	}) (string, any) {
		return "/api/v1/boards/" + esc(in.BoardID) + "/tasks" + q("status", in.Status), nil
	})
	tool(s, b, "get_task", "Get a task by id", "GET", func(in idArg) (string, any) { return "/api/v1/tasks/" + esc(in.ID), nil })
	tool(s, b, "create_task", "Create a task", "POST", func(in struct {
		BoardID    string   `json:"board_id"`
		ParentID   string   `json:"parent_id,omitempty"`
		Title      string   `json:"title"`
		Prompt     string   `json:"prompt,omitempty"`
		Acceptance string   `json:"acceptance,omitempty"`
		Workspace  string   `json:"workspace,omitempty"`
		Executor   string   `json:"executor,omitempty"`
		Model      string   `json:"model,omitempty"`
		Effort     string   `json:"effort,omitempty"`
		BlockedBy  []string `json:"blocked_by,omitempty"`
	}) (string, any) {
		return "/api/v1/tasks", in
	})
	tool(s, b, "update_task", "Update task fields (only provided fields change)", "PATCH", func(in struct {
		ID         string  `json:"id"`
		Title      *string `json:"title,omitempty"`
		Prompt     *string `json:"prompt,omitempty"`
		Acceptance *string `json:"acceptance,omitempty"`
		Workspace  *string `json:"workspace,omitempty"`
		Executor   *string `json:"executor,omitempty"`
		Model      *string `json:"model,omitempty"`
		Effort     *string `json:"effort,omitempty"`
	}) (string, any) {
		id := in.ID
		in.ID = ""
		return "/api/v1/tasks/" + esc(id), map[string]any{"title": in.Title, "prompt": in.Prompt, "acceptance": in.Acceptance,
			"workspace": in.Workspace, "executor": in.Executor, "model": in.Model, "effort": in.Effort}
	})
	tool(s, b, "move_task", "Move a task to another status", "POST", func(in struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}) (string, any) {
		return "/api/v1/tasks/" + esc(in.ID) + "/move", map[string]string{"status": in.Status}
	})
	tool(s, b, "add_comment", "Comment on a task", "POST", func(in struct {
		ID     string `json:"id"`
		Body   string `json:"body"`
		Author string `json:"author,omitempty"`
	}) (string, any) {
		return "/api/v1/tasks/" + esc(in.ID) + "/comments", map[string]string{"body": in.Body, "author": in.Author}
	})
	tool(s, b, "add_dependency", "Make a task blocked by another", "POST", func(in struct {
		ID        string `json:"id"`
		BlockedBy string `json:"blocked_by"`
	}) (string, any) {
		return "/api/v1/tasks/" + esc(in.ID) + "/dependencies", map[string]string{"blocked_by": in.BlockedBy}
	})
	tool(s, b, "tail_events", "Read events after a cursor", "GET", func(in struct {
		TaskID string `json:"task_id,omitempty"`
		Since  int64  `json:"since,omitempty"`
		Limit  int    `json:"limit,omitempty"`
	}) (string, any) {
		var since, limit string
		if in.Since > 0 {
			since = strconv.FormatInt(in.Since, 10)
		}
		if in.Limit > 0 {
			limit = strconv.Itoa(in.Limit)
		}
		return "/api/v1/events" + q("task_id", in.TaskID, "since", since, "limit", limit), nil
	})

	// Proxied to endpoints owned by other components; errors surface if absent.
	tool(s, b, "dispatch_task", "Dispatch a task to a worker", "POST", func(in idArg) (string, any) {
		return "/api/v1/tasks/" + esc(in.ID) + "/dispatch", map[string]any{}
	})
	tool(s, b, "get_diff", "Get the review diff of a task", "GET", func(in idArg) (string, any) {
		return "/api/v1/tasks/" + esc(in.ID) + "/diff", nil
	})
	tool(s, b, "approve_task", "Approve a task in review", "POST", func(in struct {
		ID      string `json:"id"`
		Comment string `json:"comment,omitempty"`
	}) (string, any) {
		return "/api/v1/tasks/" + esc(in.ID) + "/approve", map[string]string{"comment": in.Comment}
	})
	tool(s, b, "reject_task", "Reject a task in review with feedback", "POST", func(in struct {
		ID       string `json:"id"`
		Feedback string `json:"feedback"`
	}) (string, any) {
		return "/api/v1/tasks/" + esc(in.ID) + "/reject", map[string]string{"feedback": in.Feedback, "comment": in.Feedback}
	})
	tool(s, b, "list_workers", "List registered workers", "GET", func(empty) (string, any) { return "/api/v1/workers", nil })
	tool(s, b, "list_models", "List available models", "GET", func(empty) (string, any) { return "/api/v1/models", nil })
	tool(s, b, "list_templates", "List pipeline templates", "GET", func(empty) (string, any) { return "/api/v1/pipelines/templates", nil })
	tool(s, b, "start_pipeline", "Start a pipeline run from a template", "POST", func(in struct {
		Template string `json:"template"`
		BoardID  string `json:"board_id"`
		Goal     string `json:"goal"`
	}) (string, any) {
		return "/api/v1/pipelines", in
	})
	tool(s, b, "get_pipeline_run", "Get a pipeline run", "GET", func(in idArg) (string, any) {
		return "/api/v1/pipelines/" + esc(in.ID), nil
	})
	tool(s, b, "cancel_pipeline", "Cancel a pipeline run", "POST", func(in idArg) (string, any) {
		return "/api/v1/pipelines/" + esc(in.ID) + "/cancel", map[string]any{}
	})
	return s
}

// rawJSON returns parsed JSON when possible, else the text.
func rawJSON(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	var v any
	if json.Unmarshal(b, &v) == nil {
		return v
	}
	return string(b)
}
