// Package nodes reads the node-agent's live node report.
//
// The control plane usually runs on a different machine from the workspaces it
// schedules against, so `os.Stat` on a workspace path proves nothing: every
// remote path looks "unreachable" even when the machine is perfectly healthy.
// The node-agent already knows which paths each of its nodes can serve, so that
// report is the authoritative liveness signal.
package nodes

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// FreshWindow is how long a node's last heartbeat is trusted.
const FreshWindow = 90 * time.Second

// Node is one agent-reported machine.
type Node struct {
	NodeID     string    `json:"node_id"`
	Hostname   string    `json:"hostname"`
	Workspaces []string  `json:"workspaces"`
	Executors  []string  `json:"executors"`
	Status     string    `json:"status"`
	LastSeen   time.Time `json:"last_seen"`
}

// Fresh reports whether the node checked in recently enough to be trusted.
func (n Node) Fresh(now time.Time) bool {
	switch strings.ToLower(strings.TrimSpace(n.Status)) {
	case "offline", "stopped", "dead":
		return false
	}
	if n.LastSeen.IsZero() {
		return false
	}
	return now.Sub(n.LastSeen) <= FreshWindow
}

// Registry caches GET {base}/api/nodes.
type Registry struct {
	BaseURL string
	Token   string
	TTL     time.Duration
	HTTP    *http.Client
	Now     func() time.Time

	mu   sync.Mutex
	at   time.Time
	data []Node
}

// New returns a registry pointed at the node-agent.
func New(base, token string) *Registry {
	return &Registry{BaseURL: base, Token: token, TTL: 8 * time.Second, Now: time.Now}
}

// List returns the cached node report, refreshing it when stale. A nil or
// unconfigured registry returns an empty list so callers degrade quietly.
func (r *Registry) List(ctx context.Context) ([]Node, error) {
	if r == nil || r.BaseURL == "" {
		return nil, nil
	}
	r.mu.Lock()
	at, data := r.at, r.data
	r.mu.Unlock()
	if !at.IsZero() && r.Now().Sub(at) < r.TTL {
		return data, nil
	}

	u := strings.TrimRight(r.BaseURL, "/") + "/api/nodes"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return data, err
	}
	if r.Token != "" {
		req.Header.Set("X-Node-Agent-Token", r.Token)
	}
	h := r.HTTP
	if h == nil {
		h = &http.Client{Timeout: 3 * time.Second}
	}
	resp, err := h.Do(req)
	if err != nil {
		return data, err // serve stale
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return data, fmt.Errorf("node-agent nodes: %d", resp.StatusCode)
	}
	var list []Node
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		return data, err
	}
	r.mu.Lock()
	r.at, r.data = r.Now(), list
	r.mu.Unlock()
	return list, nil
}

// Match finds the node that reports path as one of its workspaces.
func Match(list []Node, path string) (Node, bool) {
	want := normalize(path)
	if want == "" {
		return Node{}, false
	}
	for _, n := range list {
		for _, p := range n.Workspaces {
			if normalize(p) == want {
				return n, true
			}
		}
	}
	return Node{}, false
}

// Lookup is Match against a freshly-listed report.
func (r *Registry) Lookup(ctx context.Context, path string) (Node, bool) {
	list, _ := r.List(ctx)
	return Match(list, path)
}

// Normalize makes paths comparable across platforms: separators unified,
// trailing slash dropped, and case folded (Windows paths are case-insensitive
// and the agent reports them verbatim).
func Normalize(p string) string {
	p = strings.TrimSpace(p)
	if p == "" {
		return ""
	}
	p = strings.ReplaceAll(p, `\`, "/")
	p = strings.TrimRight(p, "/")
	return strings.ToLower(p)
}

func normalize(p string) string { return Normalize(p) }

// MachineOf infers a node's platform from its id and hostname.
func MachineOf(n Node) string {
	s := strings.ToLower(n.NodeID + " " + n.Hostname)
	switch {
	case strings.Contains(s, "windows"), strings.Contains(s, "win32"), strings.Contains(s, "rtx"):
		return "windows"
	case strings.Contains(s, "mac"), strings.Contains(s, "darwin"), strings.Contains(s, "macbook"):
		return "mac"
	case strings.Contains(s, "linux"):
		return "linux"
	}
	return ""
}

// Find resolves the node that should serve path.
//
// An agent can report paths inherited from another machine's workspaces.json:
// the mac agent currently lists the Windows D:\xampp\htdocs checkouts too.
// A plain path match therefore mislabels those Windows workspaces as "mac".
// When machine is known, prefer a node on that machine; a healthy node on the
// right machine is still a better liveness signal than a stale path claim.
// The bool reports whether the path was claimed verbatim by that node.
func Find(list []Node, path, machine string) (Node, bool) {
	want := Normalize(path)
	if machine != "" && want != "" {
		for _, n := range list {
			if MachineOf(n) != machine {
				continue
			}
			for _, p := range n.Workspaces {
				if Normalize(p) == want {
					return n, true
				}
			}
		}
		for _, n := range list {
			if MachineOf(n) == machine {
				return n, false
			}
		}
	}
	return Match(list, path)
}
