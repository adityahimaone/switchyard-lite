// Package skills discovers agent skills installed on the control plane.
//
// `npx skills add -g` installs into ~/.agents/skills and frequently symlinks
// the skill folder into ~/.claude/skills or ~/.hermes/skills. A plain
// filepath.WalkDir never follows those symlinks, so most npx-installed skills
// were invisible. This registry walks the roots with symlink resolution,
// reads SKILL.md frontmatter, and uses the `.hub/lock.json` written by
// `npx skills` for provenance.
package skills

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Skill is one entry of GET /api/v1/skills.
type Skill struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Category    string `json:"category,omitempty"`
	Path        string `json:"path,omitempty"`   // relative to its root
	AbsPath     string `json:"-"`                // resolved SKILL.md directory
	Root        string `json:"root,omitempty"`   // which skills root
	Origin      string `json:"origin,omitempty"` // npx | builtin | local
	Source      string `json:"source,omitempty"`
	Linked      bool   `json:"linked,omitempty"` // reached through a symlink
	Npx         bool   `json:"npx,omitempty"`    // confirmed by `npx skills list`
}

type Registry struct {
	Roots   []string
	TTL     time.Duration
	Now     func() time.Time
	NpxBin  string
	Probe   bool
	Home    string
	WorkDir string

	mu     sync.Mutex
	at     time.Time
	data   []Skill
	npxAt  time.Time
	npxSet map[string]bool
}

// NewFromEnv builds a registry from SWITCHYARD_SKILL_ROOTS, or the standard
// npx skills / WorkBuddy / hermes roots when unset.
func NewFromEnv() *Registry {
	home, _ := os.UserHomeDir()
	wd, _ := os.Getwd()
	r := &Registry{
		TTL: 60 * time.Second, Now: time.Now,
		NpxBin: os.Getenv("SWITCHYARD_SKILLS_NPX_BIN"),
		Probe:  os.Getenv("SWITCHYARD_SKILLS_NPX") != "0",
		Home:   home, WorkDir: wd,
		npxSet: map[string]bool{},
	}
	if raw := strings.TrimSpace(os.Getenv("SWITCHYARD_SKILL_ROOTS")); raw != "" {
		r.Roots = filepath.SplitList(raw)
	} else {
		r.Roots = defaultRoots(home, wd)
	}
	if r.NpxBin == "" {
		r.NpxBin = "npx"
	}
	return r
}

func defaultRoots(home, wd string) []string {
	candidates := []string{
		filepath.Join(home, ".agents", "skills"),
		filepath.Join(home, ".workbuddy-ai", "skills"),
		filepath.Join(home, ".hermes", "skills"),
		filepath.Join(home, ".claude", "skills"),
		filepath.Join(home, ".codex", "skills"),
		filepath.Join(wd, ".agents", "skills"),
	}
	out := []string{}
	seen := map[string]bool{}
	for _, p := range candidates {
		if p == "" || seen[p] {
			continue
		}
		seen[p] = true
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			out = append(out, p)
		}
	}
	return out
}

// List returns the cached skill catalog. A background `npx skills list --json`
// probe (at most once every 10 minutes) marks skills the CLI itself reports;
// the filesystem walk is authoritative and never waits on the CLI.
func (r *Registry) List(refresh bool) []Skill {
	if r == nil {
		return []Skill{}
	}
	r.mu.Lock()
	at, data := r.at, r.data
	npxAt, npxSet := r.npxAt, r.npxSet
	probe := r.Probe
	r.mu.Unlock()
	now := r.Now()
	if !refresh && !at.IsZero() && now.Sub(at) < r.TTL {
		return r.decorate(data, npxSet)
	}
	list := r.scan()
	r.mu.Lock()
	r.at, r.data = now, list
	r.mu.Unlock()
	if probe && (npxAt.IsZero() || now.Sub(npxAt) > 10*time.Minute) {
		r.mu.Lock()
		r.npxAt = now
		r.mu.Unlock()
		go r.probeNpx()
	}
	return r.decorate(list, npxSet)
}

