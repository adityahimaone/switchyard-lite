// Package dispatch claims todo tasks, leases them and runs them on a node-agent.
package dispatch

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/harnesses"
)

// Request mirrors kanban NodeDispatchRequest (shared subset, same JSON keys).
type Request struct {
	TaskID               string               `json:"task_id"`
	Title                string               `json:"title,omitempty"`
	Board                string               `json:"board"`
	Message              string               `json:"message"`
	Workspace            string               `json:"workspace"`
	Model                string               `json:"model,omitempty"`
	Effort               string               `json:"effort,omitempty"`
	Executor             string               `json:"executor,omitempty"`
	Command              string               `json:"command,omitempty"`
	Spawn                *harnesses.SpawnSpec `json:"spawn,omitempty"`
	ExecutionMode        string `json:"execution_mode,omitempty"`
	NoRTK                bool   `json:"no_rtk,omitempty"`
	Acceptance           string `json:"acceptance,omitempty"`
	RunID                string `json:"run_id,omitempty"`
	TimeoutS             int    `json:"timeout_s,omitempty"`
	HarnessKind          string `json:"harness_kind,omitempty"`
	DSHWorkspaceID       string `json:"dsh_workspace_id,omitempty"`
	DSHSessionID         string `json:"dsh_session_id,omitempty"`
	CommandCodeSessionID string `json:"commandcode_session_id,omitempty"`
	ClaudeSessionID      string `json:"claude_session_id,omitempty"`
	OMPSessionID         string `json:"omp_session_id,omitempty"`
	AgySessionID         string `json:"agy_session_id,omitempty"`
	AutoApprove          bool   `json:"auto_approve,omitempty"`
	LastTurnSeq          *int64 `json:"last_turn_seq,omitempty"`
	SessionContinuation  bool   `json:"session_continuation,omitempty"`
	// Composer context. node-agent ignores unknown keys, but keeping them in
	// the wire payload means a future agent can resolve skills itself.
	Paths  []string `json:"paths,omitempty"`
	Skills []string `json:"skills,omitempty"`
	Branch string   `json:"branch,omitempty"`
}

// Result mirrors kanban NodeDispatchResult (shared subset).
type Result struct {
	TaskID               string         `json:"task_id"`
	Success              bool           `json:"success"`
	Output               string         `json:"output"`
	Error                string         `json:"error,omitempty"`
	DurationMs           int64          `json:"duration_ms"`
	SessionID            string         `json:"session_id,omitempty"`
	DshSessionID         string         `json:"dsh_session_id,omitempty"`
	DSHWorkspaceID       string         `json:"dsh_workspace_id,omitempty"`
	WorkspaceID          string         `json:"workspace_id,omitempty"`
	CommandCodeSessionID string         `json:"commandcode_session_id,omitempty"`
	ClaudeSessionID      string         `json:"claude_session_id,omitempty"`
	OMPSessionID         string         `json:"omp_session_id,omitempty"`
	AgySessionID         string         `json:"agy_session_id,omitempty"`
	LastTurnSeq          *int64         `json:"last_turn_seq,omitempty"`
	Executor             string         `json:"executor,omitempty"`
	Model                string         `json:"model,omitempty"`
	Usage                map[string]any `json:"usage,omitempty"`
}

// Ack holds optional metadata returned by POST /api/dispatch.
type Ack struct {
	Accepted  bool   `json:"accepted,omitempty"`
	Executor  string `json:"executor,omitempty"`
	Model     string `json:"model,omitempty"`
	SessionID string `json:"session_id,omitempty"`
}

// ProgressChunk represents incremental worker output returned by GET /api/progress/{taskID}.
type ProgressChunk struct {
	Text   string `json:"text"`
	Offset int64  `json:"offset"`
}

// ErrPending means the node-agent has no result yet.
var ErrPending = errors.New("result pending")

// ErrCapacity indicates the node-agent temporarily rejected dispatch due to
// queue saturation or rate limiting (e.g. HTTP 503 "node queue full").
var ErrCapacity = errors.New("node-agent at capacity")

// HTTPStatusError captures a non-2xx response from node-agent while preserving
// the status code so callers can distinguish transient capacity errors (503/429)
// from ordinary execution failures.
type HTTPStatusError struct {
	Op         string
	StatusCode int
	Body       string
}

func (e *HTTPStatusError) Error() string {
	if e.Body == "" {
		return fmt.Sprintf("node-agent %s: %d", e.Op, e.StatusCode)
	}
	return fmt.Sprintf("node-agent %s: %d %s", e.Op, e.StatusCode, e.Body)
}

func (e *HTTPStatusError) Unwrap() error {
	if e.StatusCode == http.StatusServiceUnavailable || e.StatusCode == http.StatusTooManyRequests {
		return ErrCapacity
	}
	return nil
}

// Client talks to a node-agent.
type Client struct {
	BaseURL string
	Token   string
	HTTP    *http.Client
}

