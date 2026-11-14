package dispatch

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/adityahimaone/switchyard-lite/internal/tasks"
)

const maxWorkerLogBytes = 256 << 10

// DefaultWorkerLogDir returns the default directory for persisted per-task worker logs.
func DefaultWorkerLogDir() string {
	if env := strings.TrimSpace(os.Getenv("SWITCHYARD_LOG_DIR")); env != "" {
		return env
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return filepath.Join(home, ".hermes", "switchyard-lite", "logs")
	}
	return filepath.Join(os.TempDir(), "switchyard-lite", "logs")
}

// WorkerLogDir returns the active directory for task worker logs.
func (d *Dispatcher) WorkerLogDir() string {
	if d != nil && strings.TrimSpace(d.LogDir) != "" {
		return d.LogDir
	}
	return DefaultWorkerLogDir()
}

// SafeTaskLogName sanitizes a task ID into a safe single-segment filename stem.
func SafeTaskLogName(taskID string) string {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return "unknown"
	}
	var b strings.Builder
	b.Grow(len(taskID))
	for _, r := range taskID {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-', r == '.':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	s := strings.Trim(b.String(), ".")
	if s == "" {
		return "unknown"
	}
	return s
}

// WorkerLogPath returns the on-disk log file path for a task.
func WorkerLogPath(dir, taskID string) string {
	if strings.TrimSpace(dir) == "" {
		dir = DefaultWorkerLogDir()
	}
	return filepath.Join(dir, SafeTaskLogName(taskID)+".log")
}

// ResetWorkerLog truncates or creates a fresh log file before starting a new attempt.
func ResetWorkerLog(dir, taskID string) error {
	p := WorkerLogPath(dir, taskID)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(p, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	return f.Close()
}

// AppendWorkerLog appends a text chunk to the task's log file.
func AppendWorkerLog(dir, taskID, text string) error {
	if text == "" {
		return nil
	}
	p := WorkerLogPath(dir, taskID)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(p, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.WriteString(f, text)
	return err
}

// WorkerLogTail reads up to 256 KiB of worker log starting at byte offset.
// If offset == 0 and the file exceeds 256 KiB, it returns the trailing 256 KiB aligned to a line boundary.
func WorkerLogTail(dir, taskID string, offset int64) (string, int64, error) {
	if offset < 0 {
		offset = 0
	}
	p := WorkerLogPath(dir, taskID)
	f, err := os.Open(p)
	if err != nil {
		if os.IsNotExist(err) {
			return "", 0, nil
		}
		return "", offset, err
	}
	defer f.Close()

	st, err := f.Stat()
	if err != nil {
		return "", offset, err
	}
	size := st.Size()
	if offset > size {
		// Log was reset for a new run; restart from the beginning.
		offset = 0
	}
	if offset == size {
		return "", size, nil
	}

	readFrom := offset
	trimmedHead := false
	if readFrom == 0 && size > maxWorkerLogBytes {
		readFrom = size - maxWorkerLogBytes
		trimmedHead = true
	}
	toRead := size - readFrom
	if toRead > maxWorkerLogBytes {
		toRead = maxWorkerLogBytes
	}

	if _, err := f.Seek(readFrom, io.SeekStart); err != nil {
		return "", offset, err
	}
	buf := make([]byte, toRead)
	n, err := io.ReadFull(f, buf)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return "", offset, err
	}
	buf = buf[:n]
	nextOffset := readFrom + int64(n)

	if trimmedHead {
		if idx := strings.IndexByte(string(buf), '\n'); idx >= 0 && idx+1 < len(buf) {
			buf = buf[idx+1:]
		}
	}
	return string(buf), nextOffset, nil
}

// ExtractFailureReason derives a human-readable root error from a generic executor error and raw worker output
// (including dsh JSONL error frames), and reports whether the failure is permanent (non-retryable).
func ExtractFailureReason(rawErr, output string) (string, bool) {
	extracted := extractFromOutput(output)
	candidate := strings.TrimSpace(extracted)
	if candidate == "" {
		candidate = strings.TrimSpace(rawErr)
	} else if rawErr = strings.TrimSpace(rawErr); rawErr != "" && !isGenericExitError(rawErr) && !strings.Contains(candidate, rawErr) {
		candidate = candidate + " (" + rawErr + ")"
	}
	if candidate == "" {
		candidate = "worker execution failed"
	}
	return candidate, isPermanentFailure(candidate + "\n" + output)
}

func isGenericExitError(msg string) bool {
	low := strings.ToLower(strings.TrimSpace(msg))
	return low == "" || strings.HasPrefix(low, "exit status ") || low == "signal: killed" || low == "signal: terminated"
}

func isPermanentFailure(text string) bool {
	low := strings.ToLower(text)
	for _, needle := range []string{
		"quota",
		"[402]",
		"http 402",
		"status 402",
		"status: 402",
		"\"status\":402",
		"\"code\":\"quota\"",
		"balance too low",
		"insufficient_balance",
		"insufficient balance",
		"insufficient quota",
		"deposit usdc",
		"payment required",
		"invalid api key",
		"authentication failed",
		"executable file not found",
		"unknown executor",
	} {
		if strings.Contains(low, needle) {
			return true
		}
	}
	return false
}

func extractFromOutput(output string) string {
	output = strings.TrimSpace(output)
	if output == "" {
		return ""
	}
	lines := strings.Split(output, "\n")
	// Scan bottom-up so the final/terminal failure frame wins over transient noise.
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "{") {
			if msg := extractJSONErrorLine(line); msg != "" {
				return msg
			}
		}
	}
	// Fallback: look bottom-up for plain text error lines.
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" || strings.HasPrefix(line, "{") {
			continue
		}
		low := strings.ToLower(line)
		if strings.Contains(low, "error") || strings.Contains(low, "fatal") || strings.Contains(low, "quota") ||
			strings.Contains(low, "[402]") || strings.Contains(low, "balance too low") || strings.Contains(low, "failed") {
			return line
		}
	}
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if line != "" && !strings.HasPrefix(line, "{") {
			return line
		}
	}
	return ""
}

