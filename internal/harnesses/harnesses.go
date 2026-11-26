// Package harnesses provides pluggable CLI specification builders, NDJSON/stream-json
// output unwrapping, and cross-harness handoff summaries for Big-3 (agy, dsh, commandcode)
// and secondary agent harnesses.
package harnesses

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/adityahimaone/switchyard-lite/internal/tasks"
)

// SpawnSpec mirrors node-agent's generic transport.SpawnSpec so switchyard-lite
// owns CLI flag construction while node-agent stays a pure process runtime.
type SpawnSpec struct {
	Argv     []string          `json:"argv"`
	Env      map[string]string `json:"env,omitempty"`
	Cwd      string            `json:"cwd,omitempty"`
	Stdin    string            `json:"stdin,omitempty"`
	TimeoutS int               `json:"timeout_s,omitempty"`
}

// Canonical normalizes harness aliases ("cmd" -> "commandcode", "antigravity" -> "agy").
func Canonical(executor string) string {
	switch strings.ToLower(strings.TrimSpace(executor)) {
	case "antigravity", "agy":
		return "agy"
	case "cmd", "cmdc", "command-code", "commandcode":
		return "commandcode"
	case "dsh", "deepseek":
		return "dsh"
	default:
		return strings.ToLower(strings.TrimSpace(executor))
	}
}

// NormalizeAgyEffort maps UI effort presets to valid agy CLI values.
func NormalizeAgyEffort(effort string) string {
	switch strings.ToLower(strings.TrimSpace(effort)) {
	case "minimal", "low":
		return "low"
	case "medium":
		return "medium"
	case "high":
		return "high"
	case "xhigh":
		return "xhigh"
	case "max":
		return "max"
	default:
		return ""
	}
}

// BuildSpawnSpec constructs a generic SpawnSpec for any supported harness.
func BuildSpawnSpec(harness, model, effort, sessionID, workspace, prompt string, timeoutS int) SpawnSpec {
	h := Canonical(harness)
	p := strings.TrimSpace(prompt)
	if strings.HasPrefix(p, "-") {
		p = "Task:\n" + p
	}
	switch h {
	case "agy":
		argv := []string{"agy", "-p", "--dangerously-skip-permissions", "--mode", "auto", "--output-format", "stream-json"}
		if m := strings.TrimSpace(model); m != "" {
			argv = append(argv, "--model", m)
		}
		if ef := NormalizeAgyEffort(effort); ef != "" {
			argv = append(argv, "--effort", ef)
		}
		if sid := strings.TrimSpace(sessionID); sid != "" {
			argv = append(argv, "--conversation", sid)
		}
		if ws := strings.TrimSpace(workspace); ws != "" {
			argv = append(argv, "--add-dir", ws)
		}
		if timeoutS > 0 {
			argv = append(argv, "--print-timeout", fmt.Sprintf("%ds", timeoutS))
		}
		if p != "" {
			argv = append(argv, p)
		}
		return SpawnSpec{Argv: argv, Cwd: workspace, TimeoutS: timeoutS}

	case "dsh":
		argv := []string{"dsh", "--profile", "headless", "--json"}
		if sid := strings.TrimSpace(sessionID); sid != "" {
			argv = append(argv, "--session-id", sid)
		}
		if p != "" {
			argv = append(argv, p)
		}
		env := map[string]string{
			"DSH_PERMISSION_MODE": "danger-full-access",
		}
		if m := strings.TrimSpace(model); m != "" {
			if prov, mod, ok := strings.Cut(m, "/"); ok {
				if prov == "adit-router" {
					prov = "adit-9router"
				}
				env["DSH_PROVIDER"] = prov
				env["DSH_MODEL"] = mod
			} else if prov, mod, ok := strings.Cut(m, ":"); ok {
				if prov == "adit-router" {
					prov = "adit-9router"
				}
				env["DSH_PROVIDER"] = prov
				env["DSH_MODEL"] = mod
			} else {
				env["DSH_MODEL"] = m
			}
		}
		switch strings.ToLower(strings.TrimSpace(effort)) {
		case "off", "low", "high", "max":
			env["DSH_REASONING_EFFORT"] = strings.ToLower(strings.TrimSpace(effort))
		case "medium":
			env["DSH_REASONING_EFFORT"] = "high"
		}
		return SpawnSpec{Argv: argv, Env: env, Cwd: workspace, TimeoutS: timeoutS}

	case "commandcode":
		argv := []string{"commandcode", "-p", "--skip-onboarding", "--yolo", "--output-format", "json"}
		if m := strings.TrimSpace(model); m != "" && !strings.EqualFold(m, "default") && !strings.EqualFold(m, "auto") {
			argv = append(argv, "-m", m)
		}
		switch strings.ToLower(strings.TrimSpace(effort)) {
		case "low", "medium", "high":
			argv = append(argv, "--effort", strings.ToLower(strings.TrimSpace(effort)))
		case "max":
			argv = append(argv, "--effort", "high")
		}
		if sid := strings.TrimSpace(sessionID); sid != "" {
			argv = append(argv, "--resume", sid)
		}
		if p != "" {
			argv = append(argv, p)
		}
		return SpawnSpec{Argv: argv, Cwd: workspace, TimeoutS: timeoutS}

	case "claude":
		argv := []string{"claude", "-p", "--output-format", "json", "--permission-mode", "bypassPermissions"}
		if sid := strings.TrimSpace(sessionID); sid != "" {
			argv = append(argv, "--resume", sid)
		}
		if p != "" {
			argv = append(argv, p)
		}
		return SpawnSpec{Argv: argv, Cwd: workspace, TimeoutS: timeoutS}

	case "omp":
		argv := []string{"omp", "-p", "--auto-approve", "--mode", "json"}
		if sid := strings.TrimSpace(sessionID); sid != "" {
			argv = append(argv, "--resume", sid)
		}
		if p != "" {
			argv = append(argv, p)
		}
		return SpawnSpec{Argv: argv, Cwd: workspace, TimeoutS: timeoutS}

	default:
		argv := []string{h}
		if p != "" {
			argv = append(argv, p)
		}
		return SpawnSpec{Argv: argv, Cwd: workspace, TimeoutS: timeoutS}
	}
}

