package dispatch

import (
	"encoding/json"
	"regexp"
	"strings"
)

var (
	reQuestionJSONFence = regexp.MustCompile("(?is)```(?:question|json)?\\s*\\n(\\{[\\s\\S]*?\"question\"[\\s\\S]*?\\})\\s*```")
	reQuestionTagBlock  = regexp.MustCompile(`(?is)\[QUESTION\]([\s\S]*?)\[/QUESTION\]`)
	reNumberedOpt       = regexp.MustCompile(`^(?:\d+[\.\)]|[A-Za-z][\.\)]|[-*]\s*\[[ xX]?\])\s+(.+)$`)
)

// DetectOpenQuestion extracts a structured clarification / grill-me prompt and
// its selectable choices from worker output emitted by dsh, commandcode, agy, or an MCP caller.
func DetectOpenQuestion(output string) (question string, options []string, contextText string, ok bool) {
	q, opts, ctx, _, found := DetectOpenQuestionFull(output)
	return q, opts, ctx, found
}

// DetectOpenQuestionFull extracts question, options, context, and multi_select.
func DetectOpenQuestionFull(output string) (question string, options []string, contextText string, multiSelect bool, ok bool) {
	trimmed := strings.TrimSpace(output)
	if trimmed == "" {
		return "", nil, "", false, false
	}

	// 1. Explicit fenced JSON block containing {"question": ..., "options": [...]}.
	if matches := reQuestionJSONFence.FindAllStringSubmatch(trimmed, -1); len(matches) > 0 {
		last := matches[len(matches)-1][1]
		if q, opts, ctx, multi, found := parseQuestionJSONFull(last); found {
			return q, opts, ctx, multi, true
		}
	}

	// 2. Explicit [QUESTION]...[/QUESTION] tag block.
	if matches := reQuestionTagBlock.FindAllStringSubmatch(trimmed, -1); len(matches) > 0 {
		last := strings.TrimSpace(matches[len(matches)-1][1])
		if q, opts, ctx, found := parseNaturalQuestionBlock(last, true); found {
			return q, opts, ctx, false, true
		}
	}

	// 3. Single-line JSON object near the end of output.
	lines := strings.Split(trimmed, "\n")
	startScan := len(lines) - 12
	if startScan < 0 {
		startScan = 0
	}
	for i := len(lines) - 1; i >= startScan; i-- {
		ln := strings.TrimSpace(lines[i])
		if strings.HasPrefix(ln, "{") && strings.Contains(ln, `"question`) {
			if q, opts, ctx, multi, found := parseQuestionJSONFull(ln); found {
				return q, opts, ctx, multi, true
			}
		}
	}

	// 4. Natural tail pattern from dsh / commandcode / agy (question ending in '?' followed by 2..8 options).
	tailStart := len(lines) - 30
	if tailStart < 0 {
		tailStart = 0
	}
	tail := strings.Join(lines[tailStart:], "\n")
	q, opts, ctx, found := parseNaturalQuestionBlock(tail, false)
	return q, opts, ctx, false, found
}

type rawQuestionItem struct {
	Question    string   `json:"question"`
	Prompt      string   `json:"prompt"`
	Context     string   `json:"context"`
	Options     []string `json:"options"`
	Choices     []string `json:"choices"`
	MultiSelect bool     `json:"multi_select"`
}

func extractQuestionFromItem(item rawQuestionItem) (string, []string, string, bool, bool) {
	q := strings.TrimSpace(item.Question)
	if q == "" {
		q = strings.TrimSpace(item.Prompt)
	}
	opts := item.Options
	if len(opts) == 0 {
		opts = item.Choices
	}
	cleanOpts := dedupeTrim(opts)
	if q == "" || len(cleanOpts) < 1 {
		return "", nil, "", false, false
	}
	return q, cleanOpts, strings.TrimSpace(item.Context), item.MultiSelect, true
}

func extractQuestionFromObject(obj map[string]any) (string, []string, string, bool, bool) {
	if obj == nil {
		return "", nil, "", false, false
	}
	b, err := json.Marshal(obj)
	if err == nil {
		var single rawQuestionItem
		if json.Unmarshal(b, &single) == nil {
			if q, opts, ctx, multi, ok := extractQuestionFromItem(single); ok {
				return q, opts, ctx, multi, true
			}
		}
		var batch struct {
			Questions []rawQuestionItem `json:"questions"`
			Context   string            `json:"context"`
		}
		if json.Unmarshal(b, &batch) == nil && len(batch.Questions) > 0 {
			if q, opts, ctx, multi, ok := extractQuestionFromItem(batch.Questions[0]); ok {
				if ctx == "" {
					ctx = strings.TrimSpace(batch.Context)
				}
				return q, opts, ctx, multi, true
			}
		}
	}
	for _, key := range []string{"args", "arguments", "input", "payload", "tool_use", "tool_call", "functionCall", "call", "function"} {
		if sub, ok := obj[key].(map[string]any); ok {
			if q, opts, ctx, multi, found := extractQuestionFromObject(sub); found {
				return q, opts, ctx, multi, true
			}
		} else if rawStr, ok := obj[key].(string); ok && strings.HasPrefix(strings.TrimSpace(rawStr), "{") {
			if q, opts, ctx, multi, found := parseQuestionJSONFull(rawStr); found {
				return q, opts, ctx, multi, true
			}
		}
	}
	if tcs, ok := obj["tool_calls"].([]any); ok {
		for _, tc := range tcs {
			if sub, ok := tc.(map[string]any); ok {
				if q, opts, ctx, multi, found := extractQuestionFromObject(sub); found {
					return q, opts, ctx, multi, true
				}
			}
		}
	}
	return "", nil, "", false, false
}

