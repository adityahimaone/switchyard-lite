package models

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"testing"
	"time"
)

func TestParseAgyModelsOutput(t *testing.T) {
	raw := "\r⠋ Fetching available models...\r⠙ Fetching available models...\r" +
		"gemini-4-neon-high              Gemini 4 Neon (High)\n" +
		"gemini-4-neon-xhigh             Gemini 4 Neon (XHigh)\n" +
		"claude-opus-5-5-high            Claude Opus 5.5 (High)\n" +
		"gpt-oss-120b-medium\tGPT-OSS 120B (Medium)\n"

	got := ParseAgyModelsOutput(raw)
	if len(got) != 4 {
		t.Fatalf("expected 4 parsed models, got %d: %+v", len(got), got)
	}
	if got[0].ID != "gemini-4-neon-high" || got[0].Label != "Gemini 4 Neon (High)" {
		t.Fatalf("unexpected first model: %+v", got[0])
	}
	if !slices.Equal(got[0].ThinkingLevels, AgyThinkingLevels) {
		t.Fatalf("expected thinking levels %v, got %v", AgyThinkingLevels, got[0].ThinkingLevels)
	}
	if got[3].ID != "gpt-oss-120b-medium" || got[3].Label != "GPT-OSS 120B (Medium)" {
		t.Fatalf("unexpected tab-delimited model: %+v", got[3])
	}
}

func TestCatalogListAgyUsesCLIAndCaches(t *testing.T) {
	calls := 0
	now := time.Unix(1000, 0)
	cat := New("", "")
	cat.Now = func() time.Time { return now }
	cat.RunAgyModels = func(ctx context.Context) ([]byte, error) {
		calls++
		return []byte("gemini-4-neon-xhigh  Gemini 4 Neon (XHigh)\n"), nil
	}

	raw, err := cat.List(context.Background(), "agy", false)
	if err != nil {
		t.Fatalf("List agy failed: %v", err)
	}
	var payload struct {
		Executor string     `json:"executor"`
		Source   string     `json:"source"`
		Models   []AgyModel `json:"models"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.Source != "cli" || len(payload.Models) != 1 || payload.Models[0].ID != "gemini-4-neon-xhigh" {
		t.Fatalf("unexpected CLI payload: %+v", payload)
	}

	// Second call within TTL hits cache without re-running CLI.
	if _, err := cat.List(context.Background(), "agy", false); err != nil {
		t.Fatalf("cached List failed: %v", err)
	}
	if calls != 1 {
		t.Fatalf("expected cache hit (calls=1), got %d", calls)
	}
}

func TestCatalogListAgyFallbackToDefaults(t *testing.T) {
	cat := New("", "")
	cat.RunAgyModels = func(ctx context.Context) ([]byte, error) {
		return nil, errors.New("agy binary missing")
	}

	raw, err := cat.List(context.Background(), "agy", true)
	if err != nil {
		t.Fatalf("fallback List failed: %v", err)
	}
	var payload struct {
		Source string     `json:"source"`
		Models []AgyModel `json:"models"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("unmarshal fallback payload: %v", err)
	}
	if payload.Source != "default" || len(payload.Models) < 10 {
		t.Fatalf("expected default catalog, got source=%q count=%d", payload.Source, len(payload.Models))
	}
}

