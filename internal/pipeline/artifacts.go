package pipeline

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/tasks"
)

// ArtifactFile represents a generated meta7 workspace file mirrored for UI inspection
// and written under <workspace>/.switchyard/meta7/<slug>/ when local.
type ArtifactFile struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	Category  string `json:"category"` // context | state | research | design | review | impl | index
	Stage     string `json:"stage,omitempty"`
	Content   string `json:"content"`
	UpdatedAt int64  `json:"updated_at"`
}

var nonSlugRe = regexp.MustCompile(`[^a-z0-9]+`)

// slugifyProjectName derives a safe meta7 project directory slug from an explicit
// project name or goal text.
func slugifyProjectName(preferred, goal string) string {
	raw := strings.TrimSpace(preferred)
	if raw == "" {
		raw = strings.TrimSpace(goal)
	}
	slug := nonSlugRe.ReplaceAllString(strings.ToLower(raw), "-")
	slug = strings.Trim(slug, "-")
	if len(slug) > 40 {
		slug = strings.TrimRight(slug[:40], "-")
	}
	if slug == "" {
		return "meta7-project"
	}
	return slug
}

// buildContextDocument formats the canonical @r17x/meta7 .<project>.context file.
func buildContextDocument(run *RunState) string {
	slug := slugifyProjectName(run.ProjectName, run.Goal)
	var b strings.Builder
	b.WriteString("CURRENT_NAME : " + slug + "\n")
	if run.Workspace != "" {
		b.WriteString("EXTRA_REFS : " + run.Workspace + "\n")
	} else {
		b.WriteString("EXTRA_REFS : \n")
	}
	if run.Branch != "" {
		b.WriteString("BASE_BRANCH : " + run.Branch + "\n")
	}
	if len(run.ContextPaths) > 0 {
		b.WriteString("ATTACHED_PATHS : " + strings.Join(run.ContextPaths, ", ") + "\n")
	}
	if len(run.Skills) > 0 {
		b.WriteString("ATTACHED_SKILLS : " + strings.Join(run.Skills, ", ") + "\n")
	}
	b.WriteString("CONTEXT\n")
	b.WriteString("───────\n")
	if strings.TrimSpace(run.Goal) != "" {
		b.WriteString("Goal: " + strings.TrimSpace(run.Goal) + "\n")
	}
	if strings.TrimSpace(run.Context) != "" {
		b.WriteString("\n" + strings.TrimSpace(run.Context) + "\n")
	}
	if len(run.Items) > 0 {
		b.WriteString("\nScope Items:\n")
		for _, item := range run.Items {
			b.WriteString("- " + item + "\n")
		}
	}
	if len(run.SourceTaskIDs) > 0 {
		b.WriteString("\nAbsorbed Board Tasks: " + strings.Join(run.SourceTaskIDs, ", ") + "\n")
	}
	b.WriteString("END_CONTEXT\n")
	return b.String()
}

// formatStateGraph converts append-only pipeline events into .state.graph lines.
func formatStateGraph(evts []tasks.Event) []string {
	lines := make([]string, 0, len(evts))
	for i, ev := range evts {
		ts := time.Unix(ev.CreatedAt, 0).UTC().Format(time.RFC3339)
		var payload map[string]any
		_ = json.Unmarshal(ev.Payload, &payload)
		target, detail := summarizeEventPayload(ev.Kind, payload)
		lines = append(lines, fmt.Sprintf("%s | #%03d | %-22s | %-18s | %s", ts, i+1, ev.Kind, target, detail))
	}
	return lines
}

