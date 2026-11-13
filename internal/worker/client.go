// Package worker runs git and file operations on the node that actually owns a
// workspace.
//
// The control plane usually lives on a VPS while the checkouts live on Mac or
// Windows workers. os.Stat / `git -C <path>` on the control plane can never see
// them, which used to make branch pickers empty and @file suggestions useless.
// node-agent already routes a dispatch to the node owning a workspace prefix and
// runs its shell executor with cmd.Dir set to that workspace, so a small
// read-only shell job is enough to inspect the real checkout.
package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Info describes where the git repository lives inside a workspace.
type Info struct {
	// Prefix is the workspace-relative directory containing .git. Empty means
	// the workspace root itself is the repository.
	Prefix string `json:"prefix"`
	// Root is the absolute toplevel reported by git (display only: never use it
	// as a node-agent workspace value, git normalises separators).
	Root    string `json:"root"`
	IsGit   bool   `json:"is_git"`
	Windows bool   `json:"windows"`
	Warning string `json:"warning,omitempty"`
}

// Client talks to the node-agent's dispatch/result endpoints.
type Client struct {
	BaseURL string
	Token   string
	HTTP    *http.Client
	// Wait bounds a single metadata shell job, including queue time.
	Wait time.Duration
	Poll time.Duration
	Now  func() time.Time

	mu      sync.Mutex
	seq     uint64
	info    map[string]infoEntry
	infoTTL time.Duration
}

type infoEntry struct {
	at   time.Time
	info Info
}

// New returns a client for the node-agent base URL. An empty base is allowed:
// Enabled reports false and callers degrade to local/manual behaviour.
func New(base, token string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(strings.TrimSpace(base), "/"),
		Token:   token,
		HTTP:    &http.Client{Timeout: 8 * time.Second},
		Wait:    25 * time.Second,
		Poll:    400 * time.Millisecond,
		Now:     time.Now,
		info:    map[string]infoEntry{},
		infoTTL: 5 * time.Minute,
	}
}

// Enabled reports whether remote workspace inspection is configured.
func (c *Client) Enabled() bool { return c != nil && c.BaseURL != "" }

func (c *Client) http() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 8 * time.Second}
}

func (c *Client) nextID() string {
	c.mu.Lock()
	c.seq++
	n := c.seq
	c.mu.Unlock()
	return fmt.Sprintf("syprobe-%d-%d-%04x", c.Now().UnixNano(), n, rand.Intn(0x10000))
}

type shellRequest struct {
	TaskID        string `json:"task_id"`
	Board         string `json:"board"`
	Message       string `json:"message"`
	Workspace     string `json:"workspace"`
	Executor      string `json:"executor"`
	Command       string `json:"command"`
	ExecutionMode string `json:"execution_mode"`
	NoRTK         bool   `json:"no_rtk"`
	TimeoutS      int    `json:"timeout_s"`
}

type shellResult struct {
	TaskID  string `json:"task_id"`
	Success bool   `json:"success"`
	Output  string `json:"output"`
	Error   string `json:"error"`
}

// Shell runs one command in the workspace on its owning node and returns its
// combined output. Failures carry the worker's own stderr so the UI can explain
// what went wrong instead of showing an empty list.
func (c *Client) Shell(ctx context.Context, workspace, command string) (string, error) {
	if !c.Enabled() {
		return "", fmt.Errorf("node-agent is not configured")
	}
	if strings.TrimSpace(workspace) == "" {
		return "", fmt.Errorf("workspace path required")
	}
	id := c.nextID()
	body, err := json.Marshal(shellRequest{
		TaskID: id, Board: "switchyard-lite", Message: "workspace metadata probe",
		Workspace: workspace, Executor: "shell", Command: command,
		ExecutionMode: "direct", NoRTK: true, TimeoutS: 60,
	})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/api/dispatch", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.Token != "" {
		req.Header.Set("X-Node-Agent-Token", c.Token)
	}
	resp, err := c.http().Do(req)
	if err != nil {
		return "", fmt.Errorf("node-agent unreachable: %w", err)
	}
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return "", fmt.Errorf("node-agent dispatch %d: %s", resp.StatusCode, firstLine(string(raw)))
	}

	deadline := time.NewTimer(c.Wait)
	defer deadline.Stop()
	tick := time.NewTicker(c.Poll)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-deadline.C:
			return "", fmt.Errorf("node-agent did not return a result for %s", workspace)
		case <-tick.C:
		}
		out, done, err := c.fetchResult(ctx, id)
		if err != nil {
			return "", err
		}
		if !done {
			continue
		}
		return out, nil
	}
}

