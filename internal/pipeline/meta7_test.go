package pipeline

import (
	"errors"
	"testing"
)

// meta7 ships as a builtin next to design-thinking, and its stage graph is the
// seven-stage contract: explore → cross_examine → synthesize → design → verify →
// review → impl.
func TestMeta7IsABuiltinFlow(t *testing.T) {
	tpls, err := BuiltinTemplates()
	if err != nil {
		t.Fatal(err)
	}
	var meta7 *Template
	for i := range tpls {
		if tpls[i].Name == "meta7" {
			meta7 = &tpls[i]
		}
	}
	if meta7 == nil {
		t.Fatalf("meta7 template missing from builtins: %v", names(tpls))
	}
	want := []string{"explore", "cross_examine", "synthesize", "design", "verify", "review", "impl"}
	if len(meta7.Stages) != len(want) {
		t.Fatalf("want %d stages, got %d", len(want), len(meta7.Stages))
	}
	for i, id := range want {
		if meta7.Stages[i].ID != id {
			t.Fatalf("stage %d: want %s, got %s", i, id, meta7.Stages[i].ID)
		}
	}
	if meta7.Budget.MaxReviewLoops != 2 || meta7.Budget.MaxEvolutions != 3 {
		t.Fatalf("budget: want loops=2 evolutions=3, got %+v", meta7.Budget)
	}
	// The two judgement stages must be able to send work backwards.
	for _, id := range []string{"verify", "review"} {
		st := stage(t, meta7, id)
		if !st.Verdict {
			t.Fatalf("%s must be a verdict stage", id)
		}
		if st.BackArcs["FAIL:design"] != "design" || st.BackArcs["FAIL:context"] != "explore" {
			t.Fatalf("%s back arcs: %v", id, st.BackArcs)
		}
	}
	if st := stage(t, meta7, "explore"); st.Fanout == nil || st.Fanout.Min < 3 {
		t.Fatalf("explore must fan out: %+v", st.Fanout)
	}
	if st := stage(t, meta7, "impl"); !st.ReviewGate || len(st.GateBand) == 0 {
		t.Fatalf("impl must sit behind a review gate: %+v", st)
	}
}

func TestDefaultTemplateSwitch(t *testing.T) {
	eng, boardID := setupEngine(t)
	t.Setenv("SWITCHYARD_PIPELINE_DEFAULT", "")

	if got := eng.DefaultTemplate(); got != FallbackTemplate {
		t.Fatalf("untouched engine: want %s, got %s", FallbackTemplate, got)
	}

	// The switch itself.
	if err := eng.SetDefaultTemplate("meta7"); err != nil {
		t.Fatal(err)
	}
	if got := eng.DefaultTemplate(); got != "meta7" {
		t.Fatalf("after switch: want meta7, got %s", got)
	}

	// Start with no template named must pick up the switch, not design-thinking.
	run, err := eng.Start(StartInput{BoardID: boardID, Goal: "ship the meta7 flow"})
	if err != nil {
		t.Fatal(err)
	}
	if run.Template != "meta7" {
		t.Fatalf("run template: want meta7, got %s", run.Template)
	}
	if st := stageBy(run, "explore"); st.ID == "" || len(st.Nodes) < 3 {
		t.Fatalf("meta7 explore must materialize a fanout: %+v", st)
	}

	// Unknown names are refused, and do not disturb the active default.
	err = eng.SetDefaultTemplate("no-such-flow")
	if !errors.Is(err, ErrInvalidTemplate) {
		t.Fatalf("want ErrInvalidTemplate, got %v", err)
	}
	if got := eng.DefaultTemplate(); got != "meta7" {
		t.Fatalf("refused switch must keep meta7, got %s", got)
	}

	// Clearing the setting falls back.
	if err := eng.SetDefaultTemplate(""); err != nil {
		t.Fatal(err)
	}
	if got := eng.DefaultTemplate(); got != FallbackTemplate {
		t.Fatalf("cleared setting: want %s, got %s", FallbackTemplate, got)
	}

	// An explicit request still wins over the default.
	run, err = eng.Start(StartInput{Template: "design-thinking", BoardID: boardID, Goal: "explicit"})
	if err != nil {
		t.Fatal(err)
	}
	if run.Template != "design-thinking" {
		t.Fatalf("explicit template ignored: got %s", run.Template)
	}
}

// The env var is boot config: it seeds the default when no runtime switch is set.
func TestDefaultTemplateFromEnv(t *testing.T) {
	eng, _ := setupEngine(t)
	t.Setenv("SWITCHYARD_PIPELINE_DEFAULT", "meta7")
	if got := eng.DefaultTemplate(); got != "meta7" {
		t.Fatalf("want meta7 from env, got %s", got)
	}

	// A runtime switch beats the boot config.
	if err := eng.SetDefaultTemplate("design-thinking"); err != nil {
		t.Fatal(err)
	}
	if got := eng.DefaultTemplate(); got != "design-thinking" {
		t.Fatalf("setting must win over env, got %s", got)
	}

	// A stale env name must not break Start.
	t.Setenv("SWITCHYARD_PIPELINE_DEFAULT", "gone")
	if err := eng.SetDefaultTemplate(""); err != nil {
		t.Fatal(err)
	}
	if got := eng.DefaultTemplate(); got != FallbackTemplate {
		t.Fatalf("unknown env name must fall back, got %s", got)
	}
}

func names(tpls []Template) []string {
	out := make([]string, 0, len(tpls))
	for _, t := range tpls {
		out = append(out, t.Name)
	}
	return out
}

func stage(t *testing.T, tpl *Template, id string) StageSpec {
	t.Helper()
	for _, s := range tpl.Stages {
		if s.ID == id {
			return s
		}
	}
	t.Fatalf("stage %s not found", id)
	return StageSpec{}
}
