package dispatch

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Git runs git in dir.
func Git(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	out, err := cmd.CombinedOutput()
	s := strings.TrimSpace(string(out))
	if err != nil {
		return s, fmt.Errorf("git %s: %w: %s", strings.Join(args, " "), err, s)
	}
	return s, nil
}

// IsGit reports whether dir is a git work tree with at least one commit.
func IsGit(dir string) bool {
	if dir == "" {
		return false
	}
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		return false
	}
	_, err := Git(dir, "rev-parse", "--verify", "HEAD")
	return err == nil
}

// Worktree is a per-task checkout on branch sy/<task-id>.
type Worktree struct{ Repo, Path, Branch, BaseSHA string }

// EnsureWorktree creates (or reuses) the worktree for a task from HEAD.
func EnsureWorktree(repo, taskID string) (Worktree, error) {
	return EnsureWorktreeFrom(repo, taskID, "")
}

// EnsureWorktreeFrom creates the isolated worktree from baseBranch when one is
// selected. A bare branch name, origin/<name> and a full ref are all accepted;
// an unresolvable base falls back to HEAD so dispatch never hard-fails on a
// stale branch name.
func EnsureWorktreeFrom(repo, taskID, baseBranch string) (Worktree, error) {
	branch := "sy/" + taskID
	path := filepath.Join(repo, ".switchyard", "worktrees", taskID)
	base, err := Git(repo, "rev-parse", "HEAD")
	if err != nil {
		return Worktree{}, err
	}
	if b := strings.TrimSpace(baseBranch); b != "" && b != "__head" {
		b = strings.TrimPrefix(b, "refs/heads/")
		for _, candidate := range []string{b, "origin/" + b, "refs/remotes/origin/" + b} {
			if sha, e := Git(repo, "rev-parse", "--verify", candidate+"^{commit}"); e == nil && sha != "" {
				base = sha
				break
			}
		}
	}
	if ex, err := Git(repo, "rev-parse", "--git-path", "info/exclude"); err == nil {
		if !filepath.IsAbs(ex) {
			ex = filepath.Join(repo, ex)
		}
		if b, _ := os.ReadFile(ex); !strings.Contains(string(b), ".switchyard/") {
			_ = os.MkdirAll(filepath.Dir(ex), 0o755)
			if f, err := os.OpenFile(ex, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
				_, _ = f.WriteString("\n.switchyard/\n")
				f.Close()
			}
		}
	}
	if _, err := os.Stat(path); err == nil {
		return Worktree{repo, path, branch, base}, nil
	}
	if _, err := Git(repo, "rev-parse", "--verify", branch); err == nil {
		_, err = Git(repo, "worktree", "add", path, branch)
		return Worktree{repo, path, branch, base}, err
	}
	if _, err := Git(repo, "worktree", "add", "-b", branch, path, base); err != nil {
		return Worktree{}, err
	}
	return Worktree{repo, path, branch, base}, nil
}

// RemoveWorktree deletes the checkout but keeps the branch.
func RemoveWorktree(repo, path string) error {
	_, err := Git(repo, "worktree", "remove", "--force", path)
	return err
}
