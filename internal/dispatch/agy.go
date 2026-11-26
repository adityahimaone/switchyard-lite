package dispatch

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/catalog"
	"github.com/adityahimaone/switchyard-lite/internal/models"
	"github.com/adityahimaone/switchyard-lite/internal/tasks"
	"github.com/adityahimaone/switchyard-lite/internal/worker"
)

// AgyAuthFunc mirrors models.AgyAuthRunner for dependency injection in tests.
type AgyAuthFunc = models.AgyAuthRunner

// AgyExecInput captures one local Antigravity CLI invocation.
type AgyExecInput struct {
	Task      tasks.Task
	Workspace string
	Message   string
	TimeoutS  int
	Args      []string
}

// AgyExecResult summarizes the completed local `agy` invocation.
type AgyExecResult struct {
	Success    bool
	Output     string
	Error      string
	DurationMs int64
	SessionID  string
}

// AgyExecFunc executes an `agy` run and streams text chunks to onChunk.
type AgyExecFunc func(ctx context.Context, in AgyExecInput, onChunk func(chunk string)) (AgyExecResult, error)

func isAgyExecutor(executor string) bool {
	switch strings.ToLower(strings.TrimSpace(executor)) {
	case "agy", "antigravity":
		return true
	default:
		return false
	}
}

// NormalizeAgyEffort translates UI thinking presets into valid `agy --effort` values.
// `agy` supports low|medium|high|xhigh|max; UI "minimal" maps to "low".
func NormalizeAgyEffort(effort string) string {
	switch strings.ToLower(strings.TrimSpace(effort)) {
	case "":
		return ""
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

// BuildAgyArgs constructs CLI flags ensuring headless non-interactive execution
// and unconditional startup auto-approval (`-p --dangerously-skip-permissions --mode auto`).
func BuildAgyArgs(t tasks.Task, workspace, message string, timeoutS int) []string {
	args := []string{
		"-p",
		"--dangerously-skip-permissions",
		"--mode", "auto",
		"--output-format", "stream-json",
	}
	if model := strings.TrimSpace(t.Model); model != "" {
		args = append(args, "--model", model)
	}
	if eff := NormalizeAgyEffort(t.Effort); eff != "" {
		args = append(args, "--effort", eff)
	}
	if sid := strings.TrimSpace(t.SessionID); sid != "" {
		args = append(args, "--conversation", sid)
	}
	if ws := strings.TrimSpace(workspace); ws != "" {
		args = append(args, "--add-dir", ws)
	}
	if timeoutS > 0 {
		args = append(args, "--print-timeout", fmt.Sprintf("%ds", timeoutS))
	}
	prompt := strings.TrimSpace(message)
	if strings.HasPrefix(prompt, "-") {
		prompt = "Task:\n" + prompt
	}
	if prompt != "" {
		args = append(args, prompt)
	}
	return args
}

var agySessionLineRE = regexp.MustCompile(`(?i)"?(?:conversation_id|conversationId|session_id|sessionId)"?\s*[:=]\s*"?([A-Za-z0-9._:-]{6,})"?`)

// ExtractAgySessionID finds a conversation/session identifier in raw CLI output.
func ExtractAgySessionID(raw string) string {
	_, sid := ParseAgyOutput(raw)
	if sid != "" {
		return sid
	}
	if m := agySessionLineRE.FindStringSubmatch(raw); len(m) == 2 {
		return strings.TrimSpace(m[1])
	}
	return ""
}

// ParseAgyOutput converts raw `agy` stream-json / JSON / text output into readable
// transcript text while preserving any ask_question JSON blocks for Grill-Me detection.
func ParseAgyOutput(raw string) (renderedText, sessionID string) {
	var parts []string
	for _, line := range strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n") {
		chunk, sid := parseAgyStreamLine(line)
		if sid != "" && sessionID == "" {
			sessionID = sid
		}
		if chunk != "" {
			parts = append(parts, chunk)
		}
	}
	return strings.TrimSpace(strings.Join(parts, "\n")), sessionID
}

func parseAgyStreamLine(line string) (textChunk, sessionID string) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return "", ""
	}
	if !strings.HasPrefix(trimmed, "{") {
		if m := agySessionLineRE.FindStringSubmatch(trimmed); len(m) == 2 {
			sessionID = m[1]
		}
		return trimmed, sessionID
	}

	var obj map[string]any
	if err := json.Unmarshal([]byte(trimmed), &obj); err != nil {
		return trimmed, ""
	}
	sessionID = findSessionInMap(obj)

	// Preserve ask_question tool payloads verbatim so DetectOpenQuestion extracts options.
	if hasAskQuestionPayload(obj) {
		return trimmed, sessionID
	}

	if txt := extractTextFromMap(obj); txt != "" {
		return txt, sessionID
	}
	return "", sessionID
}

