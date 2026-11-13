// Package catalog reads the kanban-board live workspace registry.
//
// The node-agent serves GET /api/workspaces straight from
// ~/.hermes/workspaces.json (kanban-board's source of truth) together with the
// live node report. That file carries the authoritative machine metadata —
// os, host, labels and a human name — which the local dispatch_workspaces
// table may lack. switchyard-lite used to import just the paths and prefix
// every name with "mac: ", so a Windows checkout such as
// D:\xampp\htdocs\portal-hadirr showed up as "mac: portal-hadirr".
//
// The catalog is a read-only, short-lived cache; it never mutates the local
// database. /api/v1/workspaces/sync is the explicit import action.
package catalog

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Workspace mirrors one entry of kanban-board's workspaces.json.
type Workspace struct {
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	Path   string   `json:"path"`
	Host   string   `json:"host"`
	OS     string   `json:"os"`
	Kind   string   `json:"kind"`
	Note   string   `json:"note"`
	Labels []string `json:"labels"`
}

// Catalog caches GET {base}/api/workspaces.
type Catalog struct {
	BaseURL string
	Token   string
	TTL     time.Duration
	HTTP    *http.Client
	Now     func() time.Time

	mu   sync.Mutex
	at   time.Time
	data []Workspace
}

func New(base, token string) *Catalog {
	return &Catalog{BaseURL: base, Token: token, TTL: 10 * time.Second, Now: time.Now}
}

// List returns the live registry. A nil or unconfigured catalog degrades
// quietly so a standalone control plane keeps working.
func (c *Catalog) List(ctx context.Context, refresh bool) ([]Workspace, error) {
	if c == nil || c.BaseURL == "" {
		return nil, nil
	}
	c.mu.Lock()
	at, data := c.at, c.data
	c.mu.Unlock()
	now := c.Now()
	if !refresh && !at.IsZero() && now.Sub(at) < c.TTL {
		return data, nil
	}

	u := strings.TrimRight(c.BaseURL, "/") + "/api/workspaces"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return data, err
	}
	if c.Token != "" {
		req.Header.Set("X-Node-Agent-Token", c.Token)
	}
	h := c.HTTP
	if h == nil {
		h = &http.Client{Timeout: 4 * time.Second}
	}
	resp, err := h.Do(req)
	if err != nil {
		return data, err // serve stale
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return data, fmt.Errorf("node-agent workspaces: %d", resp.StatusCode)
	}
	var payload struct {
		Workspaces json.RawMessage `json:"workspaces"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return data, err
	}
	var list []Workspace
	// The registry is usually an array; tolerate an object wrapper too.
	if len(payload.Workspaces) > 0 && payload.Workspaces[0] == '[' {
		if err := json.Unmarshal(payload.Workspaces, &list); err != nil {
			return data, err
		}
	} else {
		var whole []Workspace
		_ = json.Unmarshal(payload.Workspaces, &whole)
		list = whole
	}
	if list == nil {
		list = []Workspace{}
	}
	c.mu.Lock()
	c.at, c.data = now, list
	c.mu.Unlock()
	return list, nil
}

// Normalize makes paths comparable across macOS, Windows and Linux.
func Normalize(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return ""
	}
	p = strings.ReplaceAll(p, `\`, "/")
	p = strings.TrimRight(p, "/")
	return strings.ToLower(p)
}

var drivePath = regexp.MustCompile(`(?i)^[a-z]:[/\\]`)

// MachineFromPath infers the platform from the path shape alone. This is the
// most reliable signal: an agent can report another machine's paths, but a
// D:\ path can only ever live on Windows.
func MachineFromPath(path string) string {
	p := strings.TrimSpace(path)
	if drivePath.MatchString(p) {
		return "windows"
	}
	if strings.HasPrefix(p, "/Users/") {
		return "mac"
	}
	if strings.HasPrefix(p, "~") || strings.HasPrefix(p, ".") {
		return "current"
	}
	return ""
}

// MachineFor resolves a workspace's platform from live metadata first, then
// local metadata, then the path shape. "current" means the control-plane host.
func MachineFor(path, osName, host, node string) string {
	osName = strings.ToLower(strings.TrimSpace(osName))
	host = strings.ToLower(strings.TrimSpace(host))
	node = strings.ToLower(strings.TrimSpace(node))
	if shape := MachineFromPath(path); shape == "windows" {
		return "windows"
	}
	if osName == "windows" || strings.Contains(host, "windows") || node == "windows" {
		return "windows"
	}
	if osName == "mac" || osName == "darwin" || strings.Contains(host, "mac") || node == "mac" || strings.HasPrefix(strings.TrimSpace(path), "/Users/") {
		return "mac"
	}
	if host == "" || host == "localhost" || host == "127.0.0.1" {
		return "current"
	}
	return "linux"
}

// MachineOf is MachineFor on a live record.
func MachineOf(w Workspace) string { return MachineFor(w.Path, w.OS, w.Host, "") }

// Match finds the live record for a path.
func Match(list []Workspace, path string) (Workspace, bool) {
	want := Normalize(path)
	if want == "" {
		return Workspace{}, false
	}
	for _, w := range list {
		if Normalize(w.Path) == want {
			return w, true
		}
	}
	return Workspace{}, false
}

var stalePrefix = regexp.MustCompile(`(?i)^\s*(mac|windows|linux|vps|node|local)\s*[:：]\s*`)

// HasStalePrefix reports whether a name still carries the old imported
// "mac: foo" / "windows: foo" label. Those prefixes were generated from the
// reporting node rather than the path and are frequently wrong.
func HasStalePrefix(name string) bool { return stalePrefix.MatchString(name) }

// CleanName strips a stale node prefix and the path basename fallback.
func CleanName(name, path string) string {
	n := strings.TrimSpace(stalePrefix.ReplaceAllString(name, ""))
	if n != "" {
		return n
	}
	if path == "" {
		return "Workspace"
	}
	p := strings.TrimRight(strings.ReplaceAll(strings.TrimSpace(path), `\`, "/"), "/")
	return filepath.Base(p)
}