func extractJSONErrorLine(line string) string {
	var obj map[string]any
	if err := json.Unmarshal([]byte(line), &obj); err != nil {
		return ""
	}
	typ := strField(obj, "type")
	status := strings.ToLower(strField(obj, "status"))

	if errVal, ok := obj["error"]; ok && errVal != nil {
		if msg := formatErrorValue(errVal); msg != "" {
			return msg
		}
	}
	if typ == "error" || typ == "turn_end" || typ == "final" || typ == "result" || status == "error" || status == "failed" {
		if boolField(obj, "is_error") || status == "error" || status == "failed" || typ == "error" || !boolFieldDefault(obj, "ok", true) {
			for _, k := range []string{"message", "detail", "reason", "result"} {
				if s := strings.TrimSpace(strField(obj, k)); s != "" {
					return s
				}
			}
		}
	}
	return ""
}

func formatErrorValue(v any) string {
	switch x := v.(type) {
	case string:
		return strings.TrimSpace(x)
	case map[string]any:
		msg := firstNonEmpty(
			strField(x, "message"),
			strField(x, "detail"),
			strField(x, "error"),
			strField(x, "reason"),
		)
		code := firstNonEmpty(strField(x, "code"), strField(x, "error_code"))
		source := strField(x, "source")
		status := intField(x, "status", "status_code")

		var tags []string
		if code != "" && !strings.Contains(msg, code) {
			tags = append(tags, code)
		}
		if status > 0 && !strings.Contains(msg, fmt.Sprintf("%d", status)) {
			tags = append(tags, fmt.Sprintf("%d", status))
		}
		if source != "" && !strings.Contains(strings.ToLower(msg), strings.ToLower(source)) {
			tags = append(tags, source)
		}
		if msg == "" && len(tags) == 0 {
			return ""
		}
		if len(tags) == 0 {
			return msg
		}
		if msg == "" {
			return strings.Join(tags, " ")
		}
		return fmt.Sprintf("%s: %s", strings.Join(tags, " · "), msg)
	}
	return ""
}

