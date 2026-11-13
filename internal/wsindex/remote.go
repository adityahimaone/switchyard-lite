package wsindex

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/worker"
)

// State is everything the create-task composer needs to know about a
// workspace, resolved either on this host or on the node that owns it.
type State struct {
	Files    []string
	Branches []string
	Current  string
	Warning  string
	Hint     string
	IsGit    bool
	Local    bool
	Source   string // "local" | "worker" | "none"
	Info     worker.Info
}

type remoteEntry struct {
	at    time.Time
	state State
}

// SetRemote attaches a node-agent client. Without one, non-local workspaces
// degrade to the manually-typed path/branch flow.
func (x *Index) SetRemote(c *worker.Client) {
	x.mu.Lock()
	defer x.mu.Unlock()
	x.remote = c
}

// Invalidate drops cached file/branch state for one workspace (used by the
// composer's refresh button).
func (x *Index) Invalidate(root string) {
	x.mu.Lock()
	delete(x.cache, root)
	delete(x.remoteCache, root)
	x.mu.Unlock()
}

// Remote exposes the worker client to dispatch/review, which need the same
// resolution to create worktrees and compute diffs on the owning node.
func (x *Index) Remote() *worker.Client { return x.remote }

func (x *Index) cachedRemote(root string) (State, bool) {
	x.mu.Lock()
	defer x.mu.Unlock()
	e, ok := x.remoteCache[root]
	if !ok || x.Now().Sub(e.at) >= x.TTL {
		return State{}, false
	}
	return e.state, true
}

func (x *Index) storeRemote(root string, s State) {
	x.mu.Lock()
	x.remoteCache[root] = remoteEntry{x.Now(), s}
	x.mu.Unlock()
}

// State resolves files and branches from the machine that can actually see the
// checkout. It is the single source of truth behind inspect/branches/files.
func (x *Index) State(ctx context.Context, root string, refresh bool) (State, error) {
	if refresh {
		x.Invalidate(root)
	}
	if Local(root) {
		return x.localState(root)
	}
	if x.remote != nil && x.remote.Enabled() {
		if s, ok := x.cachedRemote(root); ok {
			return s, nil
		}
		s, err := x.workerState(ctx, root, refresh)
		if err != nil {
			return State{
				Files: []string{}, Branches: []string{}, Local: false, Source: "none",
				Warning: err.Error(), Hint: err.Error(),
			}, err
		}
		x.storeRemote(root, s)
		return s, nil
	}
	return State{
		Files: []string{}, Branches: []string{}, Local: false, Source: "none",
		Warning: "Branches are resolved on the worker node at dispatch time. Type a branch to use as the worktree base.",
		Hint:    "This workspace lives on a worker node, so its files are not indexed here. Type a relative path to attach it manually.",
	}, nil
}

func (x *Index) workerState(ctx context.Context, root string, refresh bool) (State, error) {
	info, err := x.remote.Info(ctx, root, refresh)
	if err != nil {
		return State{}, fmt.Errorf("workspace probe failed on the worker node: %v", err)
	}
	branches, current, berr := x.remote.Branches(ctx, root, info)
	files, ferr := x.remote.Files(ctx, root, info)
	s := State{
		Files: files, Branches: branches, Current: current,
		IsGit: info.IsGit, Local: false, Source: "worker", Info: info,
	}
	if !info.IsGit {
		s.Warning = info.Warning
	}
	if berr != nil && s.Warning == "" {
		s.Warning = "Could not read branches on the worker node: " + firstLine(berr.Error())
	}
	if ferr != nil {
		s.Hint = "Could not list files on the worker node: " + firstLine(ferr.Error())
	} else if len(files) == 0 {
		s.Hint = "No files found in this workspace on the worker node."
	}
	return s, nil
}

// localState resolves a checkout visible on this host, including repositories
// nested one level below the registered workspace root (e.g. saas/gadjian/app).
func (x *Index) localState(root string) (State, error) {
	prefix := localGitPrefix(root)
	repo := root
	if prefix != "" {
		repo = filepath.Join(root, filepath.FromSlash(prefix))
	}
	isGit := isGitDir(repo)
	files, hint := x.fileList(repo)
	branches, current, warning := branchesIn(repo, isGit)
	return State{
		Files: files, Branches: branches, Current: current, Warning: warning,
		Hint: hint, IsGit: isGit, Local: true, Source: "local",
		Info: worker.Info{Prefix: prefix, Root: repo, IsGit: isGit},
	}, nil
}

// localGitPrefix finds the repository when the workspace root is a parent
// folder rather than the repo itself.
func localGitPrefix(root string) string {
	if isGitDir(root) {
		return ""
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		if isGitDir(filepath.Join(root, e.Name())) {
			return e.Name()
		}
	}
	return ""
}

