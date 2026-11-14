package mcp

import (
	"encoding/json"
	"strconv"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

func boolFlag(v bool) string {
	if v {
		return "1"
	}
	return ""
}

func registerExtraTools(s *sdk.Server, b Backend) {
	registerBoardTaskTools(s, b)
	registerTrackerDispatchQuestionTools(s, b)
	registerPipelineWorkspaceInfraKnowledgeTools(s, b)
}

func registerBoardTaskTools(s *sdk.Server, b Backend) {
	tool(s, b, "update_board", "Update a board name or default executor/model", "PATCH", func(in struct {
		ID              string `json:"id"`
		Name            string `json:"name,omitempty"`
		DefaultExecutor string `json:"default_executor,omitempty"`
		DefaultModel    string `json:"default_model,omitempty"`
	}) (string, any) {
		return "/api/v1/boards/" + esc(in.ID), map[string]string{
			"name":             in.Name,
			"default_executor": in.DefaultExecutor,
			"default_model":    in.DefaultModel,
		}
	})
	tool(s, b, "delete_board", "Delete a board and its tasks", "DELETE", func(in idArg) (string, any) {
		return "/api/v1/boards/" + esc(in.ID), nil
	})
	tool(s, b, "delete_task", "Delete a task", "DELETE", func(in idArg) (string, any) {
		return "/api/v1/tasks/" + esc(in.ID), nil
	})
	tool(s, b, "remove_dependency", "Remove a blocked_by dependency from a task", "DELETE", func(in struct {
		ID        string `json:"id"`
		BlockedBy string `json:"blocked_by"`
	}) (string, any) {
		return "/api/v1/tasks/" + esc(in.ID) + "/dependencies/" + esc(in.BlockedBy), nil
	})
	tool(s, b, "list_comments", "List comments on a task", "GET", func(in idArg) (string, any) {
		return "/api/v1/tasks/" + esc(in.ID) + "/comments", nil
	})
	tool(s, b, "list_attachments", "List attachments on a task", "GET", func(in idArg) (string, any) {
		return "/api/v1/tasks/" + esc(in.ID) + "/attachments", nil
	})
	tool(s, b, "add_attachment", "Attach text or base64 content to a task", "POST", func(in struct {
		ID         string `json:"id"`
		Name       string `json:"name"`
		Mime       string `json:"mime,omitempty"`
		Content    string `json:"content,omitempty"`
		DataBase64 string `json:"data_base64,omitempty"`
	}) (string, any) {
		id := in.ID
		in.ID = ""
		return "/api/v1/tasks/" + esc(id) + "/attachments", in
	})
	tool(s, b, "delete_attachment", "Delete an attachment from a task", "DELETE", func(in struct {
		ID           string `json:"id"`
		AttachmentID string `json:"attachment_id"`
	}) (string, any) {
		return "/api/v1/tasks/" + esc(in.ID) + "/attachments/" + esc(in.AttachmentID), nil
	})
}

func registerTrackerDispatchQuestionTools(s *sdk.Server, b Backend) {
	tool(s, b, "start_tracked_task", "Create or attach a passive monitor-only tracker card (skipped by dispatcher)", "POST", func(in struct {
		ID         string   `json:"id,omitempty"`
		BoardID    string   `json:"board_id,omitempty"`
		Title      string   `json:"title,omitempty"`
		Prompt     string   `json:"prompt,omitempty"`
		Acceptance string   `json:"acceptance,omitempty"`
		Workspace  string   `json:"workspace,omitempty"`
		Executor   string   `json:"executor,omitempty"`
		Model      string   `json:"model,omitempty"`
		SessionID  string   `json:"session_id,omitempty"`
		Paths      []string `json:"paths,omitempty"`
		Skills     []string `json:"skills,omitempty"`
	}) (string, any) {
		return "/api/v1/tasks/track/start", in
	})
	tool(s, b, "report_task_progress", "Append live output, agent progress, or comment to a tracked card", "POST", func(in struct {
		ID      string `json:"id"`
		Text    string `json:"text,omitempty"`
		Step    string `json:"step,omitempty"`
		Percent *int   `json:"percent,omitempty"`
		Author  string `json:"author,omitempty"`
		Comment bool   `json:"comment,omitempty"`
	}) (string, any) {
		id := in.ID
		in.ID = ""
		return "/api/v1/tasks/" + esc(id) + "/track/progress", in
	})
	tool(s, b, "complete_tracked_task", "Finish a passive tracked card as done, review, or failed", "POST", func(in struct {
		ID        string         `json:"id"`
		Status    string         `json:"status,omitempty"`
		Output    string         `json:"output,omitempty"`
		Error     string         `json:"error,omitempty"`
		SessionID string         `json:"session_id,omitempty"`
		Usage     map[string]any `json:"usage,omitempty"`
	}) (string, any) {
		id := in.ID
		in.ID = ""
		return "/api/v1/tasks/" + esc(id) + "/track/complete", in
	})

	tool(s, b, "retry_task", "Reset failure state and re-queue or immediately dispatch a managed task", "POST", func(in struct {
		ID           string `json:"id"`
		Feedback     string `json:"feedback,omitempty"`
		Prompt       string `json:"prompt,omitempty"`
		ResetRetries *bool  `json:"reset_retries,omitempty"`
		DispatchNow  *bool  `json:"dispatch_now,omitempty"`
	}) (string, any) {
		id := in.ID
		in.ID = ""
		return "/api/v1/tasks/" + esc(id) + "/retry", in
	})
	tool(s, b, "get_task_logs", "Read worker live output logs for a task from an offset", "GET", func(in struct {
		ID     string `json:"id"`
		Offset int64  `json:"offset,omitempty"`
	}) (string, any) {
		var off string
		if in.Offset > 0 {
			off = strconv.FormatInt(in.Offset, 10)
		}
		return "/api/v1/tasks/" + esc(in.ID) + "/logs" + q("offset", off), nil
	})
	tool(s, b, "get_task_runs", "List execution run history and tracer telemetry for a task", "GET", func(in idArg) (string, any) {
		return "/api/v1/tasks/" + esc(in.ID) + "/runs", nil
	})
	tool(s, b, "get_task_worktree", "Inspect the isolated git worktree bound to a task", "GET", func(in idArg) (string, any) {
		return "/api/v1/tasks/" + esc(in.ID) + "/worktree", nil
	})

	tool(s, b, "ask_task_question", "Post an interactive Grill-Me / clarification question with selectable choices onto a Kanban card", "POST", func(in struct {
		ID          string   `json:"id"`
		Question    string   `json:"question"`
		Options     []string `json:"options,omitempty"`
		MultiSelect bool     `json:"multi_select,omitempty"`
		Context     string   `json:"context,omitempty"`
		Author      string   `json:"author,omitempty"`
	}) (string, any) {
		id := in.ID
		in.ID = ""
		return "/api/v1/tasks/" + esc(id) + "/questions", in
	})
	tool(s, b, "get_task_questions", "List open and answered questions on a task card (poll here for external dsh/commandcode answers)", "GET", func(in idArg) (string, any) {
		return "/api/v1/tasks/" + esc(in.ID) + "/questions", nil
	})
	tool(s, b, "answer_task_question", "Submit an option selection or custom answer to a pending card question and auto-resume managed runs", "POST", func(in struct {
		ID              string   `json:"id"`
		QuestionID      string   `json:"question_id,omitempty"`
		SelectedOptions []string `json:"selected_options,omitempty"`
		Answer          string   `json:"answer,omitempty"`
		Author          string   `json:"author,omitempty"`
		AutoResume      *bool    `json:"auto_resume,omitempty"`
	}) (string, any) {
		id := in.ID
		in.ID = ""
		return "/api/v1/tasks/" + esc(id) + "/questions/answer", in
	})

	tool(s, b, "get_review_settings", "Read review gate settings (auto_merge)", "GET", func(empty) (string, any) {
		return "/api/v1/settings/review", nil
	})
	tool(s, b, "set_review_settings", "Update review gate settings (auto_merge)", "POST", func(in struct {
		AutoMerge bool `json:"auto_merge"`
	}) (string, any) {
		return "/api/v1/settings/review", in
	})
}

func registerPipelineWorkspaceInfraKnowledgeTools(s *sdk.Server, b Backend) {
	tool(s, b, "get_default_template", "Get the default pipeline template", "GET", func(empty) (string, any) {
		return "/api/v1/pipelines/default", nil
	})
	tool(s, b, "set_default_template", "Set the default pipeline template", "POST", func(in struct {
		Default string `json:"default"`
	}) (string, any) {
		return "/api/v1/pipelines/default", in
	})
	tool(s, b, "list_pipelines", "List all pipeline runs", "GET", func(empty) (string, any) {
		return "/api/v1/pipelines", nil
	})
	tool(s, b, "retry_pipeline_node", "Retry a specific stage/node in a pipeline run", "POST", func(in struct {
		ID    string `json:"id"`
		Key   string `json:"key,omitempty"`
		Stage string `json:"stage,omitempty"`
	}) (string, any) {
		return "/api/v1/pipelines/" + esc(in.ID) + "/retry", map[string]string{
			"key":   in.Key,
			"stage": in.Stage,
		}
	})
	tool(s, b, "restart_pipeline", "Restart a pipeline run from scratch", "POST", func(in idArg) (string, any) {
		return "/api/v1/pipelines/" + esc(in.ID) + "/restart", map[string]any{}
	})

	tool(s, b, "list_workspaces", "List registered workspaces", "GET", func(empty) (string, any) {
		return "/api/v1/workspaces", nil
	})
	tool(s, b, "create_workspace", "Register a workspace", "POST", func(in struct {
		ID     string   `json:"id,omitempty"`
		Name   string   `json:"name,omitempty"`
		Path   string   `json:"path"`
		Host   string   `json:"host,omitempty"`
		OS     string   `json:"os,omitempty"`
		Kind   string   `json:"kind,omitempty"`
		Labels []string `json:"labels,omitempty"`
		Note   string   `json:"note,omitempty"`
	}) (string, any) {
		return "/api/v1/workspaces", in
	})
	tool(s, b, "update_workspace", "Update a registered workspace", "PATCH", func(in struct {
		ID     string   `json:"id"`
		Name   string   `json:"name,omitempty"`
		Path   string   `json:"path,omitempty"`
		Host   string   `json:"host,omitempty"`
		OS     string   `json:"os,omitempty"`
		Kind   string   `json:"kind,omitempty"`
		Labels []string `json:"labels,omitempty"`
		Note   string   `json:"note,omitempty"`
	}) (string, any) {
		id := in.ID
		in.ID = ""
		return "/api/v1/workspaces/" + esc(id), in
	})
	tool(s, b, "delete_workspace", "Remove a registered workspace", "DELETE", func(in idArg) (string, any) {
		return "/api/v1/workspaces/" + esc(in.ID), nil
	})
	tool(s, b, "sync_workspaces", "Sync workspaces from node-agent live registry", "POST", func(empty) (string, any) {
		return "/api/v1/workspaces/sync", map[string]any{}
	})
	tool(s, b, "inspect_workspace", "Inspect git state and branches of a workspace path", "GET", func(in struct {
		Path    string `json:"path"`
		Refresh bool   `json:"refresh,omitempty"`
	}) (string, any) {
		return "/api/v1/workspaces/inspect" + q("path", in.Path, "refresh", boolFlag(in.Refresh)), nil
	})
	tool(s, b, "search_workspace_files", "Search indexed files inside a workspace", "GET", func(in struct {
		Path  string `json:"path"`
		Query string `json:"q,omitempty"`
		Limit int    `json:"limit,omitempty"`
	}) (string, any) {
		var lim string
		if in.Limit > 0 {
			lim = strconv.Itoa(in.Limit)
		}
		return "/api/v1/workspaces/files" + q("path", in.Path, "q", in.Query, "limit", lim), nil
	})
	tool(s, b, "list_skills", "List available agent skills", "GET", func(in struct {
		Query   string `json:"q,omitempty"`
		Refresh bool   `json:"refresh,omitempty"`
	}) (string, any) {
		return "/api/v1/skills" + q("q", in.Query, "refresh", boolFlag(in.Refresh)), nil
	})

	tool(s, b, "create_worker", "Register a worker node (admin scope)", "POST", func(in struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	}) (string, any) {
		return "/api/v1/workers", in
	})
	tool(s, b, "delete_worker", "Remove a registered worker node (admin scope)", "DELETE", func(in idArg) (string, any) {
		return "/api/v1/workers/" + esc(in.ID), nil
	})
	tool(s, b, "get_flow_map", "Read global live Flow Map nodes and edges across boards", "GET", func(in struct {
		BoardID string `json:"board_id,omitempty"`
		Window  string `json:"window,omitempty"`
	}) (string, any) {
		return "/api/v1/flow/active" + q("board_id", in.BoardID, "window", in.Window), nil
	})
	tool(s, b, "get_overview", "Get board/control-plane overview counters and status", "GET", func(in struct {
		BoardID string `json:"board_id,omitempty"`
	}) (string, any) {
		return "/api/v1/overview" + q("board_id", in.BoardID), nil
	})
	tool(s, b, "read_logs", "Read server/worker system log lines", "GET", func(in struct {
		File  string `json:"file,omitempty"`
		Tail  int    `json:"tail,omitempty"`
		Query string `json:"q,omitempty"`
	}) (string, any) {
		var tail string
		if in.Tail > 0 {
			tail = strconv.Itoa(in.Tail)
		}
		return "/api/v1/logs" + q("file", in.File, "tail", tail, "q", in.Query), nil
	})

	tool(s, b, "list_knowledge", "List custom Knowledge / Docs articles", "GET", func(in struct {
		Query    string `json:"q,omitempty"`
		Category string `json:"category,omitempty"`
	}) (string, any) {
		return "/api/v1/knowledge" + q("q", in.Query, "category", in.Category), nil
	})
	tool(s, b, "get_knowledge", "Get a Knowledge / Docs article by slug or id", "GET", func(in struct {
		Slug string `json:"slug"`
	}) (string, any) {
		return "/api/v1/knowledge/" + esc(in.Slug), nil
	})
	tool(s, b, "upsert_knowledge", "Create or update a custom Knowledge / Docs article", "POST", func(in struct {
		Slug     string            `json:"slug,omitempty"`
		Title    string            `json:"title"`
		Subtitle string            `json:"subtitle,omitempty"`
		Category string            `json:"category,omitempty"`
		Badge    string            `json:"badge,omitempty"`
		Summary  string            `json:"summary,omitempty"`
		Content  string            `json:"content,omitempty"`
		Sections []json.RawMessage `json:"sections,omitempty"`
	}) (string, any) {
		return "/api/v1/knowledge", in
	})
	tool(s, b, "delete_knowledge", "Delete a custom Knowledge / Docs article by slug or id", "DELETE", func(in struct {
		Slug string `json:"slug"`
	}) (string, any) {
		return "/api/v1/knowledge/" + esc(in.Slug), nil
	})
}