func summarizeEventPayload(kind string, p map[string]any) (string, string) {
	str := func(k string) string {
		if v, ok := p[k].(string); ok {
			return v
		}
		return ""
	}
	switch kind {
	case "pipeline.started":
		return firstNonEmpty(str("project_name"), str("template")), fmt.Sprintf("template=%s board=%s goal=%q", str("template"), str("board_id"), truncateText(str("goal"), 72))
	case "pipeline.node_spawned":
		return str("key"), fmt.Sprintf("stage=%s task=%s kind=%s", str("stage"), str("task_id"), str("kind"))
	case "pipeline.verdict_checked":
		return str("key"), fmt.Sprintf("verdict=%s comment=%v", str("verdict"), p["comment_id"])
	case "pipeline.back_arc":
		return fmt.Sprintf("%s->%s", str("from"), str("to")), fmt.Sprintf("verdict=%s reason=%q", str("verdict"), truncateText(str("reason"), 72))
	case "pipeline.node_failure":
		return str("key"), fmt.Sprintf("sig=%q count=%v", truncateText(str("sig"), 48), p["failure_count"])
	case "pipeline.node_retry":
		return str("key"), "requeued"
	case "pipeline.node_evolving":
		return str("key"), fmt.Sprintf("modifier=%s", str("modifier_task_id"))
	case "pipeline.node_evolved":
		return str("key"), fmt.Sprintf("task=%s adapted", str("task_id"))
	case "pipeline.stage_reset":
		return firstNonEmpty(str("key"), str("stage")), "reset to pending/todo"
	case "pipeline.resumed":
		return firstNonEmpty(str("target"), "run"), "resumed by operator"
	case "pipeline.needs_human":
		return firstNonEmpty(str("node"), str("verdict"), "run"), truncateText(str("reason"), 80)
	case "pipeline.completed":
		return "run", "all stages verified"
	case "pipeline.cancelled":
		return "run", truncateText(str("reason"), 80)
	default:
		keys := make([]string, 0, len(p))
		for k := range p {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, k := range keys {
			parts = append(parts, fmt.Sprintf("%s=%v", k, p[k]))
		}
		return "run", truncateText(strings.Join(parts, " "), 80)
	}
}

func buildMeta7Artifacts(run *RunState, evts []tasks.Event) ([]string, []ArtifactFile, string) {
	slug := slugifyProjectName(run.ProjectName, run.Goal)
	stateLines := formatStateGraph(evts)
	updatedAt := run.UpdatedAt
	if updatedAt == 0 {
		updatedAt = run.CreatedAt
	}

	projRoot := filepath.ToSlash(filepath.Join("projects", slug))
	artifacts := []ArtifactFile{
		{
			Name:      "." + slug + ".context",
			Path:      projRoot + "/." + slug + ".context",
			Category:  "context",
			Content:   buildContextDocument(run),
			UpdatedAt: updatedAt,
		},
		{
			Name:      ".state.graph",
			Path:      projRoot + "/.state.graph",
			Category:  "state",
			Content:   strings.Join(stateLines, "\n") + "\n",
			UpdatedAt: updatedAt,
		},
	}

	stageByID := map[string]StageView{}
	for _, stg := range run.Stages {
		stageByID[stg.ID] = stg
	}

	addNodeDocs := func(stageID, prefix, category string) {
		stg, ok := stageByID[stageID]
		if !ok {
			return
		}
		idx := 0
		for _, n := range stg.Nodes {
			if n.Kind != "main" {
				continue
			}
			idx++
			var b strings.Builder
			fmt.Fprintf(&b, "# %s (%s)\n\n", prefix, n.Key)
			fmt.Fprintf(&b, "- Task: `%s`\n", n.TaskID)
			fmt.Fprintf(&b, "- Status: `%s`\n", n.Status)
			if n.Verdict != "" {
				fmt.Fprintf(&b, "- Verdict: `%s`\n", n.Verdict)
			}
			b.WriteString("\n")
			if strings.TrimSpace(n.Output) != "" {
				b.WriteString(strings.TrimSpace(n.Output) + "\n")
			} else {
				b.WriteString("_Pending worker output._\n")
			}
			fileName := fmt.Sprintf("%s-%d.md", prefix, idx)
			artifacts = append(artifacts, ArtifactFile{
				Name:      fileName,
				Path:      projRoot + "/researchs/" + fileName,
				Category:  category,
				Stage:     stageID,
				Content:   b.String(),
				UpdatedAt: updatedAt,
			})
		}
	}

	addSingleStageDoc := func(stageID, relPath, title, category string) {
		stg, ok := stageByID[stageID]
		if !ok || len(stg.Nodes) == 0 {
			return
		}
		var b strings.Builder
		fmt.Fprintf(&b, "# %s — %s\n\n", title, run.Goal)
		fmt.Fprintf(&b, "- Stage Status: `%s`\n", stg.Status)
		for _, n := range stg.Nodes {
			fmt.Fprintf(&b, "\n## Node `%s` (`%s` · %s)\n", n.Key, n.TaskID, n.Status)
			if n.Verdict != "" {
				fmt.Fprintf(&b, "\n**Verdict:** `%s`\n", n.Verdict)
			}
			if strings.TrimSpace(n.Output) != "" {
				b.WriteString("\n" + strings.TrimSpace(n.Output) + "\n")
			} else {
				b.WriteString("\n_Awaiting output._\n")
			}
		}
		artifacts = append(artifacts, ArtifactFile{
			Name:      filepath.Base(relPath),
			Path:      projRoot + "/" + relPath,
			Category:  category,
			Stage:     stageID,
			Content:   b.String(),
			UpdatedAt: updatedAt,
		})
	}

	addNodeDocs("explore", "explore", "research")
	addNodeDocs("cross_examine", "cross-examine", "research")
	addSingleStageDoc("synthesize", "researchs/synthesis.md", "Synthesis", "research")
	addSingleStageDoc("design", "designs/DESIGN.md", "Architecture Design", "design")
	addSingleStageDoc("verify", "designs/VERIFY.md", "Invariant Verification", "design")
	addSingleStageDoc("review", "REVIEW.md", "Pre-Implementation Review", "review")

	if implDoc := buildImplPromptDoc(run, slug, stageByID); implDoc != "" {
		artifacts = append(artifacts, ArtifactFile{
			Name:      ".01.impl",
			Path:      projRoot + "/.01.impl",
			Category:  "impl",
			Stage:     "impl",
			Content:   implDoc,
			UpdatedAt: updatedAt,
		})
	}

	artifacts = append(artifacts, ArtifactFile{
		Name:      "INDEX.md",
		Path:      "ref/INDEX.md",
		Category:  "index",
		Content:   buildIndexDoc(run, slug, artifacts),
		UpdatedAt: updatedAt,
	})

	artifactDir := ""
	if ws := strings.TrimSpace(run.Workspace); ws != "" {
		if st, err := os.Stat(ws); err == nil && st.IsDir() {
			root := filepath.Join(ws, ".switchyard", "meta7", slug)
			if writeArtifactsToDisk(root, artifacts) == nil {
				artifactDir = root
				ensureGitExclude(ws)
			}
		}
	}
	return stateLines, artifacts, artifactDir
}

func buildImplPromptDoc(run *RunState, slug string, byID map[string]StageView) string {
	var b strings.Builder
	b.WriteString("# IMPLEMENTATION MODE (.01.impl)\n\n")
	fmt.Fprintf(&b, "Project: `%s` (`%s`)\n", slug, run.ID)
	fmt.Fprintf(&b, "Goal: %s\n", run.Goal)
	if run.Workspace != "" {
		fmt.Fprintf(&b, "Workspace: `%s`\n", run.Workspace)
	}
	if run.Branch != "" {
		fmt.Fprintf(&b, "Base Branch: `%s`\n", run.Branch)
	}

	appendStageOutput := func(stageID, heading string) {
		stg, ok := byID[stageID]
		if !ok {
			return
		}
		var chunks []string
		for _, n := range stg.Nodes {
			if n.Kind == "main" && strings.TrimSpace(n.Output) != "" {
				chunks = append(chunks, strings.TrimSpace(n.Output))
			}
		}
		if len(chunks) > 0 {
			fmt.Fprintf(&b, "\n## %s\n\n%s\n", heading, strings.Join(chunks, "\n\n---\n\n"))
		}
	}

	appendStageOutput("design", "Approved Architecture Design")
	appendStageOutput("verify", "Verified Invariants")
	appendStageOutput("review", "Pre-Implementation Review Findings")
	appendStageOutput("impl", "Implementation Execution Log")

	if implStg, ok := byID["impl"]; ok {
		var gates []string
		for _, n := range implStg.Nodes {
			if n.Kind == "gate" {
				gates = append(gates, fmt.Sprintf("- [%s] `%s` (%s)", boolMark(n.Status == tasks.Done), n.Key, n.TaskID))
			}
		}
		if len(gates) > 0 {
			b.WriteString("\n## Quality Gate Band\n\n" + strings.Join(gates, "\n") + "\n")
		}
	}
	return b.String()
}

func buildIndexDoc(run *RunState, slug string, files []ArtifactFile) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# Reference Index — %s\n\n", slug)
	fmt.Fprintf(&b, "- Run ID: `%s`\n", run.ID)
	fmt.Fprintf(&b, "- Template: `%s`\n", run.Template)
	fmt.Fprintf(&b, "- Status: `%s`\n", run.Status)
	if run.Workspace != "" {
		fmt.Fprintf(&b, "- Workspace: `%s`\n", run.Workspace)
	}
	b.WriteString("\n## Stages & Tasks\n\n")
	for _, stg := range run.Stages {
		fmt.Fprintf(&b, "- **%s** (`%s`)\n", stg.ID, stg.Status)
		for _, n := range stg.Nodes {
			verdict := ""
			if n.Verdict != "" {
				verdict = " · verdict=" + n.Verdict
			}
			fmt.Fprintf(&b, "  - `%s` → task `%s` (`%s`%s)\n", n.Key, n.TaskID, n.Status, verdict)
		}
	}
	b.WriteString("\n## Files\n\n")
	for _, f := range files {
		fmt.Fprintf(&b, "- `%s` (%s)\n", f.Path, f.Category)
	}
	return b.String()
}

