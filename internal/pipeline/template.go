// Package pipeline implements the deterministic DAG / stage coordinator
// inspired by meta7 (stage waves, gates, boundary-scoped inputs, retry,
// evolve after 3 identical failures, verdict back-arcs, and append-only state).
package pipeline

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

//go:embed templates/*.yaml
var builtinFS embed.FS

var ErrInvalidTemplate = errors.New("invalid pipeline template")

type Budget struct {
	MaxReviewLoops int `yaml:"max_review_loops" json:"max_review_loops"`
	MaxEvolutions  int `yaml:"max_evolutions" json:"max_evolutions"`
}

type FanoutSpec struct {
	From string `yaml:"from" json:"from"`
	Min  int    `yaml:"min" json:"min"`
}

type StageSpec struct {
	ID         string            `yaml:"id" json:"id"`
	Fanout     *FanoutSpec       `yaml:"fanout,omitempty" json:"fanout,omitempty"`
	Per        string            `yaml:"per,omitempty" json:"per,omitempty"`
	Inputs     []string          `yaml:"inputs,omitempty" json:"inputs,omitempty"`
	Verdict    bool              `yaml:"verdict,omitempty" json:"verdict,omitempty"`
	BackArcs   map[string]string `yaml:"back_arcs,omitempty" json:"back_arcs,omitempty"`
	ReviewGate bool              `yaml:"review_gate,omitempty" json:"review_gate,omitempty"`
	GateBand   []string          `yaml:"gate_band,omitempty" json:"gate_band,omitempty"`
	Prompt     string            `yaml:"prompt" json:"prompt"`
}

type Template struct {
	Name        string      `yaml:"name" json:"name"`
	Description string      `yaml:"description,omitempty" json:"description,omitempty"`
	Budget      Budget      `yaml:"budget" json:"budget"`
	Stages      []StageSpec `yaml:"stages" json:"stages"`
}

// ParseTemplate parses and validates a YAML pipeline template.
func ParseTemplate(raw []byte) (Template, error) {
	var t Template
	if err := yaml.Unmarshal(raw, &t); err != nil {
		return Template{}, fmt.Errorf("%w: %v", ErrInvalidTemplate, err)
	}
	if t.Name == "" || len(t.Stages) == 0 {
		return Template{}, fmt.Errorf("%w: name and stages required", ErrInvalidTemplate)
	}
	if t.Budget.MaxReviewLoops <= 0 {
		t.Budget.MaxReviewLoops = 5
	}
	if t.Budget.MaxEvolutions <= 0 {
		t.Budget.MaxEvolutions = 3
	}
	seen := map[string]int{}
	for i, s := range t.Stages {
		if s.ID == "" {
			return Template{}, fmt.Errorf("%w: empty stage id at %d", ErrInvalidTemplate, i)
		}
		if _, dup := seen[s.ID]; dup {
			return Template{}, fmt.Errorf("%w: duplicate stage %s", ErrInvalidTemplate, s.ID)
		}
		if s.Per != "" {
			if idx, ok := seen[s.Per]; !ok || idx >= i {
				return Template{}, fmt.Errorf("%w: stage %s 'per' must reference an earlier stage (%s)", ErrInvalidTemplate, s.ID, s.Per)
			}
		}
		for _, in := range s.Inputs {
			if idx, ok := seen[in]; !ok || idx >= i {
				return Template{}, fmt.Errorf("%w: stage %s input %s must be an earlier stage", ErrInvalidTemplate, s.ID, in)
			}
		}
		seen[s.ID] = i
	}
	for _, s := range t.Stages {
		for k, target := range s.BackArcs {
			idx, ok := seen[target]
			if !ok || idx >= seen[s.ID] {
				return Template{}, fmt.Errorf("%w: stage %s back_arc %s -> %s must target an earlier stage", ErrInvalidTemplate, s.ID, k, target)
			}
		}
	}
	return t, nil
}

// BuiltinTemplates returns all embedded templates sorted by name.
func BuiltinTemplates() ([]Template, error) {
	entries, err := fs.ReadDir(builtinFS, "templates")
	if err != nil {
		return nil, err
	}
	var out []Template
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".yaml") {
			continue
		}
		b, err := fs.ReadFile(builtinFS, "templates/"+e.Name())
		if err != nil {
			return nil, err
		}
		t, err := ParseTemplate(b)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// NodeResult is the structured block extracted from a node's output.
type NodeResult struct {
	Status  string   `json:"status"`
	Verdict string   `json:"verdict,omitempty"`
	Items   []string `json:"items,omitempty"`
	Summary string   `json:"summary,omitempty"`
}

// ParseResult extracts a fenced JSON block or inline JSON from text, falling back
// to heuristics if absent.
func ParseResult(text string) NodeResult {
	trimmed := strings.TrimSpace(text)
	// Look for fenced ```json or ```RESULT block (last one wins).
	if idx := strings.LastIndex(trimmed, "```"); idx > 0 {
		head := trimmed[:idx]
		if open := strings.LastIndex(head, "```"); open >= 0 {
			body := head[open+3:]
			if nl := strings.IndexByte(body, '\n'); nl >= 0 {
				body = body[nl+1:]
			}
			var r NodeResult
			if json.Unmarshal([]byte(strings.TrimSpace(body)), &r) == nil && (r.Status != "" || r.Verdict != "" || len(r.Items) > 0 || r.Summary != "") {
				if r.Status == "" {
					r.Status = "done"
				}
				if r.Summary == "" {
					r.Summary = strings.TrimSpace(body)
				}
				return r
			}
		}
	}
	// Try raw JSON object.
	if strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}") {
		var r NodeResult
		if json.Unmarshal([]byte(trimmed), &r) == nil && (r.Status != "" || r.Verdict != "" || len(r.Items) > 0 || r.Summary != "") {
			if r.Status == "" {
				r.Status = "done"
			}
			if r.Summary == "" {
				r.Summary = trimmed
			}
			return r
		}
	}
	res := NodeResult{Status: "done", Summary: trimmed}
	switch {
	case strings.Contains(trimmed, "FAIL:context"):
		res.Verdict = "FAIL:context"
	case strings.Contains(trimmed, "FAIL:design"):
		res.Verdict = "FAIL:design"
	case strings.Contains(trimmed, "VERDICT=FAIL"), strings.HasPrefix(trimmed, "FAIL"):
		res.Verdict = "FAIL"
	case strings.Contains(trimmed, "PASS"):
		res.Verdict = "PASS"
	}
	return res
}