func TestParseAndSwitchAgyAccounts(t *testing.T) {
	table := `
+--------+--------------------------------------+-------------------------+----------------+----------+
| Active | ID                                   | Email                   | Name           | Tags     |
+--------+--------------------------------------+-------------------------+----------------+----------+
| *      | 6afa995e-610a-4e1f-970f-ebb9a774f0fb | adityahimaone@gmail.com | Aditya Himawan | primary  |
|        | 9f1b2c3d-0000-4444-8888-111122223333 | work@example.com        | Work Account   | work,pro |
+--------+--------------------------------------+-------------------------+----------------+----------+
`
	parsed := ParseAgyAuthList(table)
	if len(parsed) != 2 {
		t.Fatalf("expected 2 accounts, got %d: %+v", len(parsed), parsed)
	}
	if !parsed[0].Active || parsed[0].Email != "adityahimaone@gmail.com" || !slices.Equal(parsed[0].Tags, []string{"primary"}) {
		t.Fatalf("unexpected account[0]: %+v", parsed[0])
	}
	if parsed[1].Active || parsed[1].Email != "work@example.com" || len(parsed[1].Tags) != 2 {
		t.Fatalf("unexpected account[1]: %+v", parsed[1])
	}

	var switchedTo string
	runner := func(ctx context.Context, args ...string) ([]byte, error) {
		if len(args) == 1 && args[0] == "list" {
			return []byte(table), nil
		}
		if len(args) == 2 && args[0] == "switch" {
			switchedTo = args[1]
			return []byte("Switched to " + args[1]), nil
		}
		return nil, errors.New("unexpected args")
	}

	accounts, active, err := ListAgyAccounts(context.Background(), runner)
	if err != nil {
		t.Fatalf("ListAgyAccounts failed: %v", err)
	}
	if active != "adityahimaone@gmail.com" || len(accounts) != 2 {
		t.Fatalf("unexpected active=%q accounts=%+v", active, accounts)
	}

	if err := SwitchAgyAccount(context.Background(), "work@example.com", runner); err != nil {
		t.Fatalf("SwitchAgyAccount failed: %v", err)
	}
	if switchedTo != "work@example.com" {
		t.Fatalf("expected switch target work@example.com, got %q", switchedTo)
	}
	if err := SwitchAgyAccount(context.Background(), "", runner); err == nil {
		t.Fatal("expected error for empty account target")
	}
}

func TestParseAgyAuthRegistryJSONAndFikrilalTable(t *testing.T) {
	regJSON := `{
		"version": 2,
		"active": "acct_de5a253671",
		"accounts": [
			{"id": "acct_6d8505dcc2", "email": "swanlike102@gmail.com", "alias": "work-3"},
			{"id": "acct_a30e78a3a6", "email": "adityahimaone@gmail.com", "alias": "personal"},
			{"id": "acct_de5a253671", "email": "izonelikeswan@gmail.com", "alias": "work-2"},
			{"id": "acct_7f340fd018", "email": "swanlike101@gmail.com", "alias": "work-1"}
		]
	}`
	accounts, active, ok := ParseAgyAuthRegistryJSON(regJSON)
	if !ok || len(accounts) != 4 {
		t.Fatalf("expected 4 accounts from registry.json, got ok=%v len=%d", ok, len(accounts))
	}
	if active != "izonelikeswan@gmail.com" {
		t.Fatalf("expected active izonelikeswan@gmail.com, got %q", active)
	}
	if accounts[1].Alias != "personal" || accounts[1].Email != "adityahimaone@gmail.com" || accounts[1].Active {
		t.Fatalf("unexpected personal account: %+v", accounts[1])
	}
	if !accounts[2].Active || accounts[2].Alias != "work-2" {
		t.Fatalf("expected work-2 active, got %+v", accounts[2])
	}

	cliTable := `warning: quota lookup failed for 2 account(s): refresh_failed (2)

 #     ACCOUNT         PLAN    5H  WEEKLY  GROUP                  5H RESET
--------------------------------------------------------------------------
 -  *  (unknown) (no…  Pro    79%     49%  Claude and GPT models  15:57 (1h 47m)
01     work-2 (izone…  Pro    73%     64%  Gemini 4 Argon         17:57 (3h 47m)
02     personal (adi…  Pro    79%     49%  Claude and GPT models  15:57 (1h 47m)
03     work-1 (swanl…  -        -       -  -                      -
04     work-3 (swanl…  -        -       -  -                      -

Tip: Showing limiting quota groups.
`
	parsedTable := ParseAgyAuthList(cliTable)
	if len(parsedTable) != 4 {
		t.Fatalf("expected 4 table accounts, got %d: %+v", len(parsedTable), parsedTable)
	}
	if parsedTable[0].Alias != "work-2" || parsedTable[0].Plan != "Pro" || parsedTable[0].Quota5H != "73%" {
		t.Fatalf("unexpected table row 0: %+v", parsedTable[0])
	}

	probe := ParseRemoteExecutorProbe("agy=1\nclaude=0\ncodex=1\ncommandcode=0\nomp=1\ndsh=0\n")
	if !probe["agy"] || probe["claude"] || !probe["codex"] || probe["dsh"] {
		t.Fatalf("unexpected remote probe parse: %+v", probe)
	}
}
