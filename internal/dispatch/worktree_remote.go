package dispatch

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/adityahimaone/switchyard-lite/internal/tasks"
	"github.com/adityahimaone/switchyard-lite/internal/worker"
)

// prepareWorktree isolates a task in sy/<task-id>, on this host when the repo
// is visible here and on the owning worker when it is not. Returning nil means
// the workspace is not a git checkout (scratch/dir tasks still dispatch).
func (d *Dispatcher) prepareWorktree(ctx context.Context, t tasks.Task) (*Worktree, string, error) {
	if strings.TrimSpace(t.Workspace) == "" {
		return nil, "", nil
	}
	if repo, ok := localRepoRoot(t.Workspace); ok {
		wt, err := EnsureWorktreeFrom(repo, t.ID, t.Branch)
		if err != nil {
			return nil, "", err
		}
		return &wt, "local", nil
	}
	// A path that exists here belongs to this host: never ask a worker to
	// inspect it. This also keeps scratch/non-git local workspaces on the old
	// (no isolation) path instead of burning a remote shell job.
	if st, statErr := os.Stat(t.Workspace); statErr == nil && st.IsDir() {
		return nil, "", nil
	}
	if d.Remote == nil || !d.Remote.Enabled() {
		return nil, "", nil
	}
	info, err := d.Remote.Info(ctx, t.Workspace, false)
	if err != nil || !info.IsGit {
		// A worker that is offline should not block dispatch; the task simply
		// runs in the workspace directly, as it did before isolation existed.
		return nil, "", nil
	}
	wt, err := d.ensureRemoteWorktree(ctx, t.Workspace, t.ID, t.Branch, info)
	if err != nil {
		return nil, "", err
	}
	return &wt, "worker", nil
}

// localRepoRoot resolves the repository for a checkout visible on this host.
// Some registered workspaces are parents of a repo (e.g. saas/gadjian/app), so
// the git root can be one level below the workspace path.
func localRepoRoot(workspace string) (string, bool) {
	if IsGit(workspace) {
		return workspace, true
	}
	entries, err := os.ReadDir(workspace)
	if err != nil {
		return "", false
	}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		candidate := filepath.Join(workspace, e.Name())
		if st, statErr := os.Stat(filepath.Join(candidate, ".git")); statErr == nil && (st.IsDir() || st.Mode().IsRegular()) {
			return candidate, true
		}
	}
	return "", false
}

// ensureRemoteWorktree mirrors EnsureWorktreeFrom but runs every git command on
// the node that owns the checkout. Paths keep the registry's separator so
// node-agent's workspace-prefix routing still matches on Windows nodes.
func (d *Dispatcher) ensureRemoteWorktree(ctx context.Context, workspace, taskID, baseBranch string, info worker.Info) (Worktree, error) {
	c := d.Remote
	base, err := c.Git(ctx, workspace, info, "rev-parse", "HEAD")
	if err != nil {
		return Worktree{}, err
	}
	base = strings.TrimSpace(base)
	if b := strings.TrimSpace(baseBranch); b != "" && b != "__head" && b != "__head__" {
		b = strings.TrimPrefix(b, "refs/heads/")
		for _, candidate := range []string{b, "origin/" + b, "refs/remotes/origin/" + b} {
			sha, e := c.Git(ctx, workspace, info, "rev-parse", "--verify", candidate+"^{commit}")
			if e == nil && strings.TrimSpace(sha) != "" {
				base = strings.TrimSpace(sha)
				break
			}
		}
	}

	repoDir := workspace
	if info.Prefix != "" {
		repoDir = worker.JoinRemote(workspace, info.Prefix)
	}
	path := worker.JoinRemote(repoDir, ".switchyard/worktrees/"+taskID)
	branch := "sy/" + taskID

	// A retry reuses the worktree left behind by the previous attempt.
	if out, e := c.Git(ctx, workspace, info, "worktree", "list", "--porcelain"); e == nil && strings.Contains(out, path) {
		return Worktree{repoDir, path, branch, base}, nil
	}
	if _, e := c.Git(ctx, workspace, info, "rev-parse", "--verify", branch); e == nil {
		if _, err := c.Git(ctx, workspace, info, "worktree", "add", path, branch); err != nil {
			return Worktree{}, err
		}
		return Worktree{repoDir, path, branch, base}, nil
	}
	if _, err := c.Git(ctx, workspace, info, "worktree", "add", "-b", branch, path, base); err != nil {
		return Worktree{}, err
	}
	return Worktree{repoDir, path, branch, base}, nil
}