// UnwrapOutput converts NDJSON / stream-json output from dsh, commandcode, agy,
// claude, or omp into readable text while preserving question blocks verbatim.
func UnwrapOutput(harness, raw string) (cleanText, sessionID string) {
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	lines := strings.Split(raw, "\n")
	parts := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "provenance ") || strings.HasPrefix(trimmed, "EXECUTOR_PROOF=") {
			continue
		}
		if !strings.HasPrefix(trimmed, "{") {
			parts = append(parts, trimmed)
			continue
		}
		var obj map[string]any
		if err := json.Unmarshal([]byte(trimmed), &obj); err != nil {
			parts = append(parts, trimmed)
			continue
		}
		if sid := findSessionID(obj); sid != "" && sessionID == "" {
			sessionID = sid
		}
		if hasQuestionPayload(obj) {
			parts = append(parts, trimmed)
			continue
		}
		if txt := extractText(obj); txt != "" {
			parts = append(parts, txt)
		}
	}
	return strings.TrimSpace(strings.Join(parts, "\n")), sessionID
}

func findSessionID(m map[string]any) string {
	for _, k := range []string{"sessionId", "session_id", "conversationId", "conversation_id"} {
		if s, ok := m[k].(string); ok && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	for _, nested := range []string{"session", "conversation", "data", "metadata", "result"} {
		if sub, ok := m[nested].(map[string]any); ok {
			if sid := findSessionID(sub); sid != "" {
				return sid
			}
		}
	}
	return ""
}

func hasQuestionPayload(m map[string]any) bool {
	if _, ok := m["question"]; ok {
		return true
	}
	if _, ok := m["questions"]; ok {
		return true
	}
	for _, k := range []string{"tool", "name", "tool_name"} {
		if s, ok := m[k].(string); ok && strings.EqualFold(strings.TrimSpace(s), "ask_question") {
			return true
		}
	}
	return false
}

func extractText(m map[string]any) string {
	for _, k := range []string{"finalText", "delta", "text", "output", "result", "response", "error"} {
		if s, ok := m[k].(string); ok && strings.TrimSpace(s) != "" {
			return s
		}
	}
	if s, ok := m["content"].(string); ok && strings.TrimSpace(s) != "" {
		return s
	}
	if arr, ok := m["content"].([]any); ok {
		var out []string
		for _, item := range arr {
			if sub, ok := item.(map[string]any); ok {
				if s, ok := sub["text"].(string); ok && strings.TrimSpace(s) != "" {
					out = append(out, s)
				}
			}
		}
		if len(out) > 0 {
			return strings.Join(out, "")
		}
	}
	if msg, ok := m["message"].(map[string]any); ok {
		if s := extractText(msg); s != "" {
			return s
		}
	}
	return ""
}

// BuildCrossHarnessHandoff generates a concise handoff preamble when a task
// switches harnesses mid-card (e.g. dsh -> agy or agy -> commandcode).
func BuildCrossHarnessHandoff(prevHarness, nextHarness string, t tasks.Task) string {
	prev := Canonical(prevHarness)
	next := Canonical(nextHarness)
	if prev == "" || next == "" || prev == next {
		return ""
	}
	var b strings.Builder
	b.WriteString("[CROSS-HARNESS HANDOFF]\n")
	b.WriteString(fmt.Sprintf("Previous harness: %s", prev))
	if t.Model != "" {
		b.WriteString(fmt.Sprintf(" (target model: %s)", t.Model))
	}
	b.WriteString(fmt.Sprintf(" -> New harness: %s\n", next))
	b.WriteString("Check `git status` and `git diff` in this worktree to inspect any edits already made by the previous harness.\n")
	if t.ErrorSig != "" {
		b.WriteString("Last error summary: " + t.ErrorSig + "\n")
	}
	if strings.TrimSpace(t.Result) != "" {
		excerpt := strings.TrimSpace(t.Result)
		if len(excerpt) > 600 {
			excerpt = excerpt[len(excerpt)-600:]
		}
		b.WriteString("Last output excerpt:\n" + excerpt + "\n")
	}
	b.WriteString("---\n")
	return b.String()
}