// TaskRunUsage captures token, cost, turn, and timing metrics extracted from worker telemetry.
type TaskRunUsage struct {
	InputTokens      int64   `json:"input_tokens,omitempty"`
	OutputTokens     int64   `json:"output_tokens,omitempty"`
	CacheReadTokens  int64   `json:"cache_read_tokens,omitempty"`
	CacheWriteTokens int64   `json:"cache_write_tokens,omitempty"`
	TotalTokens      int64   `json:"total_tokens,omitempty"`
	CostUSD          float64 `json:"cost_usd,omitempty"`
	DurationMS       int64   `json:"duration_ms,omitempty"`
	Turns            int     `json:"turns,omitempty"`
	Model            string  `json:"model,omitempty"`
}

// TaskRun summarizes one execution attempt reconstructed from the task event stream.
type TaskRun struct {
	Run        int           `json:"run"`
	WorkerID   string        `json:"worker_id,omitempty"`
	SessionID  string        `json:"session_id,omitempty"`
	Executor   string        `json:"executor,omitempty"`
	Model      string        `json:"model,omitempty"`
	Status     string        `json:"status"`
	StartedAt  int64         `json:"started_at"`
	EndedAt    int64         `json:"ended_at,omitempty"`
	DurationS  int64         `json:"duration_s,omitempty"`
	DurationMS int64         `json:"duration_ms,omitempty"`
	Error      string        `json:"error,omitempty"`
	Output     string        `json:"output,omitempty"`
	Usage      *TaskRunUsage `json:"usage,omitempty"`
	Events     int           `json:"events"`
}

// UsageFromJSON extracts token/cost/turn metrics from a structured payload or nested dsh JSONL output.
func UsageFromJSON(payload map[string]any, output string) *TaskRunUsage {
	var u TaskRunUsage
	if payload != nil {
		if rawUsage, ok := payload["usage"].(map[string]any); ok {
			applyUsageMap(&u, rawUsage)
		}
		applyUsageMap(&u, payload)
	}
	if output != "" {
		extractUsageFromOutput(&u, output)
	}
	if u.TotalTokens == 0 && (u.InputTokens > 0 || u.OutputTokens > 0 || u.CacheReadTokens > 0 || u.CacheWriteTokens > 0) {
		u.TotalTokens = u.InputTokens + u.OutputTokens + u.CacheReadTokens + u.CacheWriteTokens
	}
	if u.InputTokens == 0 && u.OutputTokens == 0 && u.TotalTokens == 0 && u.CostUSD == 0 && u.Turns == 0 {
		return nil
	}
	return &u
}

func applyUsageMap(u *TaskRunUsage, m map[string]any) {
	if v := int64Field(m, "input_tokens", "prompt_tokens"); v > u.InputTokens {
		u.InputTokens = v
	}
	if v := int64Field(m, "output_tokens", "completion_tokens"); v > u.OutputTokens {
		u.OutputTokens = v
	}
	if v := int64Field(m, "cache_read_tokens", "cache_read_input_tokens"); v > u.CacheReadTokens {
		u.CacheReadTokens = v
	}
	if v := int64Field(m, "cache_write_tokens", "cache_creation_input_tokens"); v > u.CacheWriteTokens {
		u.CacheWriteTokens = v
	}
	if v := int64Field(m, "total_tokens"); v > u.TotalTokens {
		u.TotalTokens = v
	}
	if v := floatField(m, "cost_usd", "total_cost_usd", "cost"); v > u.CostUSD {
		u.CostUSD = v
	}
	if v := int64Field(m, "duration_ms"); v > u.DurationMS {
		u.DurationMS = v
	}
	if v := intField(m, "turns", "num_turns"); v > u.Turns {
		u.Turns = v
	}
	if s := strField(m, "model"); s != "" && u.Model == "" {
		u.Model = s
	}
}

func extractUsageFromOutput(u *TaskRunUsage, output string) {
	var turns int
	for _, raw := range strings.Split(output, "\n") {
		line := strings.TrimSpace(raw)
		if !strings.HasPrefix(line, "{") {
			continue
		}
		var obj map[string]any
		if err := json.Unmarshal([]byte(line), &obj); err != nil {
			continue
		}
		typ := strField(obj, "type")
		if typ == "turn_start" || typ == "turn_end" {
			if t := intField(obj, "turn"); t > turns {
				turns = t
			}
		}
		if sub, ok := obj["usage"].(map[string]any); ok {
			applyUsageMap(u, sub)
		}
		if sub, ok := obj["tokens"].(map[string]any); ok {
			applyUsageMap(u, sub)
		}
		applyUsageMap(u, obj)
	}
	if turns > u.Turns {
		u.Turns = turns
	}
}

