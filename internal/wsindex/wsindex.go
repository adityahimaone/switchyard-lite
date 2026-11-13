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
	"strings"
	"sync"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/worker"
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

	mu          sync.Mutex
	cache       map[string]fileEntry
	remote      *worker.Client
	remoteCache map[string]remoteEntry
}

func New() *Index {
	return &Index{
		TTL: 60 * time.Second, Now: time.Now,
		cache: map[string]fileEntry{}, remoteCache: map[string]remoteEntry{},
	}
}

// Local reports whether root is a directory visible to this process.
func Local(root string) bool {
	st, err := os.Stat(root)
	return err == nil && st.IsDir()
}

// Files returns scored relative paths matching query. Remote workspaces are
// resolved on their owning node by State; see FilesCtx for the context-aware
// version used by the HTTP handlers.
func (x *Index) Files(root, query string, limit int) ([]FileMatch, string) {
	files, hint, _, _ := x.FilesCtx(context.Background(), root, query, limit)
	return files, hint
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
	branches, current, warning, _, _, _ = x.BranchesCtx(context.Background(), root, false)
	return branches, current, warning
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
