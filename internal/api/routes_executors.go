package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/catalog"
	"github.com/adityahimaone/switchyard-lite/internal/models"
	"github.com/adityahimaone/switchyard-lite/internal/nodes"
	"github.com/adityahimaone/switchyard-lite/internal/store"
	"github.com/adityahimaone/switchyard-lite/internal/worker"
)

const (
	executorsConfigSettingKey = "executors.config"
	agyActiveAccountKey       = "agy.active_account"
	executorProbeTTL          = 60 * time.Second
)

var defaultExecutorOrder = []string{"agy", "dsh", "commandcode", "claude", "codex", "omp"}
var defaultHiddenExecutors = []string{"claude", "codex", "omp"}

// ExecutorsConfig holds the user-defined executor dropdown order and hidden IDs.
type ExecutorsConfig struct {
	Order  []string `json:"order"`
	Hidden []string `json:"hidden"`
	All    []string `json:"all,omitempty"`
}

// RemoteShellFunc abstracts worker.Client.Shell for testing workspace-routed operations.
type RemoteShellFunc func(ctx context.Context, workspace, command string) (string, error)

type executorProbeCacheEntry struct {
	at   time.Time
	resp ExecutorProbeResponse
}

// ExecutorProbeResponse reports workspace machine identity and executor availability.
type ExecutorProbeResponse struct {
	Workspace          string          `json:"workspace"`
	Machine            string          `json:"machine"`
	MachineLabel       string          `json:"machine_label"`
	IsLocal            bool            `json:"is_local"`
	Probed             bool            `json:"probed"`
	NodeID             string          `json:"node_id,omitempty"`
	Hostname           string          `json:"hostname,omitempty"`
	Installed          map[string]bool `json:"installed"`
	AvailableExecutors []string        `json:"available_executors"`
	Error              string          `json:"error,omitempty"`
}

var (
	agyAuthMu           sync.RWMutex
	agyAuthOverride     models.AgyAuthRunner
	remoteShellOverride RemoteShellFunc

	probeCacheMu sync.Mutex
	probeCache   = map[string]executorProbeCacheEntry{}
)

func setAgyAuthOverride(fn models.AgyAuthRunner) func() {
	agyAuthMu.Lock()
	prev := agyAuthOverride
	agyAuthOverride = fn
	agyAuthMu.Unlock()
	return func() {
		agyAuthMu.Lock()
		agyAuthOverride = prev
		agyAuthMu.Unlock()
	}
}

func setRemoteShellOverride(fn RemoteShellFunc) func() {
	agyAuthMu.Lock()
	prev := remoteShellOverride
	remoteShellOverride = fn
	agyAuthMu.Unlock()
	return func() {
		agyAuthMu.Lock()
		remoteShellOverride = prev
		agyAuthMu.Unlock()
	}
}

func currentAgyAuthRunner() models.AgyAuthRunner {
	agyAuthMu.RLock()
	fn := agyAuthOverride
	agyAuthMu.RUnlock()
	return fn
}

func currentRemoteShell(w *worker.Client) RemoteShellFunc {
	agyAuthMu.RLock()
	ov := remoteShellOverride
	agyAuthMu.RUnlock()
	if ov != nil {
		return ov
	}
	if w != nil && w.Enabled() {
		return w.Shell
	}
	return nil
}

func localMachineKind() string {
	switch runtime.GOOS {
	case "darwin":
		return "mac"
	case "windows":
		return "windows"
	default:
		return "linux"
	}
}

func machineDisplayLabel(machine string) string {
	switch machine {
	case "mac":
		return "macOS"
	case "windows":
		return "Windows"
	case "linux":
		return "VPS (Linux)"
	default:
		return "Current host"
	}
}

type workspaceTarget struct {
	Workspace     string
	Machine       string
	MachineLabel  string
	IsLocal       bool
	NodeID        string
	Hostname      string
	NodeExecutors []string
	NodeFresh     bool
}