// GroupTaskRuns reconstructs discrete execution runs from an ordered task event list.
func GroupTaskRuns(events []tasks.Event) []TaskRun {
	runs := []TaskRun{}
	var cur *TaskRun

	closeCurrent := func(status string, at int64) {
		if cur == nil {
			return
		}
		if cur.Status == "running" {
			cur.Status = status
		}
		if cur.EndedAt == 0 {
			cur.EndedAt = at
		}
		if cur.DurationS == 0 && cur.StartedAt > 0 && cur.EndedAt >= cur.StartedAt {
			cur.DurationS = cur.EndedAt - cur.StartedAt
		}
		if cur.DurationMS == 0 && cur.DurationS > 0 {
			cur.DurationMS = cur.DurationS * 1000
		}
		runs = append(runs, *cur)
		cur = nil
	}

	ensureCurrent := func(at int64, payload map[string]any) {
		if cur != nil {
			return
		}
		cur = &TaskRun{
			Run:       len(runs) + 1,
			Status:    "running",
			StartedAt: at,
			WorkerID:  firstNonEmpty(strField(payload, "worker_id"), strField(payload, "run_id")),
			SessionID: firstNonEmpty(strField(payload, "session_id"), strField(payload, "dsh_session_id")),
			Executor:  strField(payload, "executor"),
			Model:     strField(payload, "model"),
		}
	}

	for _, ev := range events {
		var p map[string]any
		if len(ev.Payload) > 0 {
			_ = json.Unmarshal(ev.Payload, &p)
		}

		switch ev.Kind {
		case "claimed", "started", "task.dispatched":
			if cur != nil && cur.WorkerID == "" && cur.SessionID == "" && cur.Output == "" && cur.Events <= 1 {
				if s := firstNonEmpty(strField(p, "worker_id"), strField(p, "run_id")); s != "" {
					cur.WorkerID = s
				}
				if s := firstNonEmpty(strField(p, "session_id"), strField(p, "dsh_session_id")); s != "" && cur.SessionID == "" {
					cur.SessionID = s
				}
				if s := strField(p, "executor"); s != "" && cur.Executor == "" {
					cur.Executor = s
				}
				if s := strField(p, "model"); s != "" && cur.Model == "" {
					cur.Model = s
				}
				cur.Events++
				break
			}
			if cur != nil {
				closeCurrent("interrupted", ev.CreatedAt)
			}
			ensureCurrent(ev.CreatedAt, p)
			cur.Events++

		case "worktree_ready", "remote_dispatched", "lease_renewed":
			ensureCurrent(ev.CreatedAt, p)
			cur.Events++
			if s := firstNonEmpty(strField(p, "worker_id"), strField(p, "run_id")); s != "" && cur.WorkerID == "" {
				cur.WorkerID = s
			}
			if s := firstNonEmpty(strField(p, "session_id"), strField(p, "dsh_session_id")); s != "" && cur.SessionID == "" {
				cur.SessionID = s
			}
			if s := strField(p, "executor"); s != "" && cur.Executor == "" {
				cur.Executor = s
			}
			if s := strField(p, "model"); s != "" && cur.Model == "" {
				cur.Model = s
			}

		case "worker_output":
			ensureCurrent(ev.CreatedAt, p)
			cur.Events++
			chunk := rawFirstNonEmpty(strField(p, "output"), strField(p, "text"), strField(p, "delta"))
			if chunk != "" {
				cur.Output += chunk
			}
			if u := UsageFromJSON(p, chunk); u != nil {
				cur.Usage = mergeUsage(cur.Usage, u)
			}

		case "completed", "failed", "timeout", "canceled":
			ensureCurrent(ev.CreatedAt, p)
			cur.Events++
			if s := firstNonEmpty(strField(p, "session_id"), strField(p, "dsh_session_id")); s != "" {
				cur.SessionID = s
			}
			if s := strField(p, "executor"); s != "" && cur.Executor == "" {
				cur.Executor = s
			}
			if s := strField(p, "model"); s != "" && cur.Model == "" {
				cur.Model = s
			}
			if ms := int64Field(p, "duration_ms"); ms > 0 {
				cur.DurationMS = ms
				if cur.DurationS == 0 && ms >= 1000 {
					cur.DurationS = ms / 1000
				}
			}
			if s := firstNonEmpty(strField(p, "error"), strField(p, "reason"), strField(p, "message")); s != "" {
				cur.Error = s
			}
			if out := strField(p, "output"); out != "" && (cur.Output == "" || len(out) > len(cur.Output)) {
				cur.Output = out
			}
			if u := UsageFromJSON(p, cur.Output); u != nil {
				cur.Usage = mergeUsage(cur.Usage, u)
				if cur.DurationMS > 0 && cur.Usage.DurationMS == 0 {
					cur.Usage.DurationMS = cur.DurationMS
				}
			}
			closeCurrent(ev.Kind, ev.CreatedAt)

		case "task.moved":
			to := strField(p, "to")
			from := strField(p, "from")
			if to == string(tasks.InProgress) && cur == nil {
				ensureCurrent(ev.CreatedAt, p)
				cur.Events++
			} else if cur != nil && from == string(tasks.InProgress) && to != string(tasks.InProgress) {
				cur.Events++
				switch to {
				case string(tasks.Review), string(tasks.Done):
					closeCurrent("completed", ev.CreatedAt)
				case string(tasks.Failed):
					closeCurrent("failed", ev.CreatedAt)
				default:
					closeCurrent("canceled", ev.CreatedAt)
				}
			}
		}
	}

	if cur != nil {
		runs = append(runs, *cur)
	}
	return runs
}

