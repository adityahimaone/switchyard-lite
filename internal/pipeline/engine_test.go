package pipeline

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/adityahimaone/switchyard-lite/internal/store"
	"github.com/adityahimaone/switchyard-lite/internal/tasks"
)

func setupEngine(t *testing.T) (*Engine, string) {
	t.Helper()
	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	eng, err := New(s)
	if err != nil {
		t.Fatal(err)
	}
	b, err := eng.Tasks.CreateBoard("main")
	if err != nil {
		t.Fatal(err)
	}
	return eng, b.ID
}

func completeNode(t *testing.T, eng *Engine, taskID, output string) {
	t.Helper()
	tk, err := eng.Tasks.Get(taskID)
	if err != nil {
		t.Fatal(err)
	}
	if tk.Status == tasks.Todo {
		if _, err := eng.Tasks.Move(taskID, tasks.InProgress, "test"); err != nil {
			t.Fatalf("move %s in_progress: %v", taskID, err)
		}
	}
	if output != "" {
		if _, err := eng.Tasks.AddComment(taskID, "worker", output); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := eng.Tasks.Move(taskID, tasks.Review, "test"); err != nil {
		t.Fatalf("move %s review: %v", taskID, err)
	}
}

func failNode(t *testing.T, eng *Engine, taskID, sig string) {
	t.Helper()
	tk, err := eng.Tasks.Get(taskID)
	if err != nil {
		t.Fatal(err)
	}
	if tk.Status == tasks.Todo {
		_, _ = eng.Tasks.Move(taskID, tasks.InProgress, "test")
	}
	_, _ = eng.S.DB.Exec(`UPDATE tasks SET error_sig=?, retry_count=retry_count+1 WHERE id=?`, sig, taskID)
	_, _ = eng.Tasks.AddComment(taskID, "dispatcher", "attempt failed: "+sig)
	if _, err := eng.Tasks.Move(taskID, tasks.Failed, "test"); err != nil {
		t.Fatalf("move %s failed: %v", taskID, err)
	}
}

func stageBy(r *RunState, id string) StageView {
	for _, s := range r.Stages {
		if s.ID == id {
			return s
		}
	}
	return StageView{}
}

func TestBuiltinDesignThinkingFullFlowAndBoundaries(t *testing.T) {
	eng, boardID := setupEngine(t)
	run, err := eng.Start(StartInput{
		Template: "design-thinking",
		BoardID:  boardID,
		Goal:     "Build rate limiter",
	})
	if err != nil {
		t.Fatal(err)
	}
	// Wave 1: explore fanout (min 3) materialized; cross_examine pending.
	exp := stageBy(run, "explore")
	if len(exp.Nodes) != 3 || exp.Status != "running" {
		t.Fatalf("explore nodes=%d status=%s", len(exp.Nodes), exp.Status)
	}
	if stageBy(run, "cross_examine").Status != "pending" {
		t.Fatalf("cross_examine must wait on explore gate")
	}

	// Finish explore:1 and explore:2 — gate still holds until explore:3 finishes.
	completeNode(t, eng, exp.Nodes[0].TaskID, "explored token bucket")
	completeNode(t, eng, exp.Nodes[1].TaskID, "explored sliding window")
	run, _ = eng.ProjectRun(run.ID)
	if stageBy(run, "cross_examine").Status != "pending" {
		t.Fatalf("gate advanced early")
	}
	completeNode(t, eng, exp.Nodes[2].TaskID, "explored redis store")

	// Wave 2: cross_examine materialized 1:1 with explore.
	run, _ = eng.ProjectRun(run.ID)
	ce := stageBy(run, "cross_examine")
	if len(ce.Nodes) != 3 {
		t.Fatalf("cross_examine nodes=%d want 3", len(ce.Nodes))
	}
	// Check boundary rule: cross_examine:1 prompt contains explore:1 output, NOT explore:2 output.
	ce1Task, _ := eng.Tasks.Get(ce.Nodes[0].TaskID)
	if !strings.Contains(ce1Task.Prompt, "explored token bucket") || strings.Contains(ce1Task.Prompt, "explored sliding window") {
		t.Fatalf("boundary violation on cross_examine:1 prompt: %s", ce1Task.Prompt)
	}

	for _, n := range ce.Nodes {
		completeNode(t, eng, n.TaskID, "```json\n{\"status\":\"done\",\"verdict\":\"PASS\",\"summary\":\"verified "+n.Key+"\"}\n```")
	}

	// Wave 3: synthesize
	run, _ = eng.ProjectRun(run.ID)
	syn := stageBy(run, "synthesize")
	if len(syn.Nodes) != 1 {
		t.Fatalf("synthesize nodes=%d", len(syn.Nodes))
	}
	synTask, _ := eng.Tasks.Get(syn.Nodes[0].TaskID)
	if !strings.Contains(synTask.Prompt, "verified cross_examine:1") || strings.Contains(synTask.Prompt, "explored token bucket") {
		t.Fatalf("boundary rule: synthesize must only read cross_examine, got: %s", synTask.Prompt)
	}
	completeNode(t, eng, syn.Nodes[0].TaskID, "agreed architecture synthesis")

	// Wave 4: design
	run, _ = eng.ProjectRun(run.ID)
	des := stageBy(run, "design")
	completeNode(t, eng, des.Nodes[0].TaskID, "concrete design spec v1")

	// Wave 5: review (PASS)
	run, _ = eng.ProjectRun(run.ID)
	rev := stageBy(run, "review")
	completeNode(t, eng, rev.Nodes[0].TaskID, `{"status":"done","verdict":"PASS","summary":"design is solid"}`)

	// Wave 6: impl has review_gate=true and gate_band=[behavior, runtime, security, docs].
	run, _ = eng.ProjectRun(run.ID)
	impl := stageBy(run, "impl")
	if len(impl.Nodes) != 1 {
		t.Fatalf("impl nodes=%d", len(impl.Nodes))
	}
	completeNode(t, eng, impl.Nodes[0].TaskID, "implemented rate limiter")
	// Because review_gate=true, impl:1 stays in review until approved.
	implTask, _ := eng.Tasks.Get(impl.Nodes[0].TaskID)
	if implTask.Status != tasks.Review {
		t.Fatalf("review_gate task should hold in review, got %s", implTask.Status)
	}
	// Approve impl:1 -> moves to done -> spawns 4 gate_band tasks.
	_, _ = eng.Tasks.Move(impl.Nodes[0].TaskID, tasks.Done, "reviewer")
	run, _ = eng.ProjectRun(run.ID)
	impl = stageBy(run, "impl")
	if len(impl.Nodes) != 5 { // 1 main + 4 gate_band
		t.Fatalf("expected 1 main + 4 gate nodes, got %d", len(impl.Nodes))
	}
	for _, n := range impl.Nodes {
		if n.Kind == "gate" {
			completeNode(t, eng, n.TaskID, "gate ok")
		}
	}

	// Wave 7: commit
	run, _ = eng.ProjectRun(run.ID)
	com := stageBy(run, "commit")
	if len(com.Nodes) != 1 {
		t.Fatalf("commit nodes=%d", len(com.Nodes))
	}
	completeNode(t, eng, com.Nodes[0].TaskID, "committed")

	run, _ = eng.ProjectRun(run.ID)
	if run.Status != "completed" {
		t.Fatalf("expected completed run, got %s", run.Status)
	}
}

func TestRetryAndEvolveAfterThreeIdenticalFailures(t *testing.T) {
	eng, boardID := setupEngine(t)
	run, _ := eng.Start(StartInput{Template: "design-thinking", BoardID: boardID, Goal: "evolve test"})
	exp := stageBy(run, "explore")
	n0 := exp.Nodes[0]
	origTask, _ := eng.Tasks.Get(n0.TaskID)

	// 1st and 2nd identical failures -> retry with identical prompt.
	for i := 1; i <= 2; i++ {
		failNode(t, eng, n0.TaskID, "compile_error: missing foo")
		tk, _ := eng.Tasks.Get(n0.TaskID)
		if tk.Status != tasks.Todo {
			t.Fatalf("attempt %d should retry to todo, got %s", i, tk.Status)
		}
		if tk.Prompt != origTask.Prompt {
			t.Fatalf("attempt %d must not modify prompt on retry", i)
		}
	}

	// 3rd consecutive identical failure -> spawns modifier task to evolve node.
	failNode(t, eng, n0.TaskID, "compile_error: missing foo")
	run, _ = eng.ProjectRun(run.ID)
	exp = stageBy(run, "explore")
	if exp.Nodes[0].ModifierTaskID == "" || run.Evolutions != 1 {
		t.Fatalf("expected modifier task & evolutions=1, got mod=%q evolutions=%d", exp.Nodes[0].ModifierTaskID, run.Evolutions)
	}

	// Complete the modifier task with an adapted prompt -> node transitions to evolved and re-queues.
	completeNode(t, eng, exp.Nodes[0].ModifierTaskID, "Adapted prompt: import foo before building")
	tk, _ := eng.Tasks.Get(n0.TaskID)
	if tk.Status != tasks.Todo || !strings.Contains(tk.Prompt, "Adapted prompt") {
		t.Fatalf("expected evolved todo task with adapted prompt, got status=%s prompt=%q", tk.Status, tk.Prompt)
	}
	completeNode(t, eng, n0.TaskID, "succeeded after evolution")
	run, _ = eng.ProjectRun(run.ID)
	exp = stageBy(run, "explore")
	if exp.Nodes[0].Status != "evolved" {
		t.Fatalf("want node status evolved, got %s", exp.Nodes[0].Status)
	}
}

func TestBackArcDesignAndContextAndBudget(t *testing.T) {
	eng, boardID := setupEngine(t)
	tpl, err := ParseTemplate([]byte(`
name: mini-arc
budget: { max_review_loops: 2, max_evolutions: 1 }
stages:
  - id: explore
    fanout: { from: goal, min: 2 }
    prompt: explore
  - id: design
    inputs: [explore]
    prompt: design
  - id: review
    inputs: [design]
    verdict: true
    back_arcs: { "FAIL:design": design, "FAIL:context": explore }
    prompt: review
`))
	if err != nil {
		t.Fatal(err)
	}
	eng.RegisterTemplate(tpl)

	run, err := eng.Start(StartInput{Template: "mini-arc", BoardID: boardID, Goal: "test back arcs"})
	if err != nil {
		t.Fatal(err)
	}
	for _, n := range stageBy(run, "explore").Nodes {
		completeNode(t, eng, n.TaskID, "finding "+n.Key)
	}
	run, _ = eng.ProjectRun(run.ID)
	completeNode(t, eng, stageBy(run, "design").Nodes[0].TaskID, "draft design 1")

	// 1. Trigger FAIL:design back-arc -> resets design & review, explore stays done (2 nodes).
	run, _ = eng.ProjectRun(run.ID)
	completeNode(t, eng, stageBy(run, "review").Nodes[0].TaskID, `{"verdict":"FAIL:design","summary":"race condition in design"}`)
	run, _ = eng.ProjectRun(run.ID)
	if run.ReviewLoops != 1 {
		t.Fatalf("want review_loops=1, got %d", run.ReviewLoops)
	}
	if stageBy(run, "explore").Status != "done" || len(stageBy(run, "explore").Nodes) != 2 {
		t.Fatalf("explore should stay done with 2 nodes")
	}
	desTask, _ := eng.Tasks.Get(stageBy(run, "design").Nodes[0].TaskID)
	if desTask.Status != tasks.Todo || !strings.Contains(desTask.Prompt, "race condition in design") {
		t.Fatalf("design should be todo with feedback, got status=%s", desTask.Status)
	}

	// Re-complete design, then trigger FAIL:context -> appends explore:3!
	completeNode(t, eng, desTask.ID, "draft design 2")
	run, _ = eng.ProjectRun(run.ID)
	completeNode(t, eng, stageBy(run, "review").Nodes[0].TaskID, `{"verdict":"FAIL:context","summary":"missing Windows path semantics"}`)
	run, _ = eng.ProjectRun(run.ID)
	if run.ReviewLoops != 2 {
		t.Fatalf("want review_loops=2, got %d", run.ReviewLoops)
	}
	exp := stageBy(run, "explore")
	if len(exp.Nodes) != 3 {
		t.Fatalf("FAIL:context must append explore:3, got %d nodes", len(exp.Nodes))
	}

	// Complete explore:3 and design, then fail review a 3rd time -> exceeds max_review_loops(2) -> needs_human!
	completeNode(t, eng, exp.Nodes[2].TaskID, "windows findings")
	run, _ = eng.ProjectRun(run.ID)
	completeNode(t, eng, stageBy(run, "design").Nodes[0].TaskID, "draft design 3")
	run, _ = eng.ProjectRun(run.ID)
	completeNode(t, eng, stageBy(run, "review").Nodes[0].TaskID, `{"verdict":"FAIL:design","summary":"still broken"}`)
	run, _ = eng.ProjectRun(run.ID)
	if run.Status != "needs_human" {
		t.Fatalf("want needs_human when budget exhausted, got %s", run.Status)
	}
}

func TestCrossExamineSplitProtocol(t *testing.T) {
	eng, boardID := setupEngine(t)
	run, _ := eng.Start(StartInput{Template: "design-thinking", BoardID: boardID, Goal: "split protocol"})
	exp := stageBy(run, "explore")
	for _, n := range exp.Nodes {
		completeNode(t, eng, n.TaskID, "initial "+n.Key)
	}
	run, _ = eng.ProjectRun(run.ID)
	ce := stageBy(run, "cross_examine")
	// Reject cross_examine:1 (VERDICT=FAIL), pass cross_examine:2 and cross_examine:3.
	completeNode(t, eng, ce.Nodes[0].TaskID, `{"verdict":"FAIL","summary":"missing evidence on topic 1"}`)
	completeNode(t, eng, ce.Nodes[1].TaskID, `{"verdict":"PASS","summary":"ok 2"}`)
	completeNode(t, eng, ce.Nodes[2].TaskID, `{"verdict":"PASS","summary":"ok 3"}`)

	// explore:1 must be todo again, while explore:2 and explore:3 remain done; cross_examine:1 is blocked by explore:1.
	exp1, _ := eng.Tasks.Get(exp.Nodes[0].TaskID)
	exp2, _ := eng.Tasks.Get(exp.Nodes[1].TaskID)
	ce1, _ := eng.Tasks.Get(ce.Nodes[0].TaskID)
	if exp1.Status != tasks.Todo || exp2.Status != tasks.Done || ce1.Status != tasks.Blocked {
		t.Fatalf("split protocol: exp1=%s exp2=%s ce1=%s", exp1.Status, exp2.Status, ce1.Status)
	}
	// Re-complete explore:1 and cross_examine:1 -> synthesize materializes.
	completeNode(t, eng, exp1.ID, "redone explore:1")
	completeNode(t, eng, ce1.ID, `{"verdict":"PASS","summary":"now valid"}`)
	run, _ = eng.ProjectRun(run.ID)
	if len(stageBy(run, "synthesize").Nodes) != 1 {
		t.Fatalf("synthesize should materialize after split protocol passes")
	}
}

func TestMeta7ArtifactsBoardAbsorptionGateChainingAndRetry(t *testing.T) {
	eng, boardID := setupEngine(t)
	ws := t.TempDir()

	t1, err := eng.Tasks.Create(tasks.NewTask{
		BoardID:   boardID,
		Title:     "Add rate limit middleware",
		Prompt:    "Enforce 100 req/min per token.",
		Status:    tasks.Todo,
		Workspace: ws,
		Executor:  "claude",
		Model:     "claude-sonnet-4-5",
		Effort:    "high",
		Branch:    "main",
		Paths:     []string{"internal/api/router.go"},
		Skills:    []string{"go-testing"},
	})
	if err != nil {
		t.Fatal(err)
	}
	t2, err := eng.Tasks.Create(tasks.NewTask{
		BoardID:    boardID,
		Title:      "Add quota response headers",
		Prompt:     "Return X-RateLimit-Remaining.",
		Acceptance: "Unit tests verify remaining count.",
		Status:     tasks.Backlog,
		Workspace:  ws,
		Paths:      []string{"internal/api/auth.go"},
	})
	if err != nil {
		t.Fatal(err)
	}

	run, err := eng.Start(StartInput{
		Template:     "meta7",
		BoardID:      boardID,
		ProjectName:  "Rate Limit Rollout",
		IncludeBoard: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if run.ProjectName != "rate-limit-rollout" {
		t.Fatalf("want slugified project name rate-limit-rollout, got %q", run.ProjectName)
	}
	gotIDs := map[string]bool{}
	for _, id := range run.SourceTaskIDs {
		gotIDs[id] = true
	}
	if len(run.SourceTaskIDs) != 2 || !gotIDs[t1.ID] || !gotIDs[t2.ID] {
		t.Fatalf("expected both board tasks absorbed (%s, %s), got %v", t1.ID, t2.ID, run.SourceTaskIDs)
	}
	t1After, _ := eng.Tasks.Get(t1.ID)
	if t1After.Status != tasks.Backlog || t1After.ParentID != run.GoalTaskID {
		t.Fatalf("absorbed todo task must park in backlog under goal task, got status=%s parent=%s", t1After.Status, t1After.ParentID)
	}
	if run.ArtifactDir == "" {
		t.Fatalf("expected artifact_dir to be populated for local workspace")
	}

	exp := stageBy(run, "explore")
	if len(exp.Nodes) < 3 {
		t.Fatalf("expected >= 3 explore nodes, got %d", len(exp.Nodes))
	}
	expTask0, _ := eng.Tasks.Get(exp.Nodes[0].TaskID)
	if expTask0.Workspace != ws || expTask0.Executor != "claude" || expTask0.Model != "claude-sonnet-4-5" || expTask0.Effort != "high" || expTask0.Branch != "main" {
		t.Fatalf("explore node missing propagated routing fields: %+v", expTask0)
	}
	if len(expTask0.Paths) != 2 || len(expTask0.Skills) != 1 {
		t.Fatalf("explore node missing propagated paths/skills: paths=%v skills=%v", expTask0.Paths, expTask0.Skills)
	}

	for _, n := range exp.Nodes {
		completeNode(t, eng, n.TaskID, "findings for "+n.Key)
	}
	run, _ = eng.ProjectRun(run.ID)
	for _, n := range stageBy(run, "cross_examine").Nodes {
		completeNode(t, eng, n.TaskID, `{"verdict":"PASS","summary":"solid evidence"}`)
	}
	run, _ = eng.ProjectRun(run.ID)
	completeNode(t, eng, stageBy(run, "synthesize").Nodes[0].TaskID, "unified synthesis doc")
	run, _ = eng.ProjectRun(run.ID)
	completeNode(t, eng, stageBy(run, "design").Nodes[0].TaskID, "architecture design v1")
	run, _ = eng.ProjectRun(run.ID)
	completeNode(t, eng, stageBy(run, "verify").Nodes[0].TaskID, `{"verdict":"PASS","summary":"all invariants green"}`)
	run, _ = eng.ProjectRun(run.ID)
	completeNode(t, eng, stageBy(run, "review").Nodes[0].TaskID, `{"verdict":"PASS","summary":"ready for impl"}`)

	run, _ = eng.ProjectRun(run.ID)
	impl := stageBy(run, "impl")
	if len(impl.Nodes) != 1 {
		t.Fatalf("expected 1 impl main node, got %d", len(impl.Nodes))
	}
	implTaskID := impl.Nodes[0].TaskID
	completeNode(t, eng, implTaskID, "implemented middleware + headers")
	if _, err := eng.Tasks.Move(implTaskID, tasks.Done, "reviewer"); err != nil {
		t.Fatal(err)
	}

	run, _ = eng.ProjectRun(run.ID)
	impl = stageBy(run, "impl")
	if len(impl.Nodes) != 5 {
		t.Fatalf("expected 1 main + 4 gate nodes, got %d", len(impl.Nodes))
	}
	for _, n := range impl.Nodes {
		if n.Kind == "gate" {
			gtk, _ := eng.Tasks.Get(n.TaskID)
			if gtk.Branch != "sy/"+implTaskID {
				t.Fatalf("gate %s must branch off sy/%s, got %q", n.Key, implTaskID, gtk.Branch)
			}
			completeNode(t, eng, n.TaskID, "gate verified")
		}
	}

	run, _ = eng.ProjectRun(run.ID)
	if run.Status != "completed" {
		t.Fatalf("expected completed run, got %s", run.Status)
	}
	t1Done, _ := eng.Tasks.Get(t1.ID)
	t2Done, _ := eng.Tasks.Get(t2.ID)
	if t1Done.Status != tasks.Done || t2Done.Status != tasks.Done {
		t.Fatalf("absorbed source tasks should be marked done on completion: t1=%s t2=%s", t1Done.Status, t2Done.Status)
	}

	var foundImplArtifact, foundReviewArtifact bool
	for _, a := range run.Artifacts {
		if a.Name == ".01.impl" && strings.Contains(a.Content, "architecture design v1") {
			foundImplArtifact = true
		}
		if a.Name == "REVIEW.md" && strings.Contains(a.Content, "ready for impl") {
			foundReviewArtifact = true
		}
	}
	if !foundImplArtifact || !foundReviewArtifact {
		t.Fatalf("expected .01.impl and REVIEW.md in run.Artifacts, got=%d", len(run.Artifacts))
	}
	implPath := filepath.Join(run.ArtifactDir, "projects", run.ProjectName, ".01.impl")
	if b, err := os.ReadFile(implPath); err != nil || !strings.Contains(string(b), "architecture design v1") {
		t.Fatalf("expected .01.impl on disk at %s: err=%v", implPath, err)
	}
	sgPath := filepath.Join(run.ArtifactDir, "projects", run.ProjectName, ".state.graph")
	if b, err := os.ReadFile(sgPath); err != nil || !strings.Contains(string(b), "pipeline.completed") {
		t.Fatalf("expected .state.graph on disk at %s: err=%v", sgPath, err)
	}

	// Test Restart creates a fresh run without duplicating board task sections.
	restarted, err := eng.Restart(run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if restarted.ID == run.ID || restarted.Status != "running" {
		t.Fatalf("unexpected restart result: %+v", restarted)
	}
	if strings.Count(restarted.Context, "### Board Task "+t1.ID+":") != 1 {
		t.Fatalf("restart must not duplicate board task context")
	}

	// Simulate exhaust-evolution failure -> RetryNode should recover needs_human -> running.
	exp0 := stageBy(restarted, "explore").Nodes[0]
	for i := 0; i < 4; i++ {
		tk, _ := eng.Tasks.Get(exp0.TaskID)
		if tk.Status == tasks.Todo {
			failNode(t, eng, exp0.TaskID, "network_timeout")
			r, _ := eng.ProjectRun(restarted.ID)
			mod := stageBy(r, "explore").Nodes[0].ModifierTaskID
			if mod != "" {
				completeNode(t, eng, mod, "adapted after timeout")
			}
		}
	}
	// Manually retry explore:1 stage cleanly.
	retried, err := eng.RetryNode(restarted.ID, "explore:1")
	if err != nil {
		t.Fatal(err)
	}
	if retried.Status != "running" {
		t.Fatalf("expected running after RetryNode, got %s", retried.Status)
	}
}
