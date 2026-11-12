package review_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/dispatch"
	"github.com/adityahimaone/switchyard-lite/internal/review"
	"github.com/adityahimaone/switchyard-lite/internal/store"
	"github.com/adityahimaone/switchyard-lite/internal/tasks"
)

func gitCmd(t *testing.T, dir string, args ...string) {
	t.Helper()
	c := exec.Command("git", append([]string{"-C", dir, "-c", "user.email=a@b", "-c", "user.name=n"}, args...)...)
	if out, err := c.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %s", args, out)
	}
}

func TestWorktreeDiffApproveReject(t *testing.T) {
	var lastReq dispatch.Request
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "POST" && r.URL.Path == "/api/dispatch":
			_ = json.NewDecoder(r.Body).Decode(&lastReq)
			_ = os.WriteFile(filepath.Join(lastReq.Workspace, "new.txt"), []byte("hi\n"), 0o644)
			w.WriteHeader(202)
		case strings.HasPrefix(r.URL.Path, "/api/results/"):
			id := strings.TrimPrefix(r.URL.Path, "/api/results/")
			_ = json.NewEncoder(w).Encode(dispatch.Result{TaskID: id, Success: true, Output: "done"})
		}
	}))
	defer srv.Close()

	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	d, err := dispatch.New(s, dispatch.Config{NodeAgentURL: srv.URL, Token: "tok", Poll: 10 * time.Millisecond, Lease: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	b, _ := d.Tasks.CreateBoard("b")
	repo := t.TempDir()
	gitCmd(t, repo, "init", "-q")
	_ = os.WriteFile(filepath.Join(repo, "a.txt"), []byte("1\n"), 0o644)
	gitCmd(t, repo, "add", ".")
	gitCmd(t, repo, "commit", "-qm", "init")

	tk, err := d.Tasks.Create(tasks.NewTask{BoardID: b.ID, Title: "t", Prompt: "do it", Workspace: repo})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := d.Start(context.Background(), tk.ID); err != nil {
		t.Fatal(err)
	}
	d.Wait()
	if !strings.HasSuffix(filepath.Dir(lastReq.Workspace), "worktrees") {
		t.Fatalf("workspace not a worktree: %s", lastReq.Workspace)
	}
	rv, _ := review.New(s)
	diff, err := rv.Diff(tk.ID)
	if err != nil || !strings.Contains(diff, "new.txt") {
		t.Fatalf("diff=%q err=%v", diff, err)
	}
	if _, err := rv.Reject(tk.ID, "nope"); err != nil {
		t.Fatal(err)
	}
	if g, _ := d.Tasks.Get(tk.ID); g.Status != tasks.Todo {
		t.Fatalf("after reject %s", g.Status)
	}
	if _, err := d.Start(context.Background(), tk.ID); err != nil {
		t.Fatal(err)
	}
	d.Wait()
	_ = rv.SetAutoMerge(true)
	if _, err := rv.Approve(tk.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(repo, "new.txt")); err != nil {
		t.Fatal("auto-merge did not land file")
	}
	if g, _ := d.Tasks.Get(tk.ID); g.Status != tasks.Done {
		t.Fatalf("status %s", g.Status)
	}
}
