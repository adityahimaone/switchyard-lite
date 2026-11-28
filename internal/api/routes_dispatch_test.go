package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/adityahimaone/switchyard-studio/internal/store"
)

func TestDispatchRoutes(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"models":["m1"]}`))
	}))
	defer up.Close()
	t.Setenv("NODE_AGENT_URL", up.URL)
	s, _ := store.Open(":memory:")
	defer s.Close()
	h := New(s).Handler()
	wr, _ := CreateToken(s, "w", "admin")
	if c := do(t, h, "GET", "/api/v1/models?executor=x", wr, "").Code; c != 200 {
		t.Fatalf("models %d", c)
	}
	if c := do(t, h, "POST", "/api/v1/workers", wr, `{"name":"n1"}`).Code; c != 201 {
		t.Fatalf("worker %d", c)
	}
	if w := do(t, h, "GET", "/api/v1/workers", wr, ""); w.Code != 200 || w.Body.Len() < 10 {
		t.Fatalf("workers %d", w.Code)
	}
	if c := do(t, h, "GET", "/api/v1/tasks/nope/diff", wr, "").Code; c != 409 {
		t.Fatalf("diff %d", c)
	}
	if c := do(t, h, "POST", "/api/v1/tasks/nope/dispatch", wr, "").Code; c != 404 {
		t.Fatalf("dispatch %d", c)
	}
	if c := do(t, h, "POST", "/api/v1/workspaces", wr, `{"id":"mac-dev","name":"Mac Dev","path":"/Users/dev/app","host":"mac-tailscale","os":"mac","kind":"repo","labels":["work"],"note":"Apple Silicon"}`).Code; c != 201 {
		t.Fatalf("ws %d", c)
	}
	if w := do(t, h, "PUT", "/api/v1/workspaces/mac-dev", wr, `{"name":"Mac Mini","path":"/Users/dev/app","host":"mac-tailscale","os":"mac","kind":"repo","labels":["work","ios"],"note":"Updated"}`); w.Code != 200 {
		t.Fatalf("ws update %d %s", w.Code, w.Body.String())
	}
	if w := do(t, h, "POST", "/api/v1/workspaces/mac-dev/ping", wr, ""); w.Code != 200 {
		t.Fatalf("ws ping %d", w.Code)
	}
	if w := do(t, h, "GET", "/api/v1/tasks/t_none/worktree", wr, ""); w.Code != 200 {
		t.Fatalf("worktree %d", w.Code)
	}
}

func TestExecutorsSettingsAndAgyAccountRoutes(t *testing.T) {
	s, _ := store.Open(":memory:")
	defer s.Close()
	h := New(s).Handler()
	wr, _ := CreateToken(s, "w", "admin")

	// 1. Default executors config starts with agy.
	res := do(t, h, "GET", "/api/v1/settings/executors", wr, "")
	if res.Code != 200 {
		t.Fatalf("get executors %d: %s", res.Code, res.Body.String())
	}
	var cfg ExecutorsConfig
	if err := json.Unmarshal(res.Body.Bytes(), &cfg); err != nil {
		t.Fatal(err)
	}
	if len(cfg.Order) < 6 || cfg.Order[0] != "agy" {
		t.Fatalf("unexpected default executor order: %+v", cfg)
	}

	// 2. Reorder and hide executors, verify persistence.
	res = do(t, h, "POST", "/api/v1/settings/executors", wr, `{"order":["codex","agy","claude"],"hidden":["dsh","omp"]}`)
	if res.Code != 200 {
		t.Fatalf("post executors %d: %s", res.Code, res.Body.String())
	}
	res2 := do(t, h, "GET", "/api/v1/settings/executors", wr, "")
	if err := json.Unmarshal(res2.Body.Bytes(), &cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.Order[0] != "codex" || cfg.Order[1] != "agy" || !slices.Equal(cfg.Hidden, []string{"dsh", "omp"}) {
		t.Fatalf("executor order/hidden not persisted cleanly: %+v", cfg)
	}

	// 3. Reject hiding all executors.
	bad := do(t, h, "POST", "/api/v1/settings/executors", wr, `{"order":["agy","claude","codex","commandcode","omp","dsh"],"hidden":["agy","claude","codex","commandcode","omp","dsh"]}`)
	if bad.Code != 400 {
		t.Fatalf("expected 400 when hiding all executors, got %d (%s)", bad.Code, bad.Body.String())
	}

	// 4. Agy models endpoint returns catalog with thinking levels without NODE_AGENT_URL.
	mRes := do(t, h, "GET", "/api/v1/models?executor=agy", wr, "")
	if mRes.Code != 200 || !strings.Contains(mRes.Body.String(), "thinking_levels") {
		t.Fatalf("expected agy model catalog with thinking_levels, got %d: %s", mRes.Code, mRes.Body.String())
	}

	// 5. Agy accounts list + switch via agy-auth hook.
	activeAcct := "first@example.com"
	restore := setAgyAuthOverride(func(ctx context.Context, args ...string) ([]byte, error) {
		if len(args) == 1 && args[0] == "list" {
			m1, m2 := "", ""
			if activeAcct == "first@example.com" {
				m1 = "*"
			} else {
				m2 = "*"
			}
			return []byte(
				"| Active | ID | Email | Name | Tags |\n" +
					"| " + m1 + " | id-1 | first@example.com | First | |\n" +
					"| " + m2 + " | id-2 | second@example.com | Second | work |\n",
			), nil
		}
		if len(args) == 2 && args[0] == "switch" {
			activeAcct = args[1]
			return []byte("Switched"), nil
		}
		return nil, nil
	})
	defer restore()

	accRes := do(t, h, "GET", "/api/v1/agy/accounts", wr, "")
	if accRes.Code != 200 || !strings.Contains(accRes.Body.String(), "first@example.com") {
		t.Fatalf("get agy accounts %d: %s", accRes.Code, accRes.Body.String())
	}

	swRes := do(t, h, "POST", "/api/v1/agy/accounts/switch", wr, `{"account":"second@example.com"}`)
	if swRes.Code != 200 || !strings.Contains(swRes.Body.String(), `"active":"second@example.com"`) {
		t.Fatalf("switch agy account %d: %s", swRes.Code, swRes.Body.String())
	}

	var storedActive string
	_ = s.DB.QueryRow(`SELECT value FROM dispatch_settings WHERE key='agy.active_account'`).Scan(&storedActive)
	if storedActive != "second@example.com" {
		t.Fatalf("expected persisted agy.active_account=second@example.com, got %q", storedActive)
	}
}

func TestWorkspaceRoutingExecutorProbeAndPerMachineAgyAccounts(t *testing.T) {
	s, _ := store.Open(":memory:")
	defer s.Close()
	h := New(s).Handler()
	wr, _ := CreateToken(s, "w", "admin")

	var probedWorkspaces []string
	var switchedTargets []string
	restoreShell := setRemoteShellOverride(func(ctx context.Context, workspace, command string) (string, error) {
		probedWorkspaces = append(probedWorkspaces, workspace)
		if strings.Contains(command, "Get-Command") || strings.Contains(command, "for b in agy") {
			if strings.HasPrefix(workspace, "D:\\") {
				return "agy=1\nclaude=0\ncodex=1\ncommandcode=0\nomp=0\ndsh=0\n", nil
			}
			return "agy=0\nclaude=1\ncodex=0\ncommandcode=0\nomp=0\ndsh=1\n", nil
		}
		if strings.Contains(command, "registry.json") {
			return `{"version":2,"active":"acct_de5a253671","accounts":[{"id":"acct_a30e78a3a6","email":"adityahimaone@gmail.com","alias":"personal"},{"id":"acct_de5a253671","email":"izonelikeswan@gmail.com","alias":"work-2"},{"id":"acct_7f340fd018","email":"swanlike101@gmail.com","alias":"work-1"},{"id":"acct_6d8505dcc2","email":"swanlike102@gmail.com","alias":"work-3"}]}`, nil
		}
		if strings.Contains(command, "agy-auth switch") {
			switchedTargets = append(switchedTargets, command)
			return "Switched", nil
		}
		return "", nil
	})
	defer restoreShell()

	// 1. Local probe reflects host OS and probed=true.
	localProbeRes := do(t, h, "GET", "/api/v1/executors/probe", wr, "")
	if localProbeRes.Code != 200 || !strings.Contains(localProbeRes.Body.String(), `"probed":true`) {
		t.Fatalf("local probe %d: %s", localProbeRes.Code, localProbeRes.Body.String())
	}

	// 2. Remote Windows workspace probe returns machine=windows and exact binary map.
	winProbeRes := do(t, h, "GET", `/api/v1/executors/probe?workspace=D%3A%5Cxampp%5Chtdocs%5Cportal`, wr, "")
	if winProbeRes.Code != 200 {
		t.Fatalf("win probe %d: %s", winProbeRes.Code, winProbeRes.Body.String())
	}
	var wp ExecutorProbeResponse
	if err := json.Unmarshal(winProbeRes.Body.Bytes(), &wp); err != nil {
		t.Fatal(err)
	}
	if wp.Machine != "windows" || wp.MachineLabel != "Windows" || wp.IsLocal || !wp.Probed {
		t.Fatalf("unexpected Windows target: %+v", wp)
	}
	if !wp.Installed["agy"] || wp.Installed["claude"] || !wp.Installed["codex"] {
		t.Fatalf("unexpected Windows installed map: %+v", wp.Installed)
	}

	// 3. Remote VPS/Linux workspace agy-auth accounts lists all 4 accounts routed to linux.
	accRes := do(t, h, "GET", "/api/v1/agy/accounts?workspace=%2Fsrv%2Fvps-app", wr, "")
	if accRes.Code != 200 {
		t.Fatalf("vps agy accounts %d: %s", accRes.Code, accRes.Body.String())
	}
	var accBody struct {
		Machine      string `json:"machine"`
		MachineLabel string `json:"machine_label"`
		Active       string `json:"active"`
		Accounts     []struct {
			Alias string `json:"alias"`
			Email string `json:"email"`
		} `json:"accounts"`
	}
	if err := json.Unmarshal(accRes.Body.Bytes(), &accBody); err != nil {
		t.Fatal(err)
	}
	if accBody.Machine != "linux" || len(accBody.Accounts) != 4 || accBody.Active != "izonelikeswan@gmail.com" {
		t.Fatalf("unexpected VPS agy accounts response: %+v", accBody)
	}

	// 4. Switching account on Windows workspace persists per-machine setting `agy.active_account.windows`.
	swRes := do(t, h, "POST", "/api/v1/agy/accounts/switch", wr, `{"account":"work-1","workspace":"D:\\xampp\\htdocs\\portal"}`)
	if swRes.Code != 200 {
		t.Fatalf("switch windows account %d: %s", swRes.Code, swRes.Body.String())
	}
	var winSaved string
	_ = s.DB.QueryRow(`SELECT value FROM dispatch_settings WHERE key='agy.active_account.windows'`).Scan(&winSaved)
	if winSaved != "work-1" {
		t.Fatalf("expected agy.active_account.windows=work-1, got %q", winSaved)
	}
	if len(probedWorkspaces) == 0 || len(switchedTargets) == 0 {
		t.Fatalf("expected remote shell calls for probe & switch, got probed=%v switched=%v", probedWorkspaces, switchedTargets)
	}
}
