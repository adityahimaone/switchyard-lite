package worker

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeAgent struct {
	mu     sync.Mutex
	jobs   map[string]string
	polls  map[string]int
	cmds   []string
	handle func(command string) (output string, success bool, errText string)
}

func newFakeAgent(t *testing.T, handle func(string) (string, bool, string)) (*httptest.Server, *fakeAgent) {
	t.Helper()
	fa := &fakeAgent{jobs: map[string]string{}, polls: map[string]int{}, handle: handle}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/dispatch":
			var req shellRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "bad json", 400)
				return
			}
			fa.mu.Lock()
			fa.jobs[req.TaskID] = req.Command
			fa.cmds = append(fa.cmds, req.Command)
			fa.mu.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "queued", "node_id": "mac", "transport": "http"})
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/results/"):
			id := strings.TrimPrefix(r.URL.Path, "/api/results/")
			fa.mu.Lock()
			cmd, ok := fa.jobs[id]
			n := fa.polls[id]
			fa.polls[id] = n + 1
			fa.mu.Unlock()
			if !ok {
				http.Error(w, "not found", 404)
				return
			}
			// First poll is pending so the polling loop is exercised.
			if n == 0 {
				http.Error(w, "pending", 404)
				return
			}
			out, success, errText := fa.handle(cmd)
			_ = json.NewEncoder(w).Encode(shellResult{TaskID: id, Success: success, Output: out, Error: errText})
		default:
			http.Error(w, "not found", 404)
		}
	}))
	return srv, fa
}

func testClient(url string) *Client {
	c := New(url, "")
	c.Wait = 3 * time.Second
	c.Poll = time.Millisecond
	return c
}

func TestShellStripsProvenance(t *testing.T) {
	srv, _ := newFakeAgent(t, func(string) (string, bool, string) {
		return "provenance executor=shell requested=shell ws=/repo\nmain\nfeature/x", true, ""
	})
	defer srv.Close()
	out, err := testClient(srv.URL).Shell(context.Background(), "/repo", "git branch")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, "provenance") || !strings.Contains(out, "feature/x") {
		t.Fatalf("unexpected output %q", out)
	}
}

func TestShellSurfacesWorkerError(t *testing.T) {
	srv, _ := newFakeAgent(t, func(string) (string, bool, string) {
		return "", false, "fatal: not a git repository"
	})
	defer srv.Close()
	_, err := testClient(srv.URL).Shell(context.Background(), "/repo", "git status")
	if err == nil || !strings.Contains(err.Error(), "not a git repository") {
		t.Fatalf("want worker error, got %v", err)
	}
}

func TestBranchesFiltersSymbolicAndWorktreeRefs(t *testing.T) {
	srv, _ := newFakeAgent(t, func(cmd string) (string, bool, string) {
		switch {
		case strings.Contains(cmd, "--show-toplevel"):
			return "/Users/dev/app", true, ""
		case strings.Contains(cmd, "branch -a"):
			return strings.Join([]string{
				"* main",
				"  feature/x",
				"  remotes/origin/dev",
				"  remotes/origin/HEAD -> origin/main",
				"  remotes/origin/sy/t1",
			}, "\n"), true, ""
		}
		return "", true, ""
	})
	defer srv.Close()
	c := testClient(srv.URL)
	info, err := c.Info(context.Background(), "/Users/dev/app", false)
	if err != nil || !info.IsGit {
		t.Fatalf("info: %+v %v", info, err)
	}
	branches, current, err := c.Branches(context.Background(), "/Users/dev/app", info)
	if err != nil {
		t.Fatal(err)
	}
	if current != "main" {
		t.Fatalf("current = %q", current)
	}
	got := strings.Join(branches, ",")
	if got != "main,feature/x,dev" {
		t.Fatalf("branches = %q", got)
	}
}

func TestInfoDiscoversNestedRepo(t *testing.T) {
	srv, _ := newFakeAgent(t, func(cmd string) (string, bool, string) {
		switch {
		case strings.Contains(cmd, "-C app"):
			return "/repo/app", true, ""
		case strings.Contains(cmd, "ls -d"):
			return "./app/.git", true, ""
		case strings.Contains(cmd, "--show-toplevel"):
			return "", false, "fatal: not a git repository"
		}
		return "", true, ""
	})
	defer srv.Close()
	info, err := testClient(srv.URL).Info(context.Background(), "/repo", false)
	if err != nil {
		t.Fatal(err)
	}
	if !info.IsGit || info.Prefix != "app" || info.Root != "/repo/app" {
		t.Fatalf("unexpected info %+v", info)
	}
}

func TestQuoteAndJoinRemote(t *testing.T) {
	if got := Quote("feature/x", false); got != "feature/x" {
		t.Fatalf("plain arg quoted: %q", got)
	}
	if got := Quote("my repo", false); got != "'my repo'" {
		t.Fatalf("posix quote: %q", got)
	}
	if got := JoinRemote(`D:\xampp\htdocs\app`, ".switchyard", "worktrees", "t1"); got != `D:\xampp\htdocs\app\.switchyard\worktrees\t1` {
		t.Fatalf("windows join: %q", got)
	}
	if got := JoinRemote("/Users/dev/app", ".switchyard", "worktrees/t1"); got != "/Users/dev/app/.switchyard/worktrees/t1" {
		t.Fatalf("posix join: %q", got)
	}
	if !IsWindowsPath(`D:\repo`) || IsWindowsPath("/Users/dev") {
		t.Fatal("windows path detection")
	}
}