func (c *Client) fetchResult(ctx context.Context, id string) (string, bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+"/api/results/"+id, nil)
	if err != nil {
		return "", false, err
	}
	if c.Token != "" {
		req.Header.Set("X-Node-Agent-Token", c.Token)
	}
	resp, err := c.http().Do(req)
	if err != nil {
		return "", false, nil // transient: keep polling
	}
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	resp.Body.Close()
	if resp.StatusCode == 404 || resp.StatusCode == 202 {
		return "", false, nil
	}
	if resp.StatusCode/100 != 2 {
		return "", false, fmt.Errorf("node-agent results %d: %s", resp.StatusCode, firstLine(string(raw)))
	}
	var res shellResult
	if err := json.Unmarshal(raw, &res); err != nil {
		return "", false, fmt.Errorf("bad node-agent result: %w", err)
	}
	clean := stripProvenance(res.Output)
	if !res.Success {
		msg := strings.TrimSpace(res.Error)
		if msg == "" {
			msg = clean
		}
		return "", true, fmt.Errorf("%s", msg)
	}
	return clean, true, nil
}

// stripProvenance removes the node-agent's executor proof lines so git output
// can be parsed line-for-line.
func stripProvenance(raw string) string {
	kept := make([]string, 0, 16)
	for _, line := range strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n") {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "provenance ") || strings.HasPrefix(t, "EXECUTOR_PROOF=") || t == "" {
			continue
		}
		kept = append(kept, line)
	}
	return strings.TrimSpace(strings.Join(kept, "\n"))
}

func firstLine(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	if len(s) > 200 {
		s = s[:200] + "..."
	}
	return s
}

var windowsPath = regexp.MustCompile(`^[a-zA-Z]:[\\/]`)

// IsWindowsPath recognises drive-letter and UNC paths from the workspace
// registry. Windows cmd uses different quoting than bash.
func IsWindowsPath(p string) bool {
	return windowsPath.MatchString(p) || strings.HasPrefix(p, `\\`)
}

// Quote makes one shell argument safe on the worker's shell.
func Quote(arg string, windows bool) string {
	if !strings.ContainsAny(arg, " \t\"'&|();<>%$^") && arg != "" {
		return arg
	}
	if windows {
		return `"` + strings.ReplaceAll(arg, `"`, `""`) + `"`
	}
	return "'" + strings.ReplaceAll(arg, "'", `'\''`) + "'"
}

