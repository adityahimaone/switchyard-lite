package models

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

// AgyModel describes one Antigravity CLI model entry returned by Catalog.List.
type AgyModel struct {
	ID             string   `json:"id"`
	Name           string   `json:"name,omitempty"`
	Label          string   `json:"label"`
	ThinkingLevels []string `json:"thinking_levels,omitempty"`
}

var (
	ansiEscapeRE   = regexp.MustCompile(`\x1b\[[0-9;?]*[a-zA-Z]`)
	multiSpaceRE   = regexp.MustCompile(`\s{2,}|\t+`)
	validModelIDRE = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]{2,}$`)
)

// AgyThinkingLevels lists all supported thinking/effort presets in the UI.
// Note: "minimal" maps to "--effort low" when passed to the agy CLI.
var AgyThinkingLevels = []string{"minimal", "low", "medium", "high", "xhigh", "max"}

func isAgyExecutor(executor string) bool {
	switch strings.ToLower(strings.TrimSpace(executor)) {
	case "agy", "antigravity":
		return true
	default:
		return false
	}
}

// DefaultAgyModels returns the curated fallback list of Antigravity CLI models
// when the local agy binary cannot be executed.
func DefaultAgyModels() []AgyModel {
	levels := append([]string(nil), AgyThinkingLevels...)
	return []AgyModel{
		{ID: "gemini-4-neon-high", Label: "Gemini 4 Neon (High)", ThinkingLevels: levels},
		{ID: "gemini-4-neon-xhigh", Label: "Gemini 4 Neon (XHigh)", ThinkingLevels: levels},
		{ID: "gemini-4-neon-medium", Label: "Gemini 4 Neon (Medium)", ThinkingLevels: levels},
		{ID: "gemini-4-neon-low", Label: "Gemini 4 Neon (Low)", ThinkingLevels: levels},
		{ID: "gemini-4-argon-high", Label: "Gemini 4 Argon (High)", ThinkingLevels: levels},
		{ID: "gemini-4-argon-medium", Label: "Gemini 4 Argon (Medium)", ThinkingLevels: levels},
		{ID: "gemini-4-argon-low", Label: "Gemini 4 Argon (Low)", ThinkingLevels: levels},
		{ID: "gemini-4-hydrogen-high", Label: "Gemini 4 Hydrogen (High)", ThinkingLevels: levels},
		{ID: "gemini-4-hydrogen-xhigh", Label: "Gemini 4 Hydrogen (XHigh)", ThinkingLevels: levels},
		{ID: "gemini-4-hydrogen-medium", Label: "Gemini 4 Hydrogen (Medium)", ThinkingLevels: levels},
		{ID: "gemini-4-hydrogen-low", Label: "Gemini 4 Hydrogen (Low)", ThinkingLevels: levels},
		{ID: "gemini-pro-orchestrator-neon", Label: "Orchestrator (Neon)", ThinkingLevels: levels},
		{ID: "gemini-pro-orchestrator-g1-pro", Label: "Orchestrator (Argon)", ThinkingLevels: levels},
		{ID: "gemini-3.8-flash-high", Label: "Gemini 3.8 Flash (High)", ThinkingLevels: levels},
		{ID: "gemini-3.8-flash-medium", Label: "Gemini 3.8 Flash (Medium)", ThinkingLevels: levels},
		{ID: "gemini-3.8-flash-low", Label: "Gemini 3.8 Flash (Low)", ThinkingLevels: levels},
		{ID: "claude-opus-5-5-high", Label: "Claude Opus 5.5 (High)", ThinkingLevels: levels},
		{ID: "claude-opus-5-5-medium", Label: "Claude Opus 5.5 (Medium)", ThinkingLevels: levels},
		{ID: "claude-opus-5-5-low", Label: "Claude Opus 5.5 (Low)", ThinkingLevels: levels},
		{ID: "claude-sonnet-5-5-high", Label: "Claude Sonnet 5.5 (High)", ThinkingLevels: levels},
		{ID: "claude-sonnet-5-5-medium", Label: "Claude Sonnet 5.5 (Medium)", ThinkingLevels: levels},
		{ID: "claude-sonnet-5-5-low", Label: "Claude Sonnet 5.5 (Low)", ThinkingLevels: levels},
		{ID: "gpt-oss-120b-medium", Label: "GPT-OSS 120B (Medium)", ThinkingLevels: levels},
	}
}

// ParseAgyModelsOutput parses raw stdout from `agy models`, handling spinner
// carriage returns, ANSI escapes, tabs, and aligned column spaces.
func ParseAgyModelsOutput(raw string) []AgyModel {
	clean := ansiEscapeRE.ReplaceAllString(raw, "")
	clean = strings.ReplaceAll(clean, "\r\n", "\n")
	clean = strings.ReplaceAll(clean, "\r", "\n")

	lines := strings.Split(clean, "\n")
	seen := map[string]bool{}
	out := make([]AgyModel, 0, len(lines))
	levels := append([]string(nil), AgyThinkingLevels...)

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		lower := strings.ToLower(line)
		if strings.Contains(lower, "fetching available models") ||
			strings.HasPrefix(lower, "available models") ||
			strings.HasPrefix(lower, "model ") ||
			strings.HasPrefix(line, "+") ||
			strings.HasPrefix(line, "-") {
			continue
		}
		// Strip leading braille spinner glyphs if glued to text.
		line = strings.TrimLeft(line, "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ ")
		if line == "" {
			continue
		}

		var id, label string
		if parts := multiSpaceRE.Split(line, 2); len(parts) == 2 {
			id = strings.TrimSpace(parts[0])
			label = strings.TrimSpace(parts[1])
		} else {
			fields := strings.Fields(line)
			if len(fields) == 0 {
				continue
			}
			id = fields[0]
			if len(fields) > 1 {
				label = strings.Join(fields[1:], " ")
			}
		}
		if !validModelIDRE.MatchString(id) || seen[id] {
			continue
		}
		if label == "" {
			label = id
		}
		seen[id] = true
		out = append(out, AgyModel{ID: id, Label: label, ThinkingLevels: levels})
	}
	return out
}

// ResolveAgyBinary finds the `agy` CLI executable using PATH and common user locations.
func ResolveAgyBinary() (string, bool) {
	return ResolveLocalExecutorBinary("agy")
}

// ListAgyForTarget lists Antigravity models using overrideRunner (e.g. a remote worker shell)
// and caches per machine key.
func (c *Catalog) ListAgyForTarget(
	ctx context.Context,
	machine string,
	source string,
	overrideRunner func(ctx context.Context) ([]byte, error),
	refresh bool,
) json.RawMessage {
	cacheKey := "agy::" + strings.TrimSpace(machine)
	c.mu.Lock()
	e, hit := c.cache[cacheKey]
	c.mu.Unlock()
	if hit && !refresh && c.now().Sub(e.at) < c.TTL {
		return e.data
	}

	if overrideRunner != nil {
		if out, err := overrideRunner(ctx); err == nil {
			if parsed := ParseAgyModelsOutput(string(out)); len(parsed) > 0 {
				for i := range parsed {
					if parsed[i].Name == "" {
						parsed[i].Name = parsed[i].Label
					}
				}
				src := source
				if src == "" {
					src = "remote-cli"
				}
				b, _ := json.Marshal(map[string]any{
					"executor": "agy",
					"source":   src,
					"machine":  machine,
					"models":   parsed,
				})
				c.mu.Lock()
				if c.cache == nil {
					c.cache = map[string]entry{}
				}
				c.cache[cacheKey] = entry{at: c.now(), data: b}
				c.mu.Unlock()
				return b
			}
		}
	}
	return c.listAgyModels(ctx, "agy")
}

func runAgyModelsCLI(ctx context.Context) ([]byte, error) {
	bin, ok := ResolveAgyBinary()
	if !ok {
		return nil, exec.ErrNotFound
	}
	cctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	cmd := exec.CommandContext(cctx, bin, "models")
	return cmd.CombinedOutput()
}

func (c *Catalog) listAgyModels(ctx context.Context, executor string) json.RawMessage {
	runner := c.RunAgyModels
	if runner == nil {
		runner = runAgyModelsCLI
	}
	if out, err := runner(ctx); err == nil {
		if parsed := ParseAgyModelsOutput(string(out)); len(parsed) > 0 {
			for i := range parsed {
				if parsed[i].Name == "" {
					parsed[i].Name = parsed[i].Label
				}
			}
			b, _ := json.Marshal(map[string]any{
				"executor": "agy",
				"source":   "cli",
				"models":   parsed,
			})
			return b
		}
	}
	// If node-agent is configured and RunAgyModels wasn't overridden for local test,
	// give node-agent a chance before falling back to DefaultAgyModels.
	if c.BaseURL != "" && c.RunAgyModels == nil {
		u := strings.TrimRight(c.BaseURL, "/") + "/api/models?executor=" + url.QueryEscape(executor)
		if req, err := http.NewRequestWithContext(ctx, "GET", u, nil); err == nil {
			if c.Token != "" {
				req.Header.Set("X-Node-Agent-Token", c.Token)
			}
			hc := c.HTTP
			if hc == nil {
				hc = &http.Client{Timeout: 8 * time.Second}
			}
			if resp, err := hc.Do(req); err == nil {
				defer resp.Body.Close()
				if resp.StatusCode < 300 {
					var raw json.RawMessage
					if json.NewDecoder(resp.Body).Decode(&raw) == nil && len(raw) > 2 {
						return raw
					}
				}
			}
		}
	}
	defs := DefaultAgyModels()
	for i := range defs {
		if defs[i].Name == "" {
			defs[i].Name = defs[i].Label
		}
	}
	b, _ := json.Marshal(map[string]any{
		"executor": "agy",
		"source":   "default",
		"models":   defs,
	})
	return b
}
