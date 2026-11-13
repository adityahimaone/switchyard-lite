package dispatch

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/store"
	"github.com/adityahimaone/switchyard-lite/internal/tasks"
)

type remoteProbe struct {
	mu   sync.Mutex
	cmds []string
}

func (p *remoteProbe) record(cmd string) {
	p.mu.Lock()
	p.cmds = append(p.cmds, cmd)
	p.mu.Unlock()
}

func (p *remoteProbe) commands() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.cmds...)
}

func fakeNodeAgent(t *testing.T) (*httptest.Server, *remoteProbe) {
	t.Helper()
	probe := &remoteProbe{}
	jobs := map[string]string{}
	seen := map[string]int{}
	var mu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/dispatch":
			var req struct {
				TaskID  string `json:"task_id"`
				Command string `json:"command"`
			}
			_ = json.NewDecoder(r.Body).Decode(&req)
			mu.Lock()
			jobs[req.TaskID] = req.Command
			mu.Unlock()
			probe.record(req.Command)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "queued"})
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/results/"):
			id := strings.TrimPrefix(r.URL.Path, "/api/results/")
			mu.Lock()
			cmd := jobs[id]
			n := seen[id]
			seen[id] = n + 1
			mu.Unlock()
			if n == 0 {
				http.Error(w, "pending", 404)
				return
			}
			out, ok, errText := "", true, ""
			switch {
			case strings.Contains(cmd, "--show-toplevel"):
				out = "D:/xampp/htdocs/demo"
			case strings.Contains(cmd, "rev-parse HEAD"):
				out = "abc123"
			case strings.Contains(cmd, "rev-parse --verify"):
				ok, errText = false, "fatal: Needed a single revision"
			case strings.Contains(cmd, "worktree list"):
				out = ""
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"task_id": id, "success": ok, "output": out, "error": errText})
		default:
			http.Error(w, "not found", 404)
		}
	}))
	return srv, probe
}

func TestPrepareWorktreeCreatesRemoteWorktree(t *testing.T) {
	srv, probe := fakeNodeAgent(t)
	defer srv.Close()
	s, _ := store.Open(":memory:")
	defer s.Close()
	d, err := New(s, Config{NodeAgentURL: srv.URL})
	if err != nil {
		t.Fatal(err)
	}
	d.Remote.Poll = time.Millisecond
	d.Remote.Wait = 3 * time.Second

	wt, transport, err := d.prepareWorktree(context.Background(), tasks.Task{
		ID: "t1", Workspace: `D:\xampp\htdocs\demo`, Branch: "dev",
	})
	if err != nil {
		t.Fatal(err)
	}
	if transport != "worker" || wt == nil {
		t.Fatalf("transport=%q wt=%+v", transport, wt)
	}
	if wt.Branch != "sy/t1" || wt.BaseSHA != "abc123" {
		t.Fatalf("worktree = %+v", wt)
	}
	if !strings.HasSuffix(wt.Path, `\.switchyard\worktrees\t1`) {
		t.Fatalf("path = %q", wt.Path)
	}
	joined := strings.Join(probe.commands(), "\n")
	if !strings.Contains(joined, "worktree add -b sy/t1") {
		t.Fatalf("worktree add not issued:\n%s", joined)
	}
}

func TestPrepareWorktreeLeavesLocalRepoOnHost(t *testing.T) {
	dir := t.TempDir()
	if out, err := exec.Command("git", "-C", dir, "init", "-q").CombinedOutput(); err != nil {
		t.Fatalf("git init: %v %s", err, out)
	}
	_ = os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a"), 0o644)
	for _, args := range [][]string{
		{"config", "user.email", "t@example.com"},
		{"config", "user.name", "t"},
		{"add", "-A"},
		{"commit", "-qm", "init"},
	} {
		if out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v %s", args, err, out)
		}
	}
	srv, probe := fakeNodeAgent(t)
	defer srv.Close()
	s, _ := store.Open(":memory:")
	defer s.Close()
	d, err := New(s, Config{NodeAgentURL: srv.URL})
	if err != nil {
		t.Fatal(err)
	}

	wt, transport, err := d.prepareWorktree(context.Background(), tasks.Task{ID: "t2", Workspace: dir})
	if err != nil {
		t.Fatal(err)
	}
	if transport != "local" || wt == nil {
		t.Fatalf("transport=%q wt=%+v", transport, wt)
	}
	if len(probe.commands()) != 0 {
		t.Fatalf("local repo should not touch the worker: %v", probe.commands())
	}
}
