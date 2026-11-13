// Package wsindex provides the small, read-only indexes the create-task
// composer needs: workspace file search and git branch listing.
//
// Only paths that exist on the control-plane host can be indexed. Remote
// Mac/Windows checkouts live on the worker node, so callers get an explicit
// hint instead of an empty list and can still type a path or branch by hand.
package wsindex

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// FileMatch mirrors kanban-board's /files/search result.
type FileMatch struct {
	Path      string `json:"path"`
	Basename  string `json:"basename"`
	Directory string `json:"directory"`
	Score     int    `json:"score"`
}

type fileEntry struct {
	at    time.Time
	files []string
	hint  string
}

type Index struct {
	TTL time.Duration
	Now func() time.Time

	mu    sync.Mutex
	cache map[string]fileEntry
}

func New() *Index {
	return &Index{TTL: 60 * time.Second, Now: time.Now, cache: map[string]fileEntry{}}
}

// Local reports whether root is a directory visible to this process.
func Local(root string) bool {
	st, err := os.Stat(root)
	return err == nil && st.IsDir()
}

// Files returns scored relative paths matching query.
func (x *Index) Files(root, query string, limit int) ([]FileMatch, string) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if !Local(root) {
		return []FileMatch{}, "This workspace lives on a worker node, so its files are not indexed here. Type a relative path to attach it manually."
	}
	files, hint := x.fileList(root)
	if hint != "" && len(files) == 0 {
		return []FileMatch{}, hint
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
	return matches, hint
}

func (x *Index) fileList(root string) ([]string, string) {
	x.mu.Lock()
	e, hit := x.cache[root]
	x.mu.Unlock()
	if hit && x.Now().Sub(e.at) < x.TTL {
		return e.files, e.hint
	}
	var files []string
	hint := ""
	if isGitDir(root) {
		out, err := gitOutput(root, "ls-files", "--cached", "--others", "--exclude-standard")
		if err == nil {
			for _, l := range strings.Split(out, "\n") {
				l = strings.TrimSpace(strings.ReplaceAll(l, "\r", ""))
				if l != "" {
					files = append(files, filepath.ToSlash(l))
				}
			}
		} else {
			hint = "git ls-files failed: " + firstLine(err.Error())
		}
	}
	if len(files) == 0 {
		files = walkFiles(root)
	}
	if len(files) == 0 {
		hint = "No files found in this workspace on the control plane."
	}
	x.mu.Lock()
	x.cache[root] = fileEntry{x.Now(), files, hint}
	x.mu.Unlock()
	return files, hint
}

var skipDirs = map[string]bool{
	".git": true, "node_modules": true, "dist": true, "build": true,
	"vendor": true, ".venv": true, "venv": true, "__pycache__": true,
	".next": true, ".cache": true, ".switchyard": true,
}

func walkFiles(root string) []string {
	out := []string{}
	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if len(out) >= 15000 {
			return filepath.SkipAll
		}
		if d.IsDir() {
			if skipDirs[strings.ToLower(d.Name())] || (strings.HasPrefix(d.Name(), ".") && p != root) {
				return filepath.SkipDir
			}
			return nil
		}
		rel, e := filepath.Rel(root, p)
		if e == nil {
			out = append(out, filepath.ToSlash(rel))
		}
		return nil
	})
	return out
}

// Branches lists local and origin branches plus the checked-out branch.
func (x *Index) Branches(root string) (branches []string, current, warning string) {
	branches = []string{}
	if !Local(root) {
		return branches, "", "Branches are resolved on the worker node at dispatch time. Type a branch to use as the worktree base."
	}
	if !isGitDir(root) {
		return branches, "", "Not a git repository on this host. Type a branch name to use as the worktree base."
	}
	current, _ = gitOutput(root, "rev-parse", "--abbrev-ref", "HEAD")
	out, err := gitOutput(root, "for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes/origin")
	if err != nil {
		return branches, current, "Could not read branches: " + firstLine(err.Error())
	}
	seen := map[string]bool{}
	for _, raw := range strings.Split(out, "\n") {
		b := strings.TrimSpace(raw)
		if b == "" || b == "origin/HEAD" || strings.HasPrefix(b, "switchyard/") || strings.HasPrefix(b, "sy/") {
			continue
		}
		b = strings.TrimPrefix(b, "origin/")
		if b == "HEAD" || seen[b] {
			continue
		}
		seen[b] = true
		branches = append(branches, b)
	}
	sort.Strings(branches)
	return branches, current, ""
}

func isGitDir(root string) bool {
	st, err := os.Stat(filepath.Join(root, ".git"))
	return err == nil && (st.IsDir() || st.Mode().IsRegular())
}

func gitOutput(root string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", root}, args...)...)
	b, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(b)), err
}

func firstLine(s string) string {
	return strings.TrimSpace(strings.SplitN(s, "\n", 2)[0])
}
