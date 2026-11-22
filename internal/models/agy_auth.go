package models

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"time"
)

// AgyAccount represents a single account managed by `agy-auth`.
type AgyAccount struct {
	ID          string   `json:"id"`
	Email       string   `json:"email"`
	Name        string   `json:"name"`
	Alias       string   `json:"alias,omitempty"`
	Plan        string   `json:"plan,omitempty"`
	Quota5H     string   `json:"quota_5h,omitempty"`
	QuotaWeekly string   `json:"quota_weekly,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	Active      bool     `json:"active"`
}

// AgyAuthRunner runs `agy-auth` with the given arguments and returns combined output.
type AgyAuthRunner func(ctx context.Context, args ...string) ([]byte, error)

// AgyRegistryFileCandidates returns candidate registry.json paths for the OS.
func AgyRegistryFileCandidates(homeDir, goos string) []string {
	if homeDir == "" {
		return nil
	}
	switch goos {
	case "darwin":
		return []string{
			filepath.Join(homeDir, "Library", "Application Support", "agy-auth", "registry.json"),
			filepath.Join(homeDir, ".config", "agy-auth", "registry.json"),
			filepath.Join(homeDir, ".agy_auth", "accounts.json"),
		}
	case "windows":
		appData := os.Getenv("APPDATA")
		if appData == "" {
			appData = filepath.Join(homeDir, "AppData", "Roaming")
		}
		return []string{
			filepath.Join(appData, "agy-auth", "registry.json"),
			filepath.Join(homeDir, ".agy_auth", "accounts.json"),
		}
	default:
		return []string{
			filepath.Join(homeDir, ".config", "agy-auth", "registry.json"),
			filepath.Join(homeDir, ".local", "share", "agy-auth", "registry.json"),
			filepath.Join(homeDir, ".agy_auth", "accounts.json"),
		}
	}
}

func isFikrilalAgyAuth(binPath string) bool {
	if resolved, err := filepath.EvalSymlinks(binPath); err == nil {
		if strings.Contains(strings.ToLower(resolved), "fikrilal") {
			return true
		}
	}
	return strings.Contains(strings.ToLower(binPath), "fikrilal")
}

// ResolveAgyAuthBinary locates the `agy-auth` binary, preferring `@fikrilal/agy-auth`
// (which manages the multi-account v2 registry) over legacy `ccvibe/agy-auth` when both exist.
func ResolveAgyAuthBinary() (string, bool) {
	home, _ := os.UserHomeDir()
	var candidates []string

	if home != "" {
		if nvmBins, err := filepath.Glob(filepath.Join(home, ".nvm", "versions", "node", "*", "bin", "agy-auth")); err == nil {
			sort.Sort(sort.Reverse(sort.StringSlice(nvmBins)))
			candidates = append(candidates, nvmBins...)
		}
		candidates = append(candidates,
			filepath.Join(home, ".bun", "bin", "agy-auth"),
			filepath.Join(home, ".local", "bin", "agy-auth"),
			filepath.Join(home, ".cargo", "bin", "agy-auth"),
		)
	}
	if p, err := exec.LookPath("agy-auth"); err == nil {
		candidates = append(candidates, p)
	}
	candidates = append(candidates,
		"/opt/homebrew/bin/agy-auth",
		"/usr/local/bin/agy-auth",
	)

	seen := map[string]bool{}
	var valid []string
	for _, c := range candidates {
		c = strings.TrimSpace(c)
		if c == "" || seen[c] {
			continue
		}
		seen[c] = true
		if info, err := os.Stat(c); err == nil && !info.IsDir() {
			valid = append(valid, c)
		}
	}
	if len(valid) == 0 {
		return "", false
	}
	for _, c := range valid {
		if isFikrilalAgyAuth(c) {
			return c, true
		}
	}
	return valid[0], true
}

func defaultAgyAuthRunner(ctx context.Context, args ...string) ([]byte, error) {
	bin, ok := ResolveAgyAuthBinary()
	if !ok {
		return nil, exec.ErrNotFound
	}
	cctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	// Ensure node is on PATH when running node-backed wrappers from minimal launchd/systemd envs.
	cmd := exec.CommandContext(cctx, bin, args...)
	binDir := filepath.Dir(bin)
	if curPath := os.Getenv("PATH"); curPath != "" {
		cmd.Env = append(os.Environ(), "PATH="+binDir+string(os.PathListSeparator)+curPath)
	} else {
		cmd.Env = append(os.Environ(), "PATH="+binDir)
	}
	return cmd.CombinedOutput()
}

// ParseAgyAuthRegistryJSON parses `@fikrilal/agy-auth` registry.json (or `--json` output)
// and legacy `~/.agy_auth/accounts.json`. Returns (accounts, activeIdentifier, ok).
func ParseAgyAuthRegistryJSON(raw string) ([]AgyAccount, string, bool) {
	trim := strings.TrimSpace(raw)
	if !strings.HasPrefix(trim, "{") && !strings.HasPrefix(trim, "[") {
		return nil, "", false
	}

	// Unwrap {"schema_version":..., "data":{...}} if present.
	var outer struct {
		Version          int             `json:"version"`
		Active           string          `json:"active"`
		CurrentAccountID string          `json:"current_account_id"`
		Data             json.RawMessage `json:"data"`
		Accounts         json.RawMessage `json:"accounts"`
	}
	if err := json.Unmarshal([]byte(trim), &outer); err == nil && len(outer.Data) > 0 && len(outer.Accounts) == 0 {
		var inner struct {
			Active           string          `json:"active"`
			CurrentAccountID string          `json:"current_account_id"`
			Accounts         json.RawMessage `json:"accounts"`
		}
		if json.Unmarshal(outer.Data, &inner) == nil && len(inner.Accounts) > 0 {
			outer.Active = firstStr(inner.Active, outer.Active)
			outer.CurrentAccountID = firstStr(inner.CurrentAccountID, outer.CurrentAccountID)
			outer.Accounts = inner.Accounts
		}
	}

	if len(outer.Accounts) == 0 {
		return nil, "", false
	}

	type regAccount struct {
		ID          string   `json:"id"`
		Email       string   `json:"email"`
		Name        string   `json:"name"`
		Alias       string   `json:"alias"`
		Plan        string   `json:"plan"`
		Quota5H     string   `json:"quota_5h"`
		QuotaWeekly string   `json:"quota_weekly"`
		Tags        []string `json:"tags"`
		Active      bool     `json:"active"`
	}
	var items []regAccount
	if err := json.Unmarshal(outer.Accounts, &items); err != nil {
		return nil, "", false
	}

	activeID := firstStr(outer.Active, outer.CurrentAccountID)
	accounts := make([]AgyAccount, 0, len(items))
	activeVal := ""
	for _, it := range items {
		isActive := it.Active || (activeID != "" && (strings.EqualFold(it.ID, activeID) || strings.EqualFold(it.Email, activeID) || strings.EqualFold(it.Alias, activeID)))
		displayName := firstStr(it.Alias, it.Name)
		if displayName == "" {
			displayName = it.Email
		}
		accounts = append(accounts, AgyAccount{
			ID:          strings.TrimSpace(it.ID),
			Email:       strings.TrimSpace(it.Email),
			Name:        strings.TrimSpace(displayName),
			Alias:       strings.TrimSpace(it.Alias),
			Plan:        strings.TrimSpace(it.Plan),
			Quota5H:     strings.TrimSpace(it.Quota5H),
			QuotaWeekly: strings.TrimSpace(it.QuotaWeekly),
			Tags:        it.Tags,
			Active:      isActive,
		})
		if isActive && activeVal == "" {
			activeVal = firstStr(strings.TrimSpace(it.Email), firstStr(strings.TrimSpace(it.Alias), strings.TrimSpace(it.ID)))
		}
	}
	return accounts, activeVal, true
}

func firstStr(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return strings.TrimSpace(a)
	}
	return strings.TrimSpace(b)
}

var fikrilalRowRE = regexp.MustCompile(`^(?:\d+|-)\s+(\*)?\s*(.+?)\s{2,}(.+)$`)

// ParseAgyAuthList parses `agy-auth list` output from either `@fikrilal/agy-auth`
// or legacy `ccvibe/agy-auth`, as well as JSON payloads.
func ParseAgyAuthList(raw string) []AgyAccount {
	if accounts, _, ok := ParseAgyAuthRegistryJSON(raw); ok {
		return accounts
	}

	clean := ansiEscapeRE.ReplaceAllString(raw, "")
	clean = strings.ReplaceAll(clean, "\r\n", "\n")
	lines := strings.Split(clean, "\n")

	// Try pipe-table format first if '|' or '│' lines are present.
	if pipe := parsePipeAgyAuthTable(lines); len(pipe) > 0 {
		return pipe
	}
	// Otherwise try `@fikrilal/agy-auth` space-aligned list format.
	return parseFikrilalAgyAuthTable(lines)
}

func parsePipeAgyAuthTable(lines []string) []AgyAccount {
	var accounts []AgyAccount
	idxActive, idxID, idxEmail, idxName, idxTags := 0, 1, 2, 3, 4
	seenHeader := false

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		normalized := strings.ReplaceAll(line, "│", "|")
		if !strings.Contains(normalized, "|") {
			continue
		}
		parts := strings.Split(normalized, "|")
		if len(parts) > 0 && strings.TrimSpace(parts[0]) == "" {
			parts = parts[1:]
		}
		if len(parts) > 0 && strings.TrimSpace(parts[len(parts)-1]) == "" {
			parts = parts[:len(parts)-1]
		}
		if len(parts) < 3 {
			continue
		}
		cells := make([]string, len(parts))
		for i, p := range parts {
			cells[i] = strings.TrimSpace(p)
		}
		if !seenHeader && isAgyAuthHeaderRow(cells) {
			seenHeader = true
			for i, c := range cells {
				switch strings.ToLower(c) {
				case "active":
					idxActive = i
				case "id":
					idxID = i
				case "email":
					idxEmail = i
				case "name":
					idxName = i
				case "tags":
					idxTags = i
				}
			}
			continue
		}

		activeCell := cellAt(cells, idxActive)
		idCell := cellAt(cells, idxID)
		emailCell := cellAt(cells, idxEmail)
		nameCell := cellAt(cells, idxName)
		tagsCell := cellAt(cells, idxTags)

		if idCell == "" && emailCell == "" {
			continue
		}
		if strings.Trim(idCell, "-─=+") == "" {
			continue
		}

		var tags []string
		if tagsCell != "" && tagsCell != "-" {
			for _, t := range strings.Split(tagsCell, ",") {
				t = strings.TrimSpace(t)
				if t != "" {
					tags = append(tags, t)
				}
			}
		}

		accounts = append(accounts, AgyAccount{
			ID:     idCell,
			Email:  emailCell,
			Name:   nameCell,
			Tags:   tags,
			Active: isActiveMarker(activeCell),
		})
	}
	return accounts
}

func parseFikrilalAgyAuthTable(lines []string) []AgyAccount {
	var accounts []AgyAccount
	for _, line := range lines {
		trim := strings.TrimSpace(line)
		if trim == "" || strings.HasPrefix(trim, "-") || strings.HasPrefix(trim, "#") ||
			strings.HasPrefix(strings.ToLower(trim), "warning:") ||
			strings.HasPrefix(strings.ToLower(trim), "tip:") ||
			strings.HasPrefix(strings.ToLower(trim), "the live agy account") {
			continue
		}
		m := fikrilalRowRE.FindStringSubmatch(trim)
		if len(m) != 4 {
			continue
		}
		active := m[1] == "*"
		acctExpr := strings.TrimSpace(m[2])
		if strings.HasPrefix(acctExpr, "(unknown)") {
			continue
		}
		restFields := strings.Fields(strings.TrimSpace(m[3]))
		plan := ""
		q5h := ""
		qWeekly := ""
		if len(restFields) > 0 && restFields[0] != "-" {
			plan = restFields[0]
		}
		if len(restFields) > 1 && restFields[1] != "-" {
			q5h = restFields[1]
		}
		if len(restFields) > 2 && restFields[2] != "-" {
			qWeekly = restFields[2]
		}

		alias := acctExpr
		emailHint := ""
		if idx := strings.Index(acctExpr, "("); idx > 0 {
			alias = strings.TrimSpace(acctExpr[:idx])
			emailHint = strings.TrimSuffix(strings.TrimSpace(acctExpr[idx+1:]), ")")
		}
		accounts = append(accounts, AgyAccount{
			ID:          alias,
			Email:       emailHint,
			Name:        alias,
			Alias:       alias,
			Plan:        plan,
			Quota5H:     q5h,
			QuotaWeekly: qWeekly,
			Active:      active,
		})
	}
	return accounts
}

func isAgyAuthHeaderRow(cells []string) bool {
	hasID := false
	hasEmail := false
	for _, c := range cells {
		switch strings.ToLower(strings.TrimSpace(c)) {
		case "id":
			hasID = true
		case "email":
			hasEmail = true
		}
	}
	return hasID && hasEmail
}

func cellAt(cells []string, idx int) string {
	if idx < 0 || idx >= len(cells) {
		return ""
	}
	return cells[idx]
}

func isActiveMarker(s string) bool {
	v := strings.ToLower(strings.TrimSpace(s))
	switch v {
	case "", "-", "no", "false", "0":
		return false
	default:
		return true
	}
}

// ParseAgyAuthCurrent extracts an active account identifier (email or ID) from `agy-auth current` output.
func ParseAgyAuthCurrent(raw string) string {
	clean := ansiEscapeRE.ReplaceAllString(raw, "")
	lower := strings.ToLower(clean)
	if strings.Contains(lower, "no active agy account") || strings.TrimSpace(clean) == "" {
		return ""
	}
	for _, line := range strings.Split(clean, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		for _, field := range strings.Fields(line) {
			f := strings.Trim(field, ",;()[]<>\"'")
			if strings.Contains(f, "@") {
				return f
			}
		}
		if strings.HasPrefix(strings.ToLower(line), "id:") {
			return strings.TrimSpace(line[3:])
		}
		if strings.HasPrefix(strings.ToLower(line), "email:") {
			return strings.TrimSpace(line[6:])
		}
	}
	return ""
}

func readLocalAgyRegistry() ([]AgyAccount, string, bool) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return nil, "", false
	}
	for _, path := range AgyRegistryFileCandidates(home, runtime.GOOS) {
		b, err := os.ReadFile(path)
		if err != nil || len(b) == 0 {
			continue
		}
		if accounts, active, ok := ParseAgyAuthRegistryJSON(string(b)); ok && len(accounts) > 0 {
			return accounts, active, true
		}
	}
	return nil, "", false
}

// ListAgyAccounts returns all known accounts and the active identifier (email, alias, or ID).
func ListAgyAccounts(ctx context.Context, runner AgyAuthRunner) ([]AgyAccount, string, error) {
	if runner == nil {
		if accounts, active, ok := readLocalAgyRegistry(); ok {
			return accounts, active, nil
		}
		runner = defaultAgyAuthRunner
	}

	listOut, err := runner(ctx, "list")
	if err != nil {
		return nil, "", fmt.Errorf("agy-auth list: %w (%s)", err, strings.TrimSpace(string(listOut)))
	}
	if accounts, active, ok := ParseAgyAuthRegistryJSON(string(listOut)); ok {
		return accounts, active, nil
	}
	accounts := ParseAgyAuthList(string(listOut))
	active := ""
	for _, acc := range accounts {
		if acc.Active {
			active = firstStr(acc.Email, firstStr(acc.Alias, acc.ID))
			break
		}
	}
	if active == "" {
		if curOut, curErr := runner(ctx, "current"); curErr == nil {
			cur := ParseAgyAuthCurrent(string(curOut))
			if cur != "" {
				active = cur
				for i := range accounts {
					if strings.EqualFold(accounts[i].Email, cur) ||
						strings.EqualFold(accounts[i].ID, cur) ||
						strings.EqualFold(accounts[i].Alias, cur) {
						accounts[i].Active = true
					}
				}
			}
		}
	}
	return accounts, active, nil
}

// SwitchAgyAccount switches the active account via `agy-auth switch <target>`.
func SwitchAgyAccount(ctx context.Context, target string, runner AgyAuthRunner) error {
	target = strings.TrimSpace(target)
	if target == "" {
		return fmt.Errorf("account target is required")
	}
	if runner == nil {
		runner = defaultAgyAuthRunner
	}
	out, err := runner(ctx, "switch", target)
	if err != nil {
		return fmt.Errorf("agy-auth switch %q: %w (%s)", target, err, strings.TrimSpace(string(out)))
	}
	return nil
}

// RemoteAgyAuthRunner executes agy-auth list/switch on a remote worker node via its workspace shell.
func RemoteAgyAuthRunner(shellFn func(ctx context.Context, workspace, command string) (string, error), workspace string, isWindows bool) AgyAuthRunner {
	return func(ctx context.Context, args ...string) ([]byte, error) {
		if shellFn == nil {
			return nil, fmt.Errorf("remote shell unavailable")
		}
		if len(args) == 0 {
			return nil, fmt.Errorf("agy-auth args required")
		}
		sub := strings.ToLower(args[0])
		if isWindows {
			switch sub {
			case "list":
				cmd := `powershell -NoProfile -Command "$p = Join-Path $env:APPDATA 'agy-auth\registry.json'; if (Test-Path $p) { Get-Content -Raw $p } else { agy-auth list }"`
				out, err := shellFn(ctx, workspace, cmd)
				return []byte(out), err
			case "switch":
				if len(args) < 2 {
					return nil, fmt.Errorf("switch target required")
				}
				safe := strings.ReplaceAll(args[1], `"`, `""`)
				out, err := shellFn(ctx, workspace, `agy-auth switch "`+safe+`"`)
				return []byte(out), err
			default:
				out, err := shellFn(ctx, workspace, "agy-auth "+strings.Join(args, " "))
				return []byte(out), err
			}
		}

		// POSIX (Mac or Linux/VPS): locate node nvm/bun/homebrew/local agy-auth + check registry.json first.
		findBin := `AGY_AUTH=""; for c in "$HOME"/.nvm/versions/node/*/bin/agy-auth "$HOME/.bun/bin/agy-auth" "$HOME/.local/bin/agy-auth" "$(command -v agy-auth 2>/dev/null)" /opt/homebrew/bin/agy-auth /usr/local/bin/agy-auth; do [ -x "$c" ] && AGY_AUTH="$c" && break; done`
		switch sub {
		case "list":
			cmd := `for r in "$HOME/Library/Application Support/agy-auth/registry.json" "$HOME/.config/agy-auth/registry.json" "$HOME/.local/share/agy-auth/registry.json"; do if [ -f "$r" ]; then cat "$r"; exit 0; fi; done; ` +
				findBin + `; [ -n "$AGY_AUTH" ] || { echo "agy-auth not found" >&2; exit 127; }; PATH="$(dirname "$AGY_AUTH"):$PATH" "$AGY_AUTH" list --no-color`
			out, err := shellFn(ctx, workspace, cmd)
			return []byte(out), err
		case "switch":
			if len(args) < 2 {
				return nil, fmt.Errorf("switch target required")
			}
			qTarget := "'" + strings.ReplaceAll(args[1], "'", `'\''`) + "'"
			cmd := findBin + `; [ -n "$AGY_AUTH" ] || { echo "agy-auth not found" >&2; exit 127; }; PATH="$(dirname "$AGY_AUTH"):$PATH" "$AGY_AUTH" switch ` + qTarget
			out, err := shellFn(ctx, workspace, cmd)
			return []byte(out), err
		default:
			quoted := make([]string, len(args))
			for i, a := range args {
				quoted[i] = "'" + strings.ReplaceAll(a, "'", `'\''`) + "'"
			}
			cmd := findBin + `; [ -n "$AGY_AUTH" ] || { echo "agy-auth not found" >&2; exit 127; }; PATH="$(dirname "$AGY_AUTH"):$PATH" "$AGY_AUTH" ` + strings.Join(quoted, " ")
			out, err := shellFn(ctx, workspace, cmd)
			return []byte(out), err
		}
	}
}