func (r *Registry) decorate(list []Skill, npx map[string]bool) []Skill {
	if len(npx) == 0 {
		return list
	}
	out := make([]Skill, len(list))
	copy(out, list)
	for i := range out {
		if npx[strings.ToLower(out[i].Name)] {
			out[i].Npx = true
			out[i].Origin = "npx"
		}
	}
	return out
}

// Content returns the raw SKILL.md for a skill name (never a path, so there
// is no traversal surface).
func (r *Registry) Content(name string) (string, error) {
	want := strings.ToLower(strings.TrimSpace(name))
	for _, s := range r.List(false) {
		if strings.ToLower(s.Name) != want && strings.ToLower(filepath.Base(s.Path)) != want {
			continue
		}
		p := filepath.Join(s.AbsPath, "SKILL.md")
		b, err := os.ReadFile(p)
		if err != nil {
			return "", err
		}
		return string(b), nil
	}
	return "", os.ErrNotExist
}

var excluded = map[string]bool{
	".git": true, ".archive": true, ".hub": true, "__pycache__": true,
	"node_modules": true, ".venv": true, "venv": true, "dist": true, "vendor": true,
}

func (r *Registry) scan() []Skill {
	var out []Skill
	seen := map[string]bool{}
	for _, root := range r.Roots {
		origins := readHubLock(root)
		rootLabel := filepath.Base(filepath.Clean(root))
		if rootLabel == "skills" {
			rootLabel = filepath.Base(filepath.Dir(filepath.Clean(root)))
		}
		visited := map[string]bool{}
		r.walk(root, "", rootLabel, origins, 0, false, visited, seen, &out)
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out
}

func (r *Registry) walk(dir, rel, rootLabel string, origins map[string]hubEntry, depth int, linked bool, visited, seen map[string]bool, out *[]Skill) {
	if depth > 3 {
		return
	}
	real, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return
	}
	if visited[real] {
		return
	}
	visited[real] = true
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, ".") || excluded[strings.ToLower(name)] {
			continue
		}
		p := filepath.Join(dir, name)
		childRel := name
		if rel != "" {
			childRel = rel + "/" + name
		}
		isLink := e.Type()&os.ModeSymlink != 0
		if !e.IsDir() && !isLink {
			if name != "SKILL.md" {
				continue
			}
			s := parseSkill(p, childRel, rootLabel, origins, linked, filepath.Dir(p))
			if s.Name == "" || seen[strings.ToLower(s.Name)] {
				continue
			}
			seen[strings.ToLower(s.Name)] = true
			*out = append(*out, s)
			continue
		}
		st, err := os.Stat(p) // follows the symlink
		if err != nil || !st.IsDir() {
			continue
		}
		r.walk(p, childRel, rootLabel, origins, depth+1, linked || isLink, visited, seen, out)
	}
}

func parseSkill(file, rel, rootLabel string, origins map[string]hubEntry, linked bool, absDir string) Skill {
	b, err := os.ReadFile(file)
	if err != nil {
		return Skill{}
	}
	meta := frontmatter(string(b))
	name := meta["name"]
	if name == "" {
		name = filepath.Base(filepath.Dir(rel))
	}
	if name == "" {
		name = filepath.Base(absDir)
	}
	desc := meta["description"]
	if desc == "" {
		desc = firstBodyLine(string(b))
	}
	if len(desc) > 240 {
		desc = desc[:237] + "..."
	}
	category := ""
	if parts := strings.Split(rel, "/"); len(parts) > 2 {
		category = parts[0]
	}
	origin, source := "local", ""
	if h, ok := origins[strings.TrimSuffix(rel, "/SKILL.md")]; ok {
		source = h.source
		if h.source == "" || h.source == "official" || h.trust == "builtin" || h.trust == "official" {
			origin = "builtin"
		} else {
			origin = "npx"
		}
	} else if linked {
		origin, source = "npx", "symlink"
	}
	return Skill{
		Name: name, Description: desc, Category: category,
		Path: strings.TrimSuffix(rel, "/SKILL.md"), AbsPath: absDir,
		Root: rootLabel, Origin: origin, Source: source, Linked: linked,
	}
}

