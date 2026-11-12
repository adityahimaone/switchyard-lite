// Package dispatch claims todo tasks, leases them and runs them on a node-agent.
package dispatch

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Request mirrors kanban NodeDispatchRequest (shared subset, same JSON keys).
type Request struct {
	TaskID        string `json:"task_id"`
	Title         string `json:"title,omitempty"`
	Board         string `json:"board"`
	Message       string `json:"message"`
	Workspace     string `json:"workspace"`
	Model         string `json:"model,omitempty"`
	Effort        string `json:"effort,omitempty"`
	Executor      string `json:"executor,omitempty"`
	ExecutionMode string `json:"execution_mode,omitempty"`
	Acceptance    string `json:"acceptance,omitempty"`
	RunID         string `json:"run_id,omitempty"`
	TimeoutS      int    `json:"timeout_s,omitempty"`
}

// Result mirrors kanban NodeDispatchResult (shared subset).
type Result struct {
	TaskID     string `json:"task_id"`
	Success    bool   `json:"success"`
	Output     string `json:"output"`
	Error      string `json:"error,omitempty"`
	DurationMs int64  `json:"duration_ms"`
	SessionID  string `json:"session_id,omitempty"`
}

// ErrPending means the node-agent has no result yet.
var ErrPending = errors.New("result pending")

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
	code, b, err := c.do(ctx, "POST", "/api/dispatch", r)
	if err != nil {
		return err
	}
	if code/100 != 2 {
		return fmt.Errorf("node-agent dispatch: %d %s", code, strings.TrimSpace(string(b)))
	}
	return nil
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
