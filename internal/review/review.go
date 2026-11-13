// Package review shows a task's diff and applies approve / reject.
//
// Git worktrees can live on the control plane or on a worker node. The
// task_worktrees.transport column records which, so diff/approve run git on the
// machine that can actually see the files instead of failing with ErrNoWorktree.
package review

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/adityahimaone/switchyard-lite/internal/dispatch"
	"github.com/adityahimaone/switchyard-lite/internal/store"
	"github.com/adityahimaone/switchyard-lite/internal/tasks"
	"github.com/adityahimaone/switchyard-lite/internal/worker"
)

var ErrNoWorktree = errors.New("task has no git worktree")

type Service struct {
	S      *store.Store
	Tasks  *tasks.Service
	Remote *worker.Client
}

// SetRemote attaches the node-agent client used to run git on remote worktrees.
func (v *Service) SetRemote(c *worker.Client) { v.Remote = c }

func New(s *store.Store) (*Service, error) {
	if err := s.EnsureDispatch(); err != nil {
		return nil, err
	}
	return &Service{S: s, Tasks: tasks.New(s)}, nil
}

type wt struct{ repo, path, branch, base, transport string }

func (v *Service) wt(id string) (wt, error) {
	var w wt
	err := v.S.DB.QueryRow(`SELECT repo,path,branch,base_sha,transport FROM task_worktrees WHERE task_id=?`, id).
		Scan(&w.repo, &w.path, &w.branch, &w.base, &w.transport)
	if err != nil {
		return w, ErrNoWorktree
	}
	return w, nil
}

func (v *Service) isRemote(w wt) bool { return w.transport == "worker" }

// AutoMerge reports the opt-in setting.
func (v *Service) AutoMerge() bool {
	var s string
	_ = v.S.DB.QueryRow(`SELECT value FROM dispatch_settings WHERE key='auto_merge'`).Scan(&s)
	return s == "true"
}

func (v *Service) SetAutoMerge(on bool) error {
	val := "false"
	if on {
		val = "true"
	}
	_, err := v.S.DB.Exec(`INSERT INTO dispatch_settings(key,value) VALUES('auto_merge',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, val)
	return err
}

// Diff is the branch diff against the base SHA (includes uncommitted work).
func (v *Service) Diff(id string) (string, error) {
	w, err := v.wt(id)
	if err != nil {
		return "", err
	}
	if v.isRemote(w) {
		return v.diffRemote(w)
	}
	// stage everything so new files show up in the diff
	if _, err := dispatch.Git(w.path, "add", "-A"); err != nil {
		return "", err
	}
	return dispatch.Git(w.path, "diff", "--cached", w.base)
}

func (v *Service) diffRemote(w wt) (string, error) {
	if v.Remote == nil || !v.Remote.Enabled() {
		return "", fmt.Errorf("worktree lives on a worker node but node-agent is not configured")
	}
	ctx := context.Background()
	if _, err := v.Remote.Git(ctx, w.path, worker.Info{}, "add", "-A"); err != nil {
		return "", err
	}
	return v.Remote.Git(ctx, w.path, worker.Info{}, "diff", "--cached", w.base)
}

// Approve moves review→done. Branch is kept; merged only if auto_merge is on.
func (v *Service) Approve(id string) (tasks.Task, error) {
	t, err := v.Tasks.Get(id)
	if err != nil {
		return t, err
	}
	if t.Status != tasks.Review {
		return t, fmt.Errorf("%w: task is %s, not review", tasks.ErrBadMove, t.Status)
	}
	if w, err := v.wt(id); err == nil {
		if v.isRemote(w) {
			if err := v.approveRemote(w, t); err != nil {
				return t, err
			}
		} else {
			if _, err := dispatch.Git(w.path, "add", "-A"); err != nil {
				return t, err
			}
			if out, _ := dispatch.Git(w.path, "status", "--porcelain"); out != "" {
				if _, err := dispatch.Git(w.path, "commit", "-m", "switchyard: "+t.Title, "--no-verify"); err != nil {
					return t, err
				}
			}
			_ = dispatch.RemoveWorktree(w.repo, w.path)
			if v.AutoMerge() {
				if _, err := dispatch.Git(w.repo, "merge", "--no-ff", "-m", "merge "+w.branch, w.branch); err != nil {
					_, _ = dispatch.Git(w.repo, "merge", "--abort")
					return t, fmt.Errorf("%w: auto-merge failed: %v", tasks.ErrBadMove, err)
				}
			}
		}
	}
	return v.Tasks.Move(id, tasks.Done, "reviewer")
}

func (v *Service) approveRemote(w wt, t tasks.Task) error {
	if v.Remote == nil || !v.Remote.Enabled() {
		return fmt.Errorf("worktree lives on a worker node but node-agent is not configured")
	}
	ctx := context.Background()
	c := v.Remote
	// Inside the worktree itself the repo root is the cwd, so no -C is needed.
	if _, err := c.Git(ctx, w.path, worker.Info{}, "add", "-A"); err != nil {
		return err
	}
	if out, _ := c.Git(ctx, w.path, worker.Info{}, "status", "--porcelain"); strings.TrimSpace(out) != "" {
		if _, err := c.Git(ctx, w.path, worker.Info{}, "commit", "-m", "switchyard: "+t.Title, "--no-verify"); err != nil {
			return err
		}
	}
	// repo is the registered workspace (or its nested repo directory); resolve
	// its git prefix once so nested SaaS repositories work too.
	info, err := c.Info(ctx, w.repo, false)
	if err != nil {
		return err
	}
	_, _ = c.Git(ctx, w.repo, info, "worktree", "remove", "--force", w.path)
	if v.AutoMerge() {
		if _, err := c.Git(ctx, w.repo, info, "merge", "--no-ff", "-m", "merge "+w.branch, w.branch); err != nil {
			_, _ = c.Git(ctx, w.repo, info, "merge", "--abort")
			return fmt.Errorf("%w: auto-merge failed: %v", tasks.ErrBadMove, err)
		}
	}
	return nil
}

// Reject records feedback and requeues the task (worktree is kept).
func (v *Service) Reject(id, feedback string) (tasks.Task, error) {
	if feedback == "" {
		return tasks.Task{}, fmt.Errorf("%w: feedback required", tasks.ErrBadRequest)
	}
	t, err := v.Tasks.Get(id)
	if err != nil {
		return t, err
	}
	if t.Status != tasks.Review {
		return t, fmt.Errorf("%w: task is %s, not review", tasks.ErrBadMove, t.Status)
	}
	if _, err := v.Tasks.AddComment(id, "reviewer", "Changes requested: "+feedback); err != nil {
		return t, err
	}
	return v.Tasks.Move(id, tasks.Todo, "reviewer")
}
