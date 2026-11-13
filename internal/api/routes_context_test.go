package api

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/adityahimaone/switchyard-lite/internal/store"
)

func gitDo(t *testing.T, dir string, args ...string) string {
	t.Helper()
	out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func makeRepo(t *testing.T) (dir, branch string) {
	t.Helper()
	dir = t.TempDir()
	gitDo(t, dir, "init", "-q")
	gitDo(t, dir, "config", "user.email", "t@example.com")
	gitDo(t, dir, "config", "user.name", "t")
	if err := os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module demo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "TaskDialog.tsx"), []byte("export {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitDo(t, dir, "add", "-A")
	gitDo(t, dir, "commit", "-qm", "init")
	return dir, gitDo(t, dir, "rev-parse", "--abbrev-ref", "HEAD")
}

func decode(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("bad json %s: %v", body, err)
	}
	return out
}

func TestWorkspaceInspectAndBranchesUseRealRepo(t *testing.T) {
	dir, branch := makeRepo(t)
	// A symbolic origin ref used to leak into the picker as a branch named "origin".
	gitDo(t, dir, "update-ref", "refs/remotes/origin/"+branch, "HEAD")
	gitDo(t, dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/"+branch)

	s, _ := store.Open(":memory:")
	defer s.Close()
	h := New(s).Handler()
	tok, _ := CreateToken(s, "r", "read")

	w := do(t, h, "GET", "/api/v1/workspaces/inspect?path="+dir, tok, "")
	if w.Code != 200 {
		t.Fatalf("inspect %d %s", w.Code, w.Body)
	}
	inspect := decode(t, w.Body.Bytes())
	if inspect["is_git"] != true || inspect["local"] != true {
		t.Fatalf("inspect = %v", inspect)
	}
	branches, _ := inspect["branches"].([]any)
	if len(branches) == 0 {
		t.Fatalf("no branches in %v", inspect)
	}
	for _, b := range branches {
		if b == "origin" || b == "origin/HEAD" {
			t.Fatalf("symbolic ref leaked: %v", branches)
		}
	}

	w = do(t, h, "GET", "/api/v1/workspaces/branches?path="+dir, tok, "")
	br := decode(t, w.Body.Bytes())
	if br["current"] != branch || br["is_git"] != true {
		t.Fatalf("branches = %v", br)
	}
}

func TestWorkspaceFilesAndDefaults(t *testing.T) {
	dir, _ := makeRepo(t)
	s, _ := store.Open(":memory:")
	defer s.Close()
	h := New(s).Handler()
	tok, _ := CreateToken(s, "r", "read")

	w := do(t, h, "GET", "/api/v1/workspaces/files?path="+dir+"&q=TaskDialog", tok, "")
	if w.Code != 200 {
		t.Fatalf("files %d %s", w.Code, w.Body)
	}
	files := decode(t, w.Body.Bytes())
	list, _ := files["files"].([]any)
	if len(list) != 1 || files["source"] != "local" {
		t.Fatalf("files = %v", files)
	}

	w = do(t, h, "GET", "/api/v1/workspaces/defaults?path="+dir, tok, "")
	defs := decode(t, w.Body.Bytes())
	if defs["suggested_gate_command"] != "go test ./..." {
		t.Fatalf("defaults = %v", defs)
	}
}

func TestWorkspaceInspectDegradesForRemoteWithoutNodeAgent(t *testing.T) {
	s, _ := store.Open(":memory:")
	defer s.Close()
	h := New(s).Handler()
	tok, _ := CreateToken(s, "r", "read")

	w := do(t, h, "GET", "/api/v1/workspaces/inspect?path="+`D:\xampp\htdocs\demo`, tok, "")
	if w.Code != 200 {
		t.Fatalf("inspect %d %s", w.Code, w.Body)
	}
	got := decode(t, w.Body.Bytes())
	if got["local"] != false || got["source"] != "none" {
		t.Fatalf("inspect = %v", got)
	}
	if msg, _ := got["warning"].(string); !strings.Contains(msg, "worker node") {
		t.Fatalf("missing worker warning: %v", got)
	}
}

func TestFlowActiveReportsStageAndDependencies(t *testing.T) {
	s, _ := store.Open(":memory:")
	defer s.Close()
	h := New(s).Handler()
	tok, _ := CreateToken(s, "admin", "admin")

	w := do(t, h, "POST", "/api/v1/boards", tok, `{"name":"demo"}`)
	board := between(w.Body.String(), `"id":"`, `"`)
	w = do(t, h, "POST", "/api/v1/tasks", tok, `{"board_id":"`+board+`","title":"first"}`)
	first := between(w.Body.String(), `"id":"`, `"`)
	w = do(t, h, "POST", "/api/v1/tasks", tok, `{"board_id":"`+board+`","title":"second"}`)
	second := between(w.Body.String(), `"id":"`, `"`)
	if c := do(t, h, "POST", "/api/v1/tasks/"+second+"/dependencies", tok, `{"blocked_by":"`+first+`"}`).Code; c != 204 {
		t.Fatalf("dependency %d", c)
	}

	w = do(t, h, "GET", "/api/v1/flow/active?board_id="+board, tok, "")
	if w.Code != 200 {
		t.Fatalf("flow %d %s", w.Code, w.Body)
	}
	var flow struct {
		Tasks []flowTask `json:"tasks"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &flow); err != nil {
		t.Fatal(err)
	}
	if len(flow.Tasks) != 2 {
		t.Fatalf("tasks = %+v", flow.Tasks)
	}
	byID := map[string]flowTask{}
	for _, ft := range flow.Tasks {
		byID[ft.TaskID] = ft
	}
	if byID[first].Stage != "queued" {
		t.Fatalf("first stage = %q", byID[first].Stage)
	}
	if len(byID[second].BlockedBy) != 1 || byID[second].BlockedBy[0] != first {
		t.Fatalf("deps = %+v", byID[second].BlockedBy)
	}
}
