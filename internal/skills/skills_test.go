package skills

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func writeSkill(t *testing.T, dir, name, frontmatter string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	body := "---\nname: " + name + "\n" + frontmatter + "---\n\n# " + name + "\n"
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

// `npx skills add -g` links ~/.agents/skills/<name> -> ~/.claude/skills/<name>.
// A plain WalkDir skips those entries, so assert they are discovered.
func TestRegistryFollowsLinkedSkillFolders(t *testing.T) {
	tmp := t.TempDir()
	installed := filepath.Join(tmp, "installed")
	root := filepath.Join(tmp, ".agents", "skills")
	writeSkill(t, filepath.Join(installed, "frontend-design"), "frontend-design", "description: Build polished UIs\n")
	writeSkill(t, filepath.Join(root, "local-skill"), "local-skill", "description: Authored locally\n")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(installed, "frontend-design"), filepath.Join(root, "frontend-design")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}

	r := &Registry{Roots: []string{root}, TTL: time.Minute, Now: time.Now, Probe: false, npxSet: map[string]bool{}}
	list := r.List(true)
	if len(list) != 2 {
		t.Fatalf("discovered %d skills, want 2: %+v", len(list), list)
	}
	byName := map[string]Skill{}
	for _, s := range list {
		byName[s.Name] = s
	}
	linked := byName["frontend-design"]
	if !linked.Linked || linked.Origin != "npx" {
		t.Errorf("linked skill metadata: %+v", linked)
	}
	if linked.Description != "Build polished UIs" {
		t.Errorf("frontmatter description = %q", linked.Description)
	}
	if byName["local-skill"].Linked {
		t.Error("a regular directory must not be marked as linked")
	}
	content, err := r.Content("frontend-design")
	if err != nil || content == "" {
		t.Fatalf("Content = %q, %v", content, err)
	}
	if _, err := r.Content("../etc/passwd"); err == nil {
		t.Error("unknown skill name must not resolve")
	}
}

func TestFrontmatterParsing(t *testing.T) {
	m := frontmatter("---\nname: my-skill\ndescription: 'Quoted value'\n---\nbody\n")
	if m["name"] != "my-skill" || m["description"] != "Quoted value" {
		t.Fatalf("frontmatter = %+v", m)
	}
	if got := firstBodyLine("---\nname: x\n---\n# Heading\nfirst real line\n"); got != "first real line" {
		t.Fatalf("firstBodyLine = %q", got)
	}
}