// JoinRemote builds a path on the worker preserving the registry's separator.
// node-agent matches workspace prefixes literally, so a Windows registered
// `D:\repo` must not be turned into `D:/repo`.
func JoinRemote(base string, parts ...string) string {
	sep := "/"
	if IsWindowsPath(base) {
		sep = `\`
	}
	out := strings.TrimRight(strings.ReplaceAll(base, "/", sep), sep)
	for _, p := range parts {
		p = strings.Trim(strings.ReplaceAll(p, "/", sep), sep)
		if p != "" {
			out += sep + p
		}
	}
	return out
}

// Git runs a git command in the workspace (or its nested repo) on the worker.
func (c *Client) Git(ctx context.Context, workspace string, info Info, args ...string) (string, error) {
	win := IsWindowsPath(workspace) || info.Windows
	parts := []string{"git"}
	if info.Prefix != "" {
		parts = append(parts, "-C", Quote(info.Prefix, win))
	}
	for _, a := range args {
		parts = append(parts, Quote(a, win))
	}
	return c.Shell(ctx, workspace, strings.Join(parts, " "))
}

// Info resolves the workspace's git root, caching the answer because a probe
// costs one or more remote shell jobs.
func (c *Client) Info(ctx context.Context, workspace string, refresh bool) (Info, error) {
	if !c.Enabled() {
		return Info{Warning: "node-agent is not configured"}, nil
	}
	key := workspace
	c.mu.Lock()
	if !refresh {
		if e, ok := c.info[key]; ok && c.Now().Sub(e.at) < c.infoTTL {
			c.mu.Unlock()
			return e.info, nil
		}
	}
	c.mu.Unlock()

	info, err := c.probe(ctx, workspace)
	if err != nil {
		return info, err
	}
	c.mu.Lock()
	c.info[key] = infoEntry{c.Now(), info}
	c.mu.Unlock()
	return info, nil
}

func (c *Client) probe(ctx context.Context, workspace string) (Info, error) {
	win := IsWindowsPath(workspace)
	info := Info{Windows: win}
	if root, err := c.Git(ctx, workspace, info, "rev-parse", "--show-toplevel"); err == nil && strings.TrimSpace(root) != "" {
		info.IsGit = true
		info.Root = strings.TrimSpace(root)
		return info, nil
	}
	// The SaaS workspaces keep their repository one level down (e.g. app/.git).
	// Discover it on the worker with a platform-appropriate directory listing.
	var listCmd string
	if win {
		listCmd = "dir /b /s /ad .git 2>nul"
	} else {
		listCmd = "ls -d ./*/.git 2>/dev/null"
	}
	out, _ := c.Shell(ctx, workspace, listCmd)
	candidates := []string{}
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || !strings.Contains(strings.ToLower(line), ".git") {
			continue
		}
		rel := nestedPrefix(workspace, line, win)
		if rel != "" {
			candidates = append(candidates, rel)
		}
		if len(candidates) >= 8 {
			break
		}
	}
	for _, prefix := range candidates {
		try := info
		try.Prefix = prefix
		root, err := c.Git(ctx, workspace, try, "rev-parse", "--show-toplevel")
		if err == nil && strings.TrimSpace(root) != "" {
			try.IsGit = true
			try.Root = strings.TrimSpace(root)
			return try, nil
		}
	}
	if !info.IsGit {
		info.Warning = "No git repository found in this workspace on the worker node. Type a branch name to use as the worktree base."
	}
	return info, nil
}

// nestedPrefix turns a discovered .git path into a workspace-relative prefix.
func nestedPrefix(workspace, found string, win bool) string {
	norm := func(s string) string {
		s = strings.ReplaceAll(s, `\`, "/")
		return strings.TrimRight(strings.TrimSpace(s), "/")
	}
	w, f := norm(workspace), norm(found)
	if strings.HasPrefix(strings.ToLower(f), strings.ToLower(w)+"/") {
		f = f[len(w)+1:]
	}
	// `ls -d ./*/.git` emits a ./-prefixed path; strip it so the prefix is
	// "app" rather than "./app".
	f = strings.TrimPrefix(f, "./")
	f = strings.TrimSuffix(f, "/.git")
	f = strings.Trim(f, "/")
	if f == "" || f == ".git" || strings.Contains(f, "/.git") {
		return ""
	}
	// Only immediate children: deeper matches are unrelated nested repos.
	if strings.Contains(f, "/") {
		return ""
	}
	_ = win // git accepts forward-slash prefixes on both platforms
	return f
}

// Branches lists local and origin branches plus the checked-out branch.
func (c *Client) Branches(ctx context.Context, workspace string, info Info) ([]string, string, error) {
	if !info.IsGit {
		return []string{}, "", nil
	}
	out, err := c.Git(ctx, workspace, info, "branch", "-a", "--no-color")
	if err != nil {
		return []string{}, "", err
	}
	branches := []string{}
	seen := map[string]bool{}
	current := ""
	for _, raw := range strings.Split(out, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.Contains(line, " -> ") {
			continue
		}
		star := strings.HasPrefix(line, "* ")
		if star {
			line = strings.TrimSpace(strings.TrimPrefix(line, "* "))
		}
		line = strings.TrimPrefix(line, "remotes/origin/")
		line = strings.TrimPrefix(line, "refs/heads/")
		line = strings.TrimPrefix(line, "refs/remotes/origin/")
		if line == "" || line == "HEAD" || strings.HasPrefix(line, "sy/") || strings.HasPrefix(line, "switchyard/") {
			continue
		}
		if star && current == "" {
			current = line
		}
		if !seen[line] {
			seen[line] = true
			branches = append(branches, line)
		}
	}
	if current != "" && !seen[current] {
		branches = append(branches, current)
	}
	return branches, current, nil
}

// Files returns tracked + untracked file paths relative to the repository.
func (c *Client) Files(ctx context.Context, workspace string, info Info) ([]string, error) {
	if info.IsGit {
		out, err := c.Git(ctx, workspace, info, "ls-files", "--cached", "--others", "--exclude-standard")
		if err == nil && strings.TrimSpace(out) != "" {
			return cleanPaths(out), nil
		}
	}
	// Non-git (or git-less) workspaces: fall back to a bounded directory walk.
	win := IsWindowsPath(workspace) || info.Windows
	cmd := "find . -type f 2>/dev/null"
	if win {
		cmd = "dir /b /s /a-d 2>nul"
	}
	out, err := c.Shell(ctx, workspace, cmd)
	if err != nil {
		return []string{}, err
	}
	files := cleanPaths(out)
	if win {
		// `dir /s` emits absolute paths; make them workspace relative.
		for i, f := range files {
			files[i] = relativeTo(workspace, f)
		}
	}
	return files, nil
}

func cleanPaths(raw string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, line := range strings.Split(raw, "\n") {
		p := strings.TrimSpace(line)
		if p == "" {
			continue
		}
		p = strings.ReplaceAll(p, `\`, "/")
		p = strings.TrimPrefix(p, "./")
		if seen[p] {
			continue
		}
		seen[p] = true
		out = append(out, p)
		if len(out) >= 15000 {
			break
		}
	}
	return out
}

func relativeTo(workspace, full string) string {
	n := func(s string) string { return strings.TrimRight(strings.ToLower(strings.ReplaceAll(s, `\`, "/")), "/") }
	w, f := n(workspace), n(full)
	if strings.HasPrefix(f, w+"/") {
		return full[len(w)+1:]
	}
	return full
}

// Symbol is one code-symbol-ish match returned to the @ omnibox.
type Symbol struct {
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	FilePath string `json:"file_path"`
	Line     int    `json:"line"`
	Text     string `json:"text,omitempty"`
}

var identRE = regexp.MustCompile(`[A-Za-z_][A-Za-z0-9_]{2,}`)

// Symbols runs a bounded fixed-string grep on the owning node and lifts
// identifier names out of the matching lines. It is the remote equivalent of
// the codegraph-backed suggestions in kanban-board's composer.
func (c *Client) Symbols(ctx context.Context, workspace string, info Info, query string, limit int) ([]Symbol, error) {
	if limit <= 0 || limit > 30 {
		limit = 8
	}
	q := strings.TrimSpace(query)
	if len(q) < 2 {
		return []Symbol{}, nil
	}
	out, err := c.Git(ctx, workspace, info, "grep", "-n", "-I", "-F", "-e", q, "--", ".")
	if err != nil {
		// A plain grep with no matches exits 1; that is not a failure for the UI.
		if strings.TrimSpace(out) == "" {
			return []Symbol{}, nil
		}
		return []Symbol{}, err
	}
	return ParseSymbols(out, q, limit), nil
}

// ParseSymbols turns `git grep -n` output into omnibox suggestions.
func ParseSymbols(out, query string, limit int) []Symbol {
	res := []Symbol{}
	lq := strings.ToLower(query)
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, ":", 3)
		if len(parts) < 3 {
			continue
		}
		n, _ := strconv.Atoi(parts[1])
		path := strings.ReplaceAll(parts[0], `\`, "/")
		text := strings.TrimSpace(parts[2])
		if len(text) > 160 {
			text = text[:160]
		}
		name := query
		for _, id := range identRE.FindAllString(text, -1) {
			if strings.Contains(strings.ToLower(id), lq) {
				name = id
				break
			}
		}
		res = append(res, Symbol{Name: name, Kind: "symbol", FilePath: path, Line: n, Text: text})
		if len(res) >= limit {
			break
		}
	}
	return res
}

// ParseLimit keeps external limit values inside the index's safe range.
func ParseLimit(s string, def int) int {
	if n, err := strconv.Atoi(s); err == nil && n > 0 {
		return n
	}
	return def
}