// branchesIn lists local + origin branches for a repo root on this host.
func branchesIn(repo string, isGit bool) (branches []string, current, warning string) {
	branches = []string{}
	if !isGit {
		return branches, "", "No git repository found in this workspace. Type a branch name to use as the worktree base."
	}
	current, _ = gitOutput(repo, "rev-parse", "--abbrev-ref", "HEAD")
	if current == "HEAD" {
		current = ""
	}
	out, err := gitOutput(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes/origin")
	if err != nil {
		return branches, current, "Could not read branches: " + firstLine(err.Error())
	}
	seen := map[string]bool{}
	for _, raw := range strings.Split(out, "\n") {
		b := strings.TrimSpace(raw)
		// for-each-ref shortens refs/remotes/origin/HEAD to "origin"; that is a
		// symbolic ref, not a branch, and must not appear in the picker.
		if b == "" || b == "HEAD" || b == "origin" || b == "origin/HEAD" ||
			strings.HasPrefix(b, "switchyard/") || strings.HasPrefix(b, "sy/") {
			continue
		}
		b = strings.TrimPrefix(b, "origin/")
		b = strings.TrimPrefix(b, "refs/heads/")
		if b == "HEAD" || seen[b] {
			continue
		}
		seen[b] = true
		branches = append(branches, b)
	}
	sort.Strings(branches)
	return branches, current, ""
}

// scoreFiles mirrors kanban-board's /files/search scoring.
func scoreFiles(files []string, query string, limit int) []FileMatch {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	q := strings.ToLower(strings.TrimSpace(query))
	matches := make([]FileMatch, 0, limit)
	for _, rel := range files {
		base := filepath.Base(rel)
		score := 0
		if q == "" {
			score = 1
		} else {
			lb, lp := strings.ToLower(base), strings.ToLower(rel)
			switch {
			case lb == q:
				score = 100
			case strings.HasPrefix(lb, q):
				score = 80
			case strings.Contains(lb, q):
				score = 60
			case strings.Contains(lp, q):
				score = 40
			}
		}
		if score == 0 {
			continue
		}
		dir := filepath.ToSlash(filepath.Dir(rel))
		if dir == "." {
			dir = ""
		}
		matches = append(matches, FileMatch{Path: rel, Basename: base, Directory: dir, Score: score})
	}
	sort.SliceStable(matches, func(i, j int) bool {
		if matches[i].Score != matches[j].Score {
			return matches[i].Score > matches[j].Score
		}
		if len(matches[i].Path) != len(matches[j].Path) {
			return len(matches[i].Path) < len(matches[j].Path)
		}
		return matches[i].Path < matches[j].Path
	})
	if len(matches) > limit {
		matches = matches[:limit]
	}
	return matches
}

// FilesCtx scores matches against the resolved file list.
func (x *Index) FilesCtx(ctx context.Context, root, query string, limit int) ([]FileMatch, string, string, error) {
	st, err := x.State(ctx, root, false)
	if err != nil {
		return []FileMatch{}, st.Hint, st.Source, nil
	}
	return scoreFiles(st.Files, query, limit), st.Hint, st.Source, nil
}

// BranchesCtx returns the resolved branch list plus its origin and git state.
func (x *Index) BranchesCtx(ctx context.Context, root string, refresh bool) ([]string, string, string, string, bool, error) {
	st, err := x.State(ctx, root, refresh)
	return st.Branches, st.Current, st.Warning, st.Source, st.IsGit, err
}

// SymbolsCtx lifts identifier suggestions out of a fixed-string grep, on this
// host or on the owning worker.
func (x *Index) SymbolsCtx(ctx context.Context, root, query string, limit int) ([]worker.Symbol, error) {
	q := strings.TrimSpace(query)
	if len(q) < 2 {
		return []worker.Symbol{}, nil
	}
	st, err := x.State(ctx, root, false)
	if err != nil {
		return []worker.Symbol{}, nil
	}
	if st.Local {
		out, gerr := gitOutput(st.Info.Root, "grep", "-n", "-I", "-F", "-e", q, "--", ".")
		if gerr != nil && strings.TrimSpace(out) == "" {
			return []worker.Symbol{}, nil
		}
		return worker.ParseSymbols(out, q, limit), nil
	}
	if x.remote != nil && x.remote.Enabled() {
		return x.remote.Symbols(ctx, root, st.Info, q, limit)
	}
	return []worker.Symbol{}, nil
}

// InfoCtx exposes the git-root resolution used by dispatch/review.
func (x *Index) InfoCtx(ctx context.Context, root string) (State, error) {
	return x.State(ctx, root, false)
}