func findSessionInMap(m map[string]any) string {
	if m == nil {
		return ""
	}
	for _, k := range []string{"conversation_id", "conversationId", "session_id", "sessionId"} {
		if s, ok := m[k].(string); ok && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	for _, nestedKey := range []string{"session", "conversation", "metadata", "data", "result"} {
		if sub, ok := m[nestedKey].(map[string]any); ok {
			if sid := findSessionInMap(sub); sid != "" {
				return sid
			}
		}
	}
	return ""
}

func hasAskQuestionPayload(m map[string]any) bool {
	if _, ok := m["questions"]; ok {
		return true
	}
	if _, ok := m["question"]; ok {
		return true
	}
	for _, k := range []string{"tool", "name", "tool_name"} {
		if s, ok := m[k].(string); ok && strings.EqualFold(strings.TrimSpace(s), "ask_question") {
			return true
		}
	}
	for _, k := range []string{"tool_use", "tool_call", "functionCall", "call"} {
		if sub, ok := m[k].(map[string]any); ok && hasAskQuestionPayload(sub) {
			return true
		}
	}
	if tcs, ok := m["tool_calls"].([]any); ok {
		for _, item := range tcs {
			if sub, ok := item.(map[string]any); ok && hasAskQuestionPayload(sub) {
				return true
			}
		}
	}
	return false
}

func extractTextFromMap(m map[string]any) string {
	for _, k := range []string{"delta", "text", "output", "result", "response", "error"} {
		if s, ok := m[k].(string); ok && strings.TrimSpace(s) != "" {
			return s
		}
	}
	if s, ok := m["content"].(string); ok && strings.TrimSpace(s) != "" {
		return s
	}
	if arr, ok := m["content"].([]any); ok {
		if joined := joinTextParts(arr); joined != "" {
			return joined
		}
	}
	if msg, ok := m["message"].(map[string]any); ok {
		if txt := extractTextFromMap(msg); txt != "" {
			return txt
		}
	}
	if parts, ok := m["parts"].([]any); ok {
		if joined := joinTextParts(parts); joined != "" {
			return joined
		}
	}
	if cands, ok := m["candidates"].([]any); ok && len(cands) > 0 {
		if c0, ok := cands[0].(map[string]any); ok {
			if txt := extractTextFromMap(c0); txt != "" {
				return txt
			}
		}
	}
	if res, ok := m["result"].(map[string]any); ok {
		if txt := extractTextFromMap(res); txt != "" {
			return txt
		}
	}
	return ""
}

func joinTextParts(arr []any) string {
	var out []string
	for _, item := range arr {
		sub, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if s, ok := sub["text"].(string); ok && strings.TrimSpace(s) != "" {
			out = append(out, s)
		}
	}
	return strings.Join(out, "")
}

func defaultAgyRunner(ctx context.Context, in AgyExecInput, onChunk func(chunk string)) (AgyExecResult, error) {
	started := time.Now()
	bin, ok := models.ResolveAgyBinary()
	if !ok {
		return AgyExecResult{
			Success:    false,
			Error:      "agy CLI binary not found in PATH or ~/.local/bin/agy",
			DurationMs: time.Since(started).Milliseconds(),
		}, exec.ErrNotFound
	}

	cctx := ctx
	var cancel context.CancelFunc
	if in.TimeoutS > 0 {
		cctx, cancel = context.WithTimeout(ctx, time.Duration(in.TimeoutS)*time.Second)
	} else {
		cctx, cancel = context.WithTimeout(ctx, 20*time.Minute)
	}
	defer cancel()

	cmd := exec.CommandContext(cctx, bin, in.Args...)
	if in.Workspace != "" {
		if st, err := os.Stat(in.Workspace); err == nil && st.IsDir() {
			cmd.Dir = in.Workspace
		}
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return AgyExecResult{Success: false, Error: err.Error()}, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return AgyExecResult{Success: false, Error: err.Error()}, err
	}
	if err := cmd.Start(); err != nil {
		return AgyExecResult{Success: false, Error: err.Error()}, err
	}

	var mu sync.Mutex
	var rawBuf strings.Builder
	var readWG sync.WaitGroup
	scanPipe := func(r io.Reader) {
		defer readWG.Done()
		sc := bufio.NewScanner(r)
		sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
		for sc.Scan() {
			line := sc.Text()
			mu.Lock()
			rawBuf.WriteString(line)
			rawBuf.WriteByte('\n')
			mu.Unlock()
			if onChunk != nil && strings.TrimSpace(line) != "" {
				onChunk(line + "\n")
			}
		}
	}
	readWG.Add(2)
	go scanPipe(stdout)
	go scanPipe(stderr)
	readWG.Wait()

	waitErr := cmd.Wait()
	dur := time.Since(started).Milliseconds()
	raw := rawBuf.String()
	rendered, sid := ParseAgyOutput(raw)
	if rendered == "" {
		rendered = strings.TrimSpace(raw)
	}
	if waitErr != nil {
		errMsg := waitErr.Error()
		if rendered != "" {
			errMsg = fmt.Sprintf("%s: %s", waitErr.Error(), trunc(rendered, 600))
		}
		return AgyExecResult{
			Success:    false,
			Output:     rendered,
			Error:      errMsg,
			DurationMs: dur,
			SessionID:  sid,
		}, waitErr
	}
	return AgyExecResult{
		Success:    true,
		Output:     rendered,
		DurationMs: dur,
		SessionID:  sid,
	}, nil
}

func dispatchLocalMachineKind() string {
	switch runtime.GOOS {
	case "darwin":
		return "mac"
	case "windows":
		return "windows"
	default:
		return "linux"
	}
}

func (d *Dispatcher) taskTargetMachine(workspace string) string {
	ws := strings.TrimSpace(workspace)
	hostKind := dispatchLocalMachineKind()
	if ws == "" {
		return hostKind
	}
	var dbOS, dbHost string
	if d.S != nil && d.S.DB != nil {
		norm := catalog.Normalize(ws)
		rows, err := d.S.DB.Query(`SELECT path, os, host FROM dispatch_workspaces`)
		if err == nil {
			for rows.Next() {
				var p, o, h string
				if rows.Scan(&p, &o, &h) == nil && catalog.Normalize(p) == norm {
					dbOS, dbHost = o, h
					break
				}
			}
			rows.Close()
		}
	}
	st, statErr := os.Stat(ws)
	dirExists := statErr == nil && st.IsDir()
	pathShape := catalog.MachineFromPath(ws)
	m := catalog.MachineFor(ws, dbOS, dbHost, "")
	if dirExists && pathShape != "windows" && (dbOS == "" || strings.EqualFold(dbOS, runtime.GOOS) || m == hostKind) {
		return hostKind
	}
	if m == "current" || m == "" {
		if pathShape == "" && strings.HasPrefix(ws, "/") && !dirExists {
			return "linux"
		}
		return hostKind
	}
	return m
}

func (d *Dispatcher) shouldRunAgyLocally(t tasks.Task) bool {
	if d.AgyRunner != nil {
		return true
	}
	if d.Client == nil || strings.TrimSpace(d.Client.BaseURL) == "" {
		return true
	}
	machine := d.taskTargetMachine(t.Workspace)
	if machine != dispatchLocalMachineKind() {
		return false
	}
	if strings.TrimSpace(t.Workspace) == "" {
		return true
	}
	st, err := os.Stat(strings.TrimSpace(t.Workspace))
	return err == nil && st.IsDir()
}

func (d *Dispatcher) activeAgyAccountForMachine(machine string) string {
	if d.S == nil || d.S.DB == nil {
		return ""
	}
	var acct string
	if m := strings.ToLower(strings.TrimSpace(machine)); m != "" {
		_ = d.S.DB.QueryRow(`SELECT value FROM dispatch_settings WHERE key=?`, "agy.active_account."+m).Scan(&acct)
		if strings.TrimSpace(acct) != "" {
			return strings.TrimSpace(acct)
		}
	}
	_ = d.S.DB.QueryRow(`SELECT value FROM dispatch_settings WHERE key='agy.active_account'`).Scan(&acct)
	return strings.TrimSpace(acct)
}

func (d *Dispatcher) switchRemoteAgyAccountIfNeeded(ctx context.Context, t tasks.Task, machine, runID string) string {
	activeAccount := d.activeAgyAccountForMachine(machine)
	if activeAccount == "" {
		return ""
	}
	var runner models.AgyAuthRunner
	if d.AgyAuthRunner != nil {
		runner = d.AgyAuthRunner
	} else if d.Remote != nil && d.Remote.Enabled() {
		runner = models.RemoteAgyAuthRunner(d.Remote.Shell, t.Workspace, machine == "windows")
	}
	if runner == nil {
		return activeAccount
	}
	if err := models.SwitchAgyAccount(ctx, activeAccount, runner); err != nil {
		_ = d.Tasks.RecordEvent(t.ID, "agy_account_switch_warning", map[string]any{
			"run_id":  runID,
			"account": activeAccount,
			"machine": machine,
			"error":   err.Error(),
		})
	} else {
		_ = d.Tasks.RecordEvent(t.ID, "agy_account_switched", map[string]any{
			"run_id":  runID,
			"account": activeAccount,
			"machine": machine,
		})
	}
	return activeAccount
}

func isUnsupportedExecutorErr(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "unsupported executor") ||
		strings.Contains(s, "unknown executor") ||
		strings.Contains(s, "invalid executor") ||
		strings.Contains(s, "executor unavailable") ||
		strings.Contains(s, "executor_unavailable")
}