func mergeUsage(a, b *TaskRunUsage) *TaskRunUsage {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	out := *a
	if b.InputTokens > out.InputTokens {
		out.InputTokens = b.InputTokens
	}
	if b.OutputTokens > out.OutputTokens {
		out.OutputTokens = b.OutputTokens
	}
	if b.CacheReadTokens > out.CacheReadTokens {
		out.CacheReadTokens = b.CacheReadTokens
	}
	if b.CacheWriteTokens > out.CacheWriteTokens {
		out.CacheWriteTokens = b.CacheWriteTokens
	}
	if b.TotalTokens > out.TotalTokens {
		out.TotalTokens = b.TotalTokens
	}
	if b.CostUSD > out.CostUSD {
		out.CostUSD = b.CostUSD
	}
	if b.DurationMS > out.DurationMS {
		out.DurationMS = b.DurationMS
	}
	if b.Turns > out.Turns {
		out.Turns = b.Turns
	}
	if out.Model == "" {
		out.Model = b.Model
	}
	return &out
}

func strField(m map[string]any, k string) string {
	if m == nil {
		return ""
	}
	if s, ok := m[k].(string); ok {
		return s
	}
	return ""
}

func boolField(m map[string]any, k string) bool {
	if m == nil {
		return false
	}
	b, ok := m[k].(bool)
	return ok && b
}

func boolFieldDefault(m map[string]any, k string, def bool) bool {
	if m == nil {
		return def
	}
	b, ok := m[k].(bool)
	if !ok {
		return def
	}
	return b
}

func intField(m map[string]any, keys ...string) int {
	return int(int64Field(m, keys...))
}

func int64Field(m map[string]any, keys ...string) int64 {
	if m == nil {
		return 0
	}
	for _, k := range keys {
		switch v := m[k].(type) {
		case float64:
			return int64(v)
		case int64:
			return v
		case int:
			return int64(v)
		case json.Number:
			if n, err := v.Int64(); err == nil {
				return n
			}
		}
	}
	return 0
}

func floatField(m map[string]any, keys ...string) float64 {
	if m == nil {
		return 0
	}
	for _, k := range keys {
		switch v := m[k].(type) {
		case float64:
			return v
		case int64:
			return float64(v)
		case int:
			return float64(v)
		}
	}
	return 0
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func rawFirstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