func resolveWorkspaceTarget(ctx context.Context, a *API, x *dispatchDeps, rawWorkspace string) workspaceTarget {
	ws := strings.TrimSpace(rawWorkspace)
	hostKind := localMachineKind()
	if ws == "" {
		return workspaceTarget{
			Workspace:    "",
			Machine:      hostKind,
			MachineLabel: machineDisplayLabel(hostKind),
			IsLocal:      true,
		}
	}

	var dbOS, dbHost string
	if a != nil && a.S != nil && a.S.DB != nil {
		normWant := catalog.Normalize(ws)
		rows, err := a.S.DB.Query(`SELECT path, os, host FROM dispatch_workspaces`)
		if err == nil {
			for rows.Next() {
				var p, o, h string
				if rows.Scan(&p, &o, &h) == nil && catalog.Normalize(p) == normWant {
					dbOS, dbHost = o, h
					break
				}
			}
			rows.Close()
		}
	}

	var live []catalog.Workspace
	if x != nil && x.c != nil {
		live, _ = x.c.List(ctx, false)
	}
	if rec, ok := catalog.Match(live, ws); ok {
		if rec.OS != "" {
			dbOS = rec.OS
		}
		if rec.Host != "" && dbHost == "" {
			dbHost = rec.Host
		}
	}

	// Check local directory existence first so temp/local dirs resolve cleanly on the host OS.
	st, statErr := os.Stat(ws)
	dirExists := statErr == nil && st.IsDir()

	pathShape := catalog.MachineFromPath(ws)
	machine := catalog.MachineFor(ws, dbOS, dbHost, "")
	if machine == "current" || machine == "" {
		if dirExists {
			machine = hostKind
		} else if pathShape == "" && strings.HasPrefix(ws, "/") {
			// Non-/Users/ absolute path missing locally -> remote Linux/VPS checkout.
			machine = "linux"
		} else {
			machine = hostKind
		}
	}

	var nodeList []nodes.Node
	if x != nil && x.n != nil {
		nodeList, _ = x.n.List(ctx)
	}
	var matchedNode nodes.Node
	if len(nodeList) > 0 {
		matchedNode, _ = nodes.Find(nodeList, ws, machine)
		if matchedNode.NodeID != "" {
			if m := nodes.MachineOf(matchedNode); m != "" && pathShape == "" && dbOS == "" {
				machine = m
			}
		}
	}

	var workerClient *worker.Client
	if x != nil {
		workerClient = x.w
	}
	remoteAvailable := currentRemoteShell(workerClient) != nil

	isLocal := false
	if dirExists && pathShape != "windows" && (dbOS == "" || strings.EqualFold(dbOS, runtime.GOOS) || machine == hostKind) {
		machine = hostKind
		isLocal = true
	} else if machine == hostKind && !remoteAvailable {
		isLocal = true
	}

	return workspaceTarget{
		Workspace:     ws,
		Machine:       machine,
		MachineLabel:  machineDisplayLabel(machine),
		IsLocal:       isLocal,
		NodeID:        matchedNode.NodeID,
		Hostname:      matchedNode.Hostname,
		NodeExecutors: matchedNode.Executors,
		NodeFresh:     matchedNode.Fresh(time.Now()),
	}
}

func normalizeExecutorsConfig(in ExecutorsConfig) (ExecutorsConfig, int) {
	known := map[string]bool{}
	for _, id := range defaultExecutorOrder {
		known[id] = true
	}

	seenOrder := map[string]bool{}
	order := make([]string, 0, len(defaultExecutorOrder))
	for _, raw := range in.Order {
		id := strings.ToLower(strings.TrimSpace(raw))
		if !known[id] || seenOrder[id] {
			continue
		}
		seenOrder[id] = true
		order = append(order, id)
	}
	for _, id := range defaultExecutorOrder {
		if !seenOrder[id] {
			seenOrder[id] = true
			order = append(order, id)
		}
	}

	seenHidden := map[string]bool{}
	hidden := make([]string, 0, len(in.Hidden))
	for _, raw := range in.Hidden {
		id := strings.ToLower(strings.TrimSpace(raw))
		if !known[id] || seenHidden[id] {
			continue
		}
		seenHidden[id] = true
		hidden = append(hidden, id)
	}

	visibleCount := 0
	for _, id := range order {
		if !seenHidden[id] {
			visibleCount++
		}
	}
	return ExecutorsConfig{
		Order:  order,
		Hidden: hidden,
		All:    slices.Clone(defaultExecutorOrder),
	}, visibleCount
}

func loadExecutorsConfig(s *store.Store) ExecutorsConfig {
	var raw string
	_ = s.DB.QueryRow(`SELECT value FROM dispatch_settings WHERE key=?`, executorsConfigSettingKey).Scan(&raw)
	var cfg ExecutorsConfig
	hasSaved := strings.TrimSpace(raw) != ""
	if hasSaved {
		_ = json.Unmarshal([]byte(raw), &cfg)
	} else {
		cfg.Hidden = slices.Clone(defaultHiddenExecutors)
	}
	normalized, _ := normalizeExecutorsConfig(cfg)
	return normalized
}

func handleGetExecutorsSetting(w http.ResponseWriter, s *store.Store) {
	ok(w, loadExecutorsConfig(s))
}