func parseQuestionJSONFull(raw string) (string, []string, string, bool, bool) {
	var obj map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &obj); err != nil {
		return "", nil, "", false, false
	}
	return extractQuestionFromObject(obj)
}

func parseNaturalQuestionBlock(text string, explicitTag bool) (string, []string, string, bool) {
	rawLines := strings.Split(strings.TrimSpace(text), "\n")
	if len(rawLines) < 2 {
		return "", nil, "", false
	}

	// Trim trailing blank lines.
	end := len(rawLines) - 1
	for end >= 0 && strings.TrimSpace(rawLines[end]) == "" {
		end--
	}
	if end < 1 {
		return "", nil, "", false
	}

	// Collect contiguous option lines scanning upward from the tail (allowing single blank separators).
	var optRev []string
	optStart := end + 1
	inCodeFence := false
	for i := end; i >= 0; i-- {
		line := strings.TrimSpace(rawLines[i])
		if strings.HasPrefix(line, "```") {
			inCodeFence = !inCodeFence
			break
		}
		if line == "" {
			if len(optRev) > 0 {
				// Stop if we hit a blank gap above options.
				if i > 0 && reNumberedOpt.MatchString(strings.TrimSpace(rawLines[i-1])) {
					continue
				}
				break
			}
			continue
		}
		if m := reNumberedOpt.FindStringSubmatch(line); len(m) == 2 {
			optRev = append(optRev, strings.TrimSpace(m[1]))
			optStart = i
			continue
		}
		if len(optRev) > 0 {
			break
		}
		// Ignore trailing closing hint line like "Reply with 1-3 or custom answer." if options sit right above it.
		if i == end && isReplyHintLine(line) {
			continue
		}
		break
	}
	if inCodeFence || len(optRev) < 2 || len(optRev) > 8 {
		return "", nil, "", false
	}

	// Reverse collected options.
	options := make([]string, 0, len(optRev))
	for i := len(optRev) - 1; i >= 0; i-- {
		options = append(options, optRev[i])
	}
	options = dedupeTrim(options)
	if len(options) < 2 {
		return "", nil, "", false
	}

	// Look right above optStart for the question line.
	qIdx := -1
	for i := optStart - 1; i >= 0; i-- {
		line := strings.TrimSpace(rawLines[i])
		if line == "" {
			continue
		}
		qIdx = i
		break
	}
	if qIdx < 0 {
		return "", nil, "", false
	}
	qLine := cleanMarkdownPrefix(strings.TrimSpace(rawLines[qIdx]))
	if qLine == "" {
		return "", nil, "", false
	}
	if !explicitTag && !looksLikeQuestion(qLine) {
		return "", nil, "", false
	}

	var ctxLines []string
	for i := qIdx - 1; i >= 0 && len(ctxLines) < 2; i-- {
		l := strings.TrimSpace(rawLines[i])
		if l == "" || strings.HasPrefix(l, "```") {
			if len(ctxLines) > 0 {
				break
			}
			continue
		}
		ctxLines = append([]string{l}, ctxLines...)
	}

	return qLine, options, strings.Join(ctxLines, "\n"), true
}

func isReplyHintLine(s string) bool {
	lower := strings.ToLower(s)
	return strings.Contains(lower, "reply with") ||
		strings.Contains(lower, "choose an option") ||
		strings.Contains(lower, "select an option") ||
		strings.Contains(lower, "pilih opsi") ||
		strings.Contains(lower, "jawab dengan")
}

func looksLikeQuestion(s string) bool {
	if strings.HasSuffix(s, "?") {
		return true
	}
	lower := strings.ToLower(s)
	for _, prefix := range []string{
		"question:", "open question:", "grill-me:", "grill me:", "clarification needed:",
		"please choose", "which option", "select ", "pick ", "pertanyaan:", "silakan pilih",
	} {
		if strings.HasPrefix(lower, prefix) || strings.Contains(lower, prefix) {
			return true
		}
	}
	return false
}

func cleanMarkdownPrefix(s string) string {
	s = strings.TrimLeft(s, "#*> ")
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "**") && strings.HasSuffix(s, "**") && len(s) > 4 {
		s = strings.TrimSpace(s[2 : len(s)-2])
	}
	return s
}

func dedupeTrim(items []string) []string {
	out := make([]string, 0, len(items))
	seen := map[string]bool{}
	for _, it := range items {
		it = strings.TrimSpace(it)
		if it == "" || seen[it] {
			continue
		}
		seen[it] = true
		out = append(out, it)
	}
	return out
}