// frontmatter reads the small YAML subset used by SKILL.md files.
func frontmatter(s string) map[string]string {
	out := map[string]string{}
	s = strings.ReplaceAll(s, "\r\n", "\n")
	lines := strings.Split(s, "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return out
	}
	key := ""
	for i := 1; i < len(lines) && i < 80; i++ {
		line := lines[i]
		if strings.TrimSpace(line) == "---" {
			break
		}
		if strings.HasPrefix(line, " ") || strings.HasPrefix(line, "\t") {
			if key != "" && out[key] == "" {
				out[key] = strings.TrimSpace(line)
			}
			continue
		}
		idx := strings.Index(line, ":")
		if idx < 1 {
			continue
		}
		key = strings.ToLower(strings.TrimSpace(line[:idx]))
		v := strings.TrimSpace(line[idx+1:])
		v = strings.Trim(v, `"'`)
		out[key] = v
	}
	return out
}

func firstBodyLine(s string) string {
	parts := strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
	inFront := false
	for _, l := range parts {
		t := strings.TrimSpace(l)
		if t == "---" {
			inFront = !inFront
			continue
		}
		if inFront || t == "" || strings.HasPrefix(t, "#") {
			continue
		}
		return t
	}
	return ""
}

type hubEntry struct{ source, trust string }

func readHubLock(root string) map[string]hubEntry {
	out := map[string]hubEntry{}
	b, err := os.ReadFile(filepath.Join(root, ".hub", "lock.json"))
	if err != nil {
		return out
	}
	var lock struct {
		Installed map[string]struct {
			Source      string `json:"source"`
			TrustLevel  string `json:"trust_level"`
			InstallPath string `json:"install_path"`
		} `json:"installed"`
	}
	if json.Unmarshal(b, &lock) != nil {
		return out
	}
	for name, e := range lock.Installed {
		key := strings.TrimSpace(filepath.ToSlash(e.InstallPath))
		if key == "" {
			key = name
		}
		if key == "" {
			continue
		}
		out[key] = hubEntry{source: strings.ToLower(strings.TrimSpace(e.Source)), trust: strings.ToLower(strings.TrimSpace(e.TrustLevel))}
	}
	return out
}

// probeNpx asks the `npx skills` CLI for its own inventory. It is best-effort:
// network installs and older CLIs can hang or return prose, so it runs in the
// background with a hard timeout and never blocks a request.
func (r *Registry) probeNpx() {
	bin := r.NpxBin
	if bin == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, "--yes", "skills", "list", "--json")
	cmd.Dir = r.WorkDir
	b, err := cmd.Output()
	if err != nil || len(b) == 0 {
		return
	}
	var raw struct {
		Skills []struct {
			Name string `json:"name"`
		} `json:"skills"`
	}
	set := map[string]bool{}
	if json.Unmarshal(b, &raw) == nil && len(raw.Skills) > 0 {
		for _, s := range raw.Skills {
			if s.Name != "" {
				set[strings.ToLower(s.Name)] = true
			}
		}
	} else {
		var arr []any
		if json.Unmarshal(b, &arr) == nil {
			for _, v := range arr {
				if m, ok := v.(map[string]any); ok {
					if n, _ := m["name"].(string); n != "" {
						set[strings.ToLower(n)] = true
					}
				}
			}
		}
	}
	if len(set) == 0 {
		return
	}
	r.mu.Lock()
	r.npxSet = set
	r.mu.Unlock()
}