func handleSetExecutorsSetting(w http.ResponseWriter, r *http.Request, s *store.Store) {
	var in ExecutorsConfig
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		fail(w, 400, "invalid JSON payload")
		return
	}
	cfg, visible := normalizeExecutorsConfig(in)
	if visible < 1 {
		fail(w, 400, "at least one executor must remain visible")
		return
	}
	persisted := ExecutorsConfig{Order: cfg.Order, Hidden: cfg.Hidden}
	b, _ := json.Marshal(persisted)
	_, err := s.DB.Exec(
		`INSERT INTO dispatch_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
		executorsConfigSettingKey, string(b),
	)
	if err != nil {
		fail(w, 500, err.Error())
		return
	}
	ok(w, cfg)
}

func availableFromMap(installed map[string]bool) []string {
	var avail []string
	for _, id := range defaultExecutorOrder {
		if installed[id] {
			avail = append(avail, id)
		}
	}
	return avail
}

func probeWorkspaceExecutors(ctx context.Context, a *API, x *dispatchDeps, rawWorkspace string, refresh bool) ExecutorProbeResponse {
	target := resolveWorkspaceTarget(ctx, a, x, rawWorkspace)
	cacheKey := target.Machine + "::" + catalog.Normalize(target.Workspace)

	if !refresh && !target.IsLocal {
		probeCacheMu.Lock()
		entry, hit := probeCache[cacheKey]
		probeCacheMu.Unlock()
		if hit && time.Since(entry.at) < executorProbeTTL {
			return entry.resp
		}
	}

	resp := ExecutorProbeResponse{
		Workspace:    target.Workspace,
		Machine:      target.Machine,
		MachineLabel: target.MachineLabel,
		IsLocal:      target.IsLocal,
		NodeID:       target.NodeID,
		Hostname:     target.Hostname,
		Installed:    map[string]bool{},
	}

	if target.IsLocal {
		resp.Installed = models.ProbeLocalExecutors()
		resp.Probed = true
		resp.AvailableExecutors = availableFromMap(resp.Installed)
		return resp
	}

	var workerClient *worker.Client
	if x != nil {
		workerClient = x.w
	}
	if shellFn := currentRemoteShell(workerClient); shellFn != nil {
		cmd := models.RemoteExecutorProbeCommand(target.Machine == "windows")
		out, err := shellFn(ctx, target.Workspace, cmd)
		if err == nil {
			installed := models.ParseRemoteExecutorProbe(out)
			for _, ex := range target.NodeExecutors {
				id := strings.ToLower(strings.TrimSpace(ex))
				if _, ok := installed[id]; ok {
					installed[id] = true
				}
			}
			resp.Installed = installed
			resp.Probed = true
			resp.AvailableExecutors = availableFromMap(installed)
			probeCacheMu.Lock()
			probeCache[cacheKey] = executorProbeCacheEntry{at: time.Now(), resp: resp}
			probeCacheMu.Unlock()
			return resp
		}
		resp.Error = err.Error()
	}

	// If shell probe was unavailable or failed, fall back to live node report executors if present.
	if len(target.NodeExecutors) > 0 && target.NodeFresh {
		for _, id := range defaultExecutorOrder {
			resp.Installed[id] = false
		}
		for _, ex := range target.NodeExecutors {
			id := strings.ToLower(strings.TrimSpace(ex))
			if _, ok := resp.Installed[id]; ok {
				resp.Installed[id] = true
			}
		}
		resp.Probed = true
		resp.AvailableExecutors = availableFromMap(resp.Installed)
		return resp
	}

	// Unable to probe remote host: leave Probed=false and optimistic installed map so UI doesn't lock out offline setups.
	for _, id := range defaultExecutorOrder {
		resp.Installed[id] = true
	}
	resp.AvailableExecutors = slices.Clone(defaultExecutorOrder)
	if resp.Error == "" {
		resp.Error = "node-agent not connected for " + target.MachineLabel
	}
	return resp
}

func handleProbeExecutors(w http.ResponseWriter, r *http.Request, a *API, x *dispatchDeps) {
	ws := r.URL.Query().Get("workspace")
	refresh := r.URL.Query().Get("refresh") == "1"
	ok(w, probeWorkspaceExecutors(r.Context(), a, x, ws, refresh))
}

func handleGetModels(w http.ResponseWriter, r *http.Request, a *API, x *dispatchDeps) {
	executor := r.URL.Query().Get("executor")
	refresh := r.URL.Query().Get("refresh") == "1"
	ws := strings.TrimSpace(r.URL.Query().Get("workspace"))

	if strings.EqualFold(strings.TrimSpace(executor), "agy") || strings.EqualFold(strings.TrimSpace(executor), "antigravity") {
		target := resolveWorkspaceTarget(r.Context(), a, x, ws)
		if !target.IsLocal {
			if shellFn := currentRemoteShell(x.w); shellFn != nil {
				cmd := models.RemoteAgyModelsCommand(target.Machine == "windows")
				raw := x.m.ListAgyForTarget(r.Context(), target.Machine, "remote-cli", func(ctx context.Context) ([]byte, error) {
					out, err := shellFn(ctx, target.Workspace, cmd)
					return []byte(out), err
				}, refresh)
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write(raw)
				return
			}
		}
	}

	raw, err := x.m.List(r.Context(), executor, refresh)
	if err != nil {
		fail(w, 502, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(raw)
}

func agyAccountSettingKey(machine string) string {
	m := strings.ToLower(strings.TrimSpace(machine))
	if m == "" {
		return agyActiveAccountKey
	}
	return agyActiveAccountKey + "." + m
}

func loadSavedAgyAccount(s *store.Store, machine string) string {
	if s == nil || s.DB == nil {
		return ""
	}
	var saved string
	if machine != "" {
		_ = s.DB.QueryRow(`SELECT value FROM dispatch_settings WHERE key=?`, agyAccountSettingKey(machine)).Scan(&saved)
		if strings.TrimSpace(saved) != "" {
			return strings.TrimSpace(saved)
		}
	}
	_ = s.DB.QueryRow(`SELECT value FROM dispatch_settings WHERE key=?`, agyActiveAccountKey).Scan(&saved)
	return strings.TrimSpace(saved)
}

func agyRunnerForTarget(target workspaceTarget, w *worker.Client) (models.AgyAuthRunner, bool) {
	if override := currentAgyAuthRunner(); override != nil {
		return override, true
	}
	if target.IsLocal {
		return nil, true
	}
	if shellFn := currentRemoteShell(w); shellFn != nil {
		return models.RemoteAgyAuthRunner(shellFn, target.Workspace, target.Machine == "windows"), true
	}
	return nil, false
}

func handleGetAgyAccounts(w http.ResponseWriter, r *http.Request, a *API, x *dispatchDeps) {
	ws := r.URL.Query().Get("workspace")
	target := resolveWorkspaceTarget(r.Context(), a, x, ws)
	savedActive := loadSavedAgyAccount(a.S, target.Machine)

	var workerClient *worker.Client
	if x != nil {
		workerClient = x.w
	}
	runner, reachable := agyRunnerForTarget(target, workerClient)
	if !reachable {
		ok(w, map[string]any{
			"available":     false,
			"machine":       target.Machine,
			"machine_label": target.MachineLabel,
			"is_local":      target.IsLocal,
			"accounts":      []models.AgyAccount{},
			"active":        savedActive,
			"error":         "node-agent not connected for " + target.MachineLabel,
		})
		return
	}

	accounts, active, err := models.ListAgyAccounts(r.Context(), runner)
	if err != nil {
		ok(w, map[string]any{
			"available":     false,
			"machine":       target.Machine,
			"machine_label": target.MachineLabel,
			"is_local":      target.IsLocal,
			"accounts":      []models.AgyAccount{},
			"active":        savedActive,
			"error":         err.Error(),
		})
		return
	}
	if active == "" && savedActive != "" {
		active = savedActive
		for i := range accounts {
			if strings.EqualFold(accounts[i].Email, savedActive) ||
				strings.EqualFold(accounts[i].ID, savedActive) ||
				strings.EqualFold(accounts[i].Alias, savedActive) {
				accounts[i].Active = true
			}
		}
	}
	ok(w, map[string]any{
		"available":     true,
		"machine":       target.Machine,
		"machine_label": target.MachineLabel,
		"is_local":      target.IsLocal,
		"accounts":      accounts,
		"active":        active,
	})
}

func handleSwitchAgyAccount(w http.ResponseWriter, r *http.Request, a *API, x *dispatchDeps) {
	var in struct {
		Account   string `json:"account"`
		Workspace string `json:"workspace"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		fail(w, 400, "invalid JSON payload")
		return
	}
	accTarget := strings.TrimSpace(in.Account)
	if accTarget == "" {
		fail(w, 400, "account is required")
		return
	}
	target := resolveWorkspaceTarget(r.Context(), a, x, in.Workspace)
	var workerClient *worker.Client
	if x != nil {
		workerClient = x.w
	}
	runner, reachable := agyRunnerForTarget(target, workerClient)
	if !reachable {
		fail(w, 502, "node-agent not connected for "+target.MachineLabel)
		return
	}
	if err := models.SwitchAgyAccount(r.Context(), accTarget, runner); err != nil {
		fail(w, 400, err.Error())
		return
	}
	for _, key := range []string{agyAccountSettingKey(target.Machine), agyActiveAccountKey} {
		if _, err := a.S.DB.Exec(
			`INSERT INTO dispatch_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
			key, accTarget,
		); err != nil {
			fail(w, 500, err.Error())
			return
		}
	}
	accounts, active, _ := models.ListAgyAccounts(r.Context(), runner)
	if active == "" {
		active = accTarget
	}
	ok(w, map[string]any{
		"ok":            true,
		"machine":       target.Machine,
		"machine_label": target.MachineLabel,
		"active":        active,
		"accounts":      accounts,
	})
}
