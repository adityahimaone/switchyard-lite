package harnesses

import (
	"strings"
	"testing"

	"github.com/adityahimaone/switchyard-lite/internal/tasks"
)

func TestBuildSpawnSpecBig3(t *testing.T) {
	agy := BuildSpawnSpec("agy", "gemini-4-neon-high", "xhigh", "conv_1", "/ws", "Fix bug", 300)
	if agy.Argv[0] != "agy" || !strings.Contains(strings.Join(agy.Argv, " "), "--conversation conv_1") {
		t.Fatalf("unexpected agy spec: %+v", agy)
	}

	dsh := BuildSpawnSpec("dsh", "adit-router/claude-sonnet-4", "medium", "sess_2", "/ws", "Add test", 300)
	if dsh.Argv[0] != "dsh" || dsh.Env["DSH_PROVIDER"] != "adit-9router" || dsh.Env["DSH_MODEL"] != "claude-sonnet-4" || dsh.Env["DSH_REASONING_EFFORT"] != "high" {
		t.Fatalf("unexpected dsh spec: %+v", dsh)
	}

	cmd := BuildSpawnSpec("cmd", "gpt-5", "high", "cc_3", "/ws", "Refactor", 300)
	if cmd.Argv[0] != "commandcode" || !strings.Contains(strings.Join(cmd.Argv, " "), "--resume cc_3") {
		t.Fatalf("unexpected commandcode spec: %+v", cmd)
	}
}

func TestUnwrapOutputPreservesQuestionJSON(t *testing.T) {
	raw := `{"type":"session","sessionId":"sess_abc"}
{"type":"assistant","delta":"Let me check. "}
{"type":"tool_call","name":"ask_question","question":"Which DB?","options":["SQLite","Postgres"]}
{"type":"result","sessionId":"sess_abc","finalText":"Done"}`
	txt, sid := UnwrapOutput("dsh", raw)
	if sid != "sess_abc" {
		t.Fatalf("expected sess_abc, got %q", sid)
	}
	if !strings.Contains(txt, `"question":"Which DB?"`) {
		t.Fatalf("expected question JSON preserved, got:\n%s", txt)
	}
	if !strings.Contains(txt, "Done") {
		t.Fatalf("expected finalText, got:\n%s", txt)
	}
}

func TestCrossHarnessHandoff(t *testing.T) {
	h := BuildCrossHarnessHandoff("dsh", "agy", tasks.Task{
		ID:       "t_1",
		Model:    "gemini-4-neon-high",
		ErrorSig: "exit 1",
		Result:   "partial edit applied",
	})
	if !strings.Contains(h, "[CROSS-HARNESS HANDOFF]") || !strings.Contains(h, "-> New harness: agy") {
		t.Fatalf("unexpected handoff:\n%s", h)
	}
}