func stripShellProvenance(raw string) string {
	kept := make([]string, 0, 16)
	for _, line := range strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n") {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "provenance ") || strings.HasPrefix(trim, "EXECUTOR_PROOF=") {
			continue
		}
		kept = append(kept, line)
	}
	return strings.TrimSpace(strings.Join(kept, "\n"))
}

func (d *Dispatcher) executeRemoteShellAgy(ctx context.Context, t tasks.Task, boardName, message, workspace, runID string) {
	if (d.Remote == nil || !d.Remote.Enabled()) && (d.Client == nil || strings.TrimSpace(d.Client.BaseURL) == "") {
		d.failRun(t, runID, "remote shell unavailable for agy", nil, false)
		return
	}
	machine := d.taskTargetMachine(t.Workspace)
	isWindows := machine == "windows"
	runner := func(rctx context.Context, in AgyExecInput, onChunk func(chunk string)) (AgyExecResult, error) {
		started := time.Now()
		quoted := make([]string, len(in.Args))
		for i, a := range in.Args {
			quoted[i] = worker.Quote(a, isWindows)
		}
		var cmd string
		if isWindows {
			cmd = "agy " + strings.Join(quoted, " ")
		} else {
			findBin := `AGY=""; for c in "$HOME/.local/bin/agy" "$(command -v agy 2>/dev/null)" /opt/homebrew/bin/agy /usr/local/bin/agy "$HOME"/.nvm/versions/node/*/bin/agy; do [ -x "$c" ] && AGY="$c" && break; done; [ -n "$AGY" ] || { echo "agy binary not found" >&2; exit 127; }; `
			cmd = findBin + `PATH="$(dirname "$AGY"):$PATH" "$AGY" ` + strings.Join(quoted, " ")
		}

		// Prefer streaming shell dispatch through d.Client when available so long-running
		// remote agy tasks get full TimeoutS, incremental logs, and lease renewal without
		// needing native agy support in node-agent.
		if d.Client != nil && strings.TrimSpace(d.Client.BaseURL) != "" {
			timeoutS := in.TimeoutS
			if timeoutS <= 0 {
				timeoutS = 1200
			}
			tctx, cancel := context.WithTimeout(rctx, time.Duration(timeoutS)*time.Second)
			defer cancel()

			req := Request{
				TaskID:        t.ID,
				Title:         t.Title,
				Board:         firstNonEmpty(boardName, "switchyard-lite"),
				Message:       "agy remote shell execution",
				Workspace:     workspace,
				Executor:      "shell",
				Command:       cmd,
				ExecutionMode: "direct",
				NoRTK:         true,
				RunID:         runID,
				TimeoutS:      timeoutS,
			}
			if _, err := d.Client.DispatchWithAck(tctx, req); err != nil {
				return AgyExecResult{
					Success:    false,
					Error:      err.Error(),
					DurationMs: time.Since(started).Milliseconds(),
				}, err
			}
			d.clearCapacityBackoff(t.ID)

			var logOffset int64
			flushProgress := func() {
				chunk, nextOff, perr := d.Client.FetchProgress(tctx, t.ID, logOffset)
				if perr != nil {
					return
				}
				if chunk != "" && onChunk != nil {
					onChunk(chunk)
				}
				logOffset = nextOff
			}

			pollInterval := d.Cfg.Poll
			if pollInterval <= 0 {
				pollInterval = 2 * time.Second
			}
			for {
				if !d.renew(t.ID, runID) {
					return AgyExecResult{
						Success:    false,
						Error:      "dispatch lease lost",
						DurationMs: time.Since(started).Milliseconds(),
					}, errors.New("dispatch lease lost")
				}
				flushProgress()
				res, err := d.Client.FetchResult(tctx, t.ID)
				if err == nil {
					flushProgress()
					cleanOut := stripShellProvenance(res.Output)
					rendered, sid := ParseAgyOutput(cleanOut)
					if rendered == "" {
						rendered = cleanOut
					}
					if sid == "" {
						sid = firstNonEmpty(res.AgySessionID, res.SessionID)
					}
					dur := res.DurationMs
					if dur <= 0 {
						dur = time.Since(started).Milliseconds()
					}
					if !res.Success {
						errMsg := strings.TrimSpace(res.Error)
						if errMsg == "" {
							errMsg = rendered
						}
						return AgyExecResult{
							Success:    false,
							Output:     rendered,
							Error:      errMsg,
							DurationMs: dur,
							SessionID:  sid,
						}, errors.New(firstNonEmpty(errMsg, "remote shell agy failed"))
					}
					return AgyExecResult{
						Success:    true,
						Output:     rendered,
						DurationMs: dur,
						SessionID:  sid,
					}, nil
				}
				if !errors.Is(err, ErrPending) {
					// Transient result fetch errors are retried until timeout/cancel.
				}
				select {
				case <-tctx.Done():
					return AgyExecResult{
						Success:    false,
						Error:      tctx.Err().Error(),
						DurationMs: time.Since(started).Milliseconds(),
					}, tctx.Err()
				case <-time.After(pollInterval):
				}
			}
		}

		out, err := d.Remote.Shell(rctx, workspace, cmd)
		dur := time.Since(started).Milliseconds()
		if out != "" && onChunk != nil {
			onChunk(out)
		}
		rendered, sid := ParseAgyOutput(out)
		if rendered == "" {
			rendered = strings.TrimSpace(out)
		}
		if err != nil {
			return AgyExecResult{
				Success:    false,
				Output:     rendered,
				Error:      err.Error(),
				DurationMs: dur,
				SessionID:  sid,
			}, err
		}
		return AgyExecResult{
			Success:    true,
			Output:     rendered,
			DurationMs: dur,
			SessionID:  sid,
		}, nil
	}
	d.executeAgyWithRunner(ctx, t, boardName, message, workspace, runID, machine, runner)
}