func (c *Client) do(ctx context.Context, method, path string, body any) (int, []byte, error) {
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(c.BaseURL, "/")+path, rd)
	if err != nil {
		return 0, nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.Token != "" {
		req.Header.Set("X-Node-Agent-Token", c.Token)
	}
	h := c.HTTP
	if h == nil {
		h = &http.Client{Timeout: 30 * time.Second}
	}
	resp, err := h.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	return resp.StatusCode, b, nil
}

// Dispatch submits a task.
func (c *Client) Dispatch(ctx context.Context, r Request) error {
	_, err := c.DispatchWithAck(ctx, r)
	return err
}

// DispatchWithAck submits a task and decodes optional executor/model/session ack fields.
func (c *Client) DispatchWithAck(ctx context.Context, r Request) (Ack, error) {
	code, b, err := c.do(ctx, "POST", "/api/dispatch", r)
	if err != nil {
		return Ack{}, err
	}
	if code/100 != 2 {
		return Ack{}, &HTTPStatusError{
			Op:         "dispatch",
			StatusCode: code,
			Body:       strings.TrimSpace(string(b)),
		}
	}
	var ack Ack
	if len(b) > 0 {
		_ = json.Unmarshal(b, &ack)
	}
	return ack, nil
}

// FetchProgress retrieves incremental log output from offset.
func (c *Client) FetchProgress(ctx context.Context, taskID string, offset int64) (string, int64, error) {
	code, b, err := c.do(ctx, "GET", fmt.Sprintf("/api/progress/%s?offset=%d", taskID, offset), nil)
	if err != nil {
		return "", offset, err
	}
	if code == http.StatusNotFound || code == http.StatusNoContent {
		return "", offset, nil
	}
	if code/100 != 2 {
		return "", offset, fmt.Errorf("node-agent progress: %d %s", code, strings.TrimSpace(string(b)))
	}
	var chunk ProgressChunk
	if err := json.Unmarshal(b, &chunk); err != nil {
		return "", offset, err
	}
	if chunk.Offset < offset {
		chunk.Offset = offset
	}
	return chunk.Text, chunk.Offset, nil
}

// FetchResult returns ErrPending while the job is unfinished (202/404).
func (c *Client) FetchResult(ctx context.Context, taskID string) (*Result, error) {
	code, b, err := c.do(ctx, "GET", "/api/results/"+taskID, nil)
	if err != nil {
		return nil, err
	}
	if code == 202 || code == 404 {
		return nil, ErrPending
	}
	if code/100 != 2 {
		return nil, fmt.Errorf("node-agent result: %d %s", code, strings.TrimSpace(string(b)))
	}
	var res Result
	if err := json.Unmarshal(b, &res); err != nil {
		return nil, err
	}
	return &res, nil
}

// StreamEvents subscribes to GET /api/events/{task_id} (SSE) for real-time progress
// and terminal result delivery. Returns (nil, false, nil) if the server does not
// support SSE (404/405), allowing callers to fall back to polling cleanly.
func (c *Client) StreamEvents(ctx context.Context, taskID string, offset int64, onProgress func(text string, nextOffset int64)) (*Result, bool, error) {
	u := fmt.Sprintf("%s/api/events/%s?offset=%d", strings.TrimRight(c.BaseURL, "/"), taskID, offset)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, false, err
	}
	req.Header.Set("Accept", "text/event-stream")
	if c.Token != "" {
		req.Header.Set("X-Node-Agent-Token", c.Token)
	}
	streamHTTP := &http.Client{}
	resp, err := streamHTTP.Do(req)
	if err != nil {
		return nil, false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusMethodNotAllowed {
		return nil, false, nil
	}
	if resp.StatusCode/100 != 2 {
		return nil, false, fmt.Errorf("node-agent sse: %d", resp.StatusCode)
	}

	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	var evName string
	var dataLines []string
	flush := func() (*Result, bool, error) {
		if len(dataLines) == 0 {
			evName = ""
			return nil, false, nil
		}
		raw := strings.Join(dataLines, "\n")
		dataLines = nil
		kind := evName
		evName = ""
		switch kind {
		case "progress":
			var chunk ProgressChunk
			if json.Unmarshal([]byte(raw), &chunk) == nil && chunk.Text != "" && onProgress != nil {
				onProgress(chunk.Text, chunk.Offset)
			}
		case "result":
			var res Result
			if err := json.Unmarshal([]byte(raw), &res); err != nil {
				return nil, true, err
			}
			return &res, true, nil
		}
		return nil, false, nil
	}
	for sc.Scan() {
		line := sc.Text()
		if line == "" {
			if res, done, ferr := flush(); done || ferr != nil {
				return res, true, ferr
			}
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		if v, ok := strings.CutPrefix(line, "event:"); ok {
			evName = strings.TrimSpace(v)
		} else if v, ok := strings.CutPrefix(line, "data:"); ok {
			dataLines = append(dataLines, strings.TrimSpace(v))
		}
	}
	if res, done, ferr := flush(); done || ferr != nil {
		return res, true, ferr
	}
	if err := sc.Err(); err != nil {
		return nil, true, err
	}
	return nil, true, ErrPending
}
