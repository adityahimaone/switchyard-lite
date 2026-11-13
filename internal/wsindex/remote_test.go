package wsindex

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

	"github.com/adityahimaone/switchyard-lite/internal/worker"
)

func gitRun(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func initRepo(t *testing.T, dir string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	gitRun(t, dir, "init", "-q")
	gitRun(t, dir, "config", "user.email", "t@example.com")
	gitRun(t, dir, "config", "user.name", "t")
	if err := os.WriteFile(filepath.Join(dir, "a.txt"), []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitRun(t, dir, "add", "-A")
	gitRun(t, dir, "commit", "-qm", "init")
	return gitRun(t, dir, "rev-parse", "--abbrev-ref", "HEAD")
}

func TestLocalNestedRepoIsDetected(t *testing.T) {
	root := t.TempDir()
	branch := initRepo(t, filepath.Join(root, "app"))

	st, err := New().localState(root)
	if err != nil {
		t.Fatal(err)
	}
	if !st.IsGit || st.Info.Prefix != "app" {
		t.Fatalf("nested repo not detected: %+v", st)
	}
	if st.Current != branch {
		t.Fatalf("current = %q want %q", st.Current, branch)
	}
	found := false
	for _, b := range st.Branches {
		if b == branch {
			found = true
		}
	}
	if !found {
		t.Fatalf("branch %q missing from %v", branch, st.Branches)
	}
}

func TestLocalBranchesHideSymbolicOriginRef(t *testing.T) {
	dir := t.TempDir()
	branch := initRepo(t, dir)
	gitRun(t, dir, "update-ref", "refs/remotes/origin/"+branch, "HEAD")
	gitRun(t, dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/"+branch)

	branches, current, warning := branchesIn(dir, true)
	if warning != "" {
		t.Fatalf("warning: %s", warning)
	}
	if current != branch {
		t.Fatalf("current = %q", current)
	}
	for _, b := range branches {
		if b == "origin" || b == "origin/HEAD" {
			t.Fatalf("symbolic ref leaked into branches: %v", branches)
		}
	}
}

type fakeAgent struct {
	mu   sync.Mutex
	jobs map[string]string
	seen map[string]int
	do   func(cmd string) (string, bool, string)
}

func newFakeAgent(t *testing.T, do func(string) (string, bool, string)) *httptest.Server {
	t.Helper()
	fa := &fakeAgent{jobs: map[string]string{}, seen: map[string]int{}, do: do}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/dispatch":
			var req struct {
				TaskID  string `json:"task_id"`
				Command string `json:"command"`
			}
			_ = json.NewDecoder(r.Body).Decode(&req)
			fa.mu.Lock()
			fa.jobs[req.TaskID] = req.Command
			fa.mu.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "queued"})
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/results/"):
			id := strings.TrimPrefix(r.URL.Path, "/api/results/")
			fa.mu.Lock()
			cmd := fa.jobs[id]
			n := fa.seen[id]
			fa.seen[id] = n + 1
			fa.mu.Unlock()
			if n == 0 {
				http.Error(w, "pending", 404)
				return
			}
			out, success, errText := fa.do(cmd)
			_ = json.NewEncoder(w).Encode(map[string]any{"task_id": id, "success": success, "output": out, "error": errText})
		default:
			http.Error(w, "not found", 404)
		}
	}))
	return srv
}

func TestRemoteStateUsesWorker(t *testing.T) {
	srv := newFakeAgent(t, func(cmd string) (string, bool, string) {
		switch {
		case strings.Contains(cmd, "--show-toplevel"):
			return "D:/xampp/htdocs/demo", true, ""
		case strings.Contains(cmd, "branch -a"):
			return "* main\n  remotes/origin/dev\n  remotes/origin/HEAD -> origin/main", true, ""
		case strings.Contains(cmd, "ls-files"):
			return "app/Models/User.php\nroutes/web.php", true, ""
		}
		return "", true, ""
	})
	defer srv.Close()

	w := worker.New(srv.URL, "")
	w.Poll = time.Millisecond
	w.Wait = 3 * time.Second
	idx := New()
	idx.SetRemote(w)

	st, err := idx.State(context.Background(), `D:\xampp\htdocs\demo`, false)
	if err != nil {
		t.Fatal(err)
	}
	if st.Source != "worker" || st.Local {
		t.Fatalf("source = %q local=%v", st.Source, st.Local)
	}
	if !st.IsGit {
		t.Fatalf("expected git repo: %+v", st)
	}
	if strings.Join(st.Branches, ",") != "main,dev" {
		t.Fatalf("branches = %v", st.Branches)
	}
	if len(st.Files) != 2 {
		t.Fatalf("files = %v", st.Files)
	}

	files, hint, source, _ := idx.FilesCtx(context.Background(), `D:\xampp\htdocs\demo`, "user", 10)
	if source != "worker" || hint != "" || len(files) != 1 || files[0].Path != "app/Models/User.php" {
		t.Fatalf("files search = %+v hint=%q source=%q", files, hint, source)
	}
}

func TestRemoteStateFallsBackWithoutNodeAgent(t *testing.T) {
	idx := New()
	st, err := idx.State(context.Background(), `D:\xampp\htdocs\demo`, false)
	if err != nil {
		t.Fatal(err)
	}
	if st.Source != "none" || !strings.Contains(st.Warning, "worker node") {
		t.Fatalf("unexpected fallback %+v", st)
	}
}

func TestScoreFilesRanksBasenameExactFirst(t *testing.T) {
	files := []string{"src/app.ts", "src/app.tsx", "app.ts"}
	got := scoreFiles(files, "app.ts", 10)
	if len(got) != 3 || got[0].Path != "app.ts" {
		t.Fatalf("unexpected ranking %+v", got)
	}
}