func (d *Dispatcher) executeLocalAgy(ctx context.Context, t tasks.Task, boardName, message, workspace, runID string) {
	runner := d.AgyRunner
	if runner == nil {
		runner = defaultAgyRunner
	}
	machine := d.taskTargetMachine(t.Workspace)
	d.executeAgyWithRunner(ctx, t, boardName, message, workspace, runID, machine, runner)
}

func (d *Dispatcher) executeAgyWithRunner(ctx context.Context, t tasks.Task, boardName, message, workspace, runID, machine string, runner AgyExecFunc) {
	activeAccount := d.activeAgyAccountForMachine(machine)
	if activeAccount != "" {
		authRunner := d.AgyAuthRunner
		if authRunner == nil && machine != dispatchLocalMachineKind() && d.Remote != nil && d.Remote.Enabled() {
			authRunner = models.RemoteAgyAuthRunner(d.Remote.Shell, workspace, machine == "windows")
		}
		if err := models.SwitchAgyAccount(ctx, activeAccount, authRunner); err != nil {
			_ = d.Tasks.RecordEvent(t.ID, "agy_account_switch_warning", map[string]any{
				"run_id":  runID,
				"account": activeAccount,
				"machine": machine,
				"error":   err.Error(),
			})
		} else {
			_ = d.Tasks.RecordEvent(t.ID, "agy_account_switched", map[string]any{
				"run_id":  runID,
				"account": activeAccount,
				"machine": machine,
			})
		}
	}

	args := BuildAgyArgs(t, workspace, message, d.Cfg.TimeoutS)
	_ = d.Tasks.RecordEvent(t.ID, "remote_dispatched", map[string]any{
		"run_id":       runID,
		"worker_id":    d.Cfg.WorkerID,
		"executor":     "agy",
		"model":        t.Model,
		"effort":       NormalizeAgyEffort(t.Effort),
		"auto_approve": true,
		"account":      activeAccount,
		"machine":      machine,
		"session_id":   t.SessionID,
		"workspace":    workspace,
		"board":        boardName,
	})

	var mu sync.Mutex
	var streamedBuf strings.Builder
	streamed := false
	streamAsked := false
	discoveredSession := t.SessionID

	onChunk := func(chunk string) {
		if strings.TrimSpace(chunk) == "" {
			return
		}
		rendered, sid := ParseAgyOutput(chunk)
		displayChunk := chunk
		if rendered != "" && !strings.HasPrefix(strings.TrimSpace(chunk), "{") {
			displayChunk = chunk
		} else if rendered != "" {
			displayChunk = rendered + "\n"
		}

		mu.Lock()
		streamed = true
		streamedBuf.WriteString(displayChunk)
		accum := streamedBuf.String()
		if sid != "" && discoveredSession == "" {
			discoveredSession = sid
			d.persistTaskSession(t.ID, sid, "", nil)
		}
		alreadyAsked := streamAsked
		mu.Unlock()

		_ = AppendWorkerLog(d.WorkerLogDir(), t.ID, displayChunk)
		_ = d.Tasks.RecordEvent(t.ID, "worker_output", map[string]any{
			"run_id": runID,
			"output": displayChunk,
		})

		if !alreadyAsked {
			if q, opts, ctxText, ok := DetectOpenQuestion(accum); ok {
				mu.Lock()
				if !streamAsked {
					streamAsked = true
					mu.Unlock()
					d.recordDetectedQuestion(t, q, opts, ctxText)
				} else {
					mu.Unlock()
				}
			}
		}
	}

	in := AgyExecInput{
		Task:      t,
		Workspace: workspace,
		Message:   message,
		TimeoutS:  d.Cfg.TimeoutS,
		Args:      args,
	}
	execRes, runErr := runner(ctx, in, onChunk)

	renderedOut, sid := ParseAgyOutput(execRes.Output)
	finalOut := execRes.Output
	if renderedOut != "" {
		finalOut = renderedOut
	}
	if strings.TrimSpace(finalOut) == "" && streamedBuf.Len() > 0 {
		finalOut = strings.TrimSpace(streamedBuf.String())
	}
	finalSID := firstNonEmpty(execRes.SessionID, sid, discoveredSession)
	errMsg := execRes.Error
	if errMsg == "" && runErr != nil {
		errMsg = runErr.Error()
	}

	res := &Result{
		TaskID:       t.ID,
		Success:      execRes.Success && runErr == nil,
		Output:       finalOut,
		Error:        errMsg,
		DurationMs:   execRes.DurationMs,
		SessionID:    finalSID,
		AgySessionID: finalSID,
		Executor:     "agy",
		Model:        t.Model,
	}
	if res.Success {
		d.finishWithStream(t, runID, res, streamed)
		return
	}
	if isCapacityError(runErr, errMsg) {
		d.requeueCapacity(t, runID, errMsg)
		return
	}
	d.failRun(t, runID, errMsg, res, streamed)
}