func writeArtifactsToDisk(root string, files []ArtifactFile) error {
	for _, f := range files {
		target := filepath.Join(root, filepath.FromSlash(f.Path))
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		if existing, err := os.ReadFile(target); err == nil && string(existing) == f.Content {
			continue
		}
		if err := os.WriteFile(target, []byte(f.Content), 0o644); err != nil {
			return err
		}
	}
	return nil
}

func ensureGitExclude(repo string) {
	gitDir := filepath.Join(repo, ".git")
	if st, err := os.Stat(gitDir); err != nil || !st.IsDir() {
		return
	}
	exclude := filepath.Join(gitDir, "info", "exclude")
	if b, _ := os.ReadFile(exclude); strings.Contains(string(b), ".switchyard/") {
		return
	}
	_ = os.MkdirAll(filepath.Dir(exclude), 0o755)
	if f, err := os.OpenFile(exclude, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
		_, _ = f.WriteString("\n.switchyard/\n")
		_ = f.Close()
	}
}

func boolMark(ok bool) string {
	if ok {
		return "x"
	}
	return " "
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func truncateText(s string, max int) string {
	s = strings.TrimSpace(strings.ReplaceAll(s, "\n", " "))
	if len(s) <= max {
		return s
	}
	return s[:max-3] + "..."
}
