package pipeline

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/store"
	"github.com/adityahimaone/switchyard-lite/internal/tasks"
)

var ErrNotFound = errors.New("pipeline run not found")

type NodeView struct {
	Key                          string   `json:"key"`
	TaskID                       string   `json:"task_id"`
	Stage                        string   `json:"stage"`
	Kind                         string   `json:"kind"` // main | gate | modifier
	Status                       string   `json:"status"`
	Evolved                      bool     `json:"evolved,omitempty"`
	ModifierTaskID               string   `json:"modifier_task_id,omitempty"`
	RetryCount                   int      `json:"retry_count"`
	ConsecutiveIdenticalFailures int      `json:"consecutive_identical_failures"`
	LastErrorSig                 string   `json:"last_error_sig,omitempty"`
	FailurePayloads              []string `json:"failure_payloads,omitempty"`
	Verdict                      string   `json:"verdict,omitempty"`
	Output                       string   `json:"output,omitempty"`
	Items                        []string `json:"items,omitempty"`
}

type StageView struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Status    string     `json:"status"` // pending | running | done | evolved | failed
	DependsOn []string   `json:"depends_on,omitempty"`
	Nodes     []NodeView `json:"nodes,omitempty"`
}

type RunState struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Template    string      `json:"template"`
	BoardID     string      `json:"board_id"`
	GoalTaskID  string      `json:"goal_task_id"`
	Goal        string      `json:"goal"`
	Workspace   string      `json:"workspace,omitempty"`
	Status      string      `json:"status"` // running | completed | needs_human | cancelled
	Reason      string      `json:"reason,omitempty"`
	ReviewLoops int         `json:"review_loops"`
	Evolutions  int         `json:"evolutions"`
	Budget      Budget      `json:"budget"`
	Stages      []StageView `json:"stages"`
	CreatedAt   int64       `json:"created_at"`
	UpdatedAt   int64       `json:"updated_at"`
}

type StartInput struct {
	Template  string   `json:"template"`
	BoardID   string   `json:"board_id"`
	Goal      string   `json:"goal"`
	Workspace string   `json:"workspace,omitempty"`
	Items     []string `json:"items,omitempty"`
}

type Engine struct {
	S         *store.Store
	Tasks     *tasks.Service
	Now       func() time.Time
	templates map[string]Template
}

var customTemplates = map[string]Template{}

func New(s *store.Store) (*Engine, error) {
	e := &Engine{
		S:         s,
		Tasks:     tasks.New(s),
		Now:       time.Now,
		templates: map[string]Template{},
	}
	tpls, err := BuiltinTemplates()
	if err != nil {
		return nil, err
	}
	for _, t := range tpls {
		e.templates[t.Name] = t
	}
	for k, t := range customTemplates {
		e.templates[k] = t
	}
	return e, nil
}

func (e *Engine) RegisterTemplate(t Template) {
	e.templates[t.Name] = t
	customTemplates[t.Name] = t
}

func (e *Engine) Templates() []Template {
	out := make([]Template, 0, len(e.templates))
	for _, t := range e.templates {
		out = append(out, t)
	}
	return out
}

// FallbackTemplate is the flow Start uses when nothing is configured.
const FallbackTemplate = "design-thinking"

// defaultTemplateKey is the dispatch_settings row that holds the active flow.
const defaultTemplateKey = "pipeline.default_template"

// DefaultTemplate reports the flow Start picks when the caller names none.
// Precedence: the `pipeline.default_template` setting (runtime switch), then
// SWITCHYARD_PIPELINE_DEFAULT (boot config), then FallbackTemplate. A name that
// is not registered falls back instead of failing Start.
func (e *Engine) DefaultTemplate() string {
	name := strings.TrimSpace(os.Getenv("SWITCHYARD_PIPELINE_DEFAULT"))
	var s string
	if err := e.S.DB.QueryRow(`SELECT value FROM dispatch_settings WHERE key=?`, defaultTemplateKey).Scan(&s); err == nil {
		if v := strings.TrimSpace(s); v != "" {
			name = v
		}
	}
	if _, ok := e.templates[name]; !ok {
		return FallbackTemplate
	}
	return name
}

// SetDefaultTemplate switches the active flow. An empty name clears the setting
// so DefaultTemplate falls back to the env var or FallbackTemplate.
func (e *Engine) SetDefaultTemplate(name string) error {
	name = strings.TrimSpace(name)
	if name != "" {
		if _, ok := e.templates[name]; !ok {
			return fmt.Errorf("%w: unknown template %s", ErrInvalidTemplate, name)
		}
	}
	_, err := e.S.DB.Exec(`INSERT INTO dispatch_settings(key,value) VALUES(?,?)
		ON CONFLICT(key) DO UPDATE SET value=excluded.value`, defaultTemplateKey, name)
	return err
}

func newRunID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return "run_" + hex.EncodeToString(b)
}

func (e *Engine) emit(runID, kind string, payload any) error {
	b, _ := json.Marshal(payload)
	now := e.Now().Unix()
	_, err := e.S.DB.Exec(`INSERT INTO events(task_id,kind,payload,created_at) VALUES(?,?,?,?)`,
		runID, kind, string(b), now)
	return err
}

// Start creates a new pipeline run, its root goal task, and ticks the first wave.
func (e *Engine) Start(in StartInput) (*RunState, error) {
	if in.Template == "" {
		in.Template = e.DefaultTemplate()
	}
	tpl, ok := e.templates[in.Template]
	if !ok {
		return nil, fmt.Errorf("%w: unknown template %s", ErrInvalidTemplate, in.Template)
	}
	if in.BoardID == "" || strings.TrimSpace(in.Goal) == "" {
		return nil, fmt.Errorf("%w: board_id and goal are required", tasks.ErrBadRequest)
	}
	goalTask, err := e.Tasks.Create(tasks.NewTask{
		BoardID:   in.BoardID,
		Title:     "[pipeline] " + in.Goal,
		Prompt:    in.Goal,
		Workspace: in.Workspace,
	})
	if err != nil {
		return nil, err
	}
	// Hold the goal task in backlog until the pipeline completes so the dispatcher
	// only claims materialized stage nodes.
	_, _ = e.Tasks.Move(goalTask.ID, tasks.Backlog, "pipeline")

	runID := newRunID()
	now := e.Now().Unix()
	_, err = e.S.DB.Exec(`INSERT INTO pipeline_runs(id,template,board_id,goal_task_id,goal,status,created_at,updated_at)
		VALUES(?,?,?,?,?,'running',?,?)`,
		runID, tpl.Name, in.BoardID, goalTask.ID, in.Goal, now, now)
	if err != nil {
		return nil, err
	}
	_ = e.emit(runID, "pipeline.started", map[string]any{
		"template":     tpl.Name,
		"board_id":     in.BoardID,
		"goal_task_id": goalTask.ID,
		"goal":         in.Goal,
		"workspace":    in.Workspace,
		"items":        in.Items,
	})
	return e.Tick(runID)
}

// Cancel marks a running pipeline as cancelled.
func (e *Engine) Cancel(runID string) (*RunState, error) {
	if _, err := e.ProjectRun(runID); err != nil {
		return nil, err
	}
	now := e.Now().Unix()
	_, _ = e.S.DB.Exec(`UPDATE pipeline_runs SET status='cancelled', reason='cancelled by user', updated_at=? WHERE id=?`, now, runID)
	_ = e.emit(runID, "pipeline.cancelled", map[string]string{"reason": "cancelled by user"})
	return e.ProjectRun(runID)
}

// ListRuns returns all runs projected from the event log.
func (e *Engine) ListRuns() ([]*RunState, error) {
	rows, err := e.S.DB.Query(`SELECT id FROM pipeline_runs ORDER BY created_at DESC, id`)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()
	out := []*RunState{}
	for _, id := range ids {
		if r, err := e.ProjectRun(id); err == nil {
			out = append(out, r)
		}
	}
	return out, nil
}

// ProjectRun folds the append-only event log for runID and joins live task status/outputs.
func (e *Engine) ProjectRun(runID string) (*RunState, error) {
	evts, err := e.Tasks.Events(runID, 0, 500)
	if err != nil {
		return nil, err
	}
	var started bool
	st := &RunState{ID: runID, Status: "running"}
	var tpl Template
	type nodeState struct {
		NodeView
		handledFailureCount int
		verdictChecked      int64 // last comment ID evaluated for verdict
		invalidated         bool
	}
	nodesByStage := map[string][]*nodeState{}
	nodeByKey := map[string]*nodeState{}
	var seedItems []string

	for _, ev := range evts {
		switch ev.Kind {
		case "pipeline.started":
			started = true
			var p struct {
				Template   string   `json:"template"`
				BoardID    string   `json:"board_id"`
				GoalTaskID string   `json:"goal_task_id"`
				Goal       string   `json:"goal"`
				Workspace  string   `json:"workspace"`
				Items      []string `json:"items"`
			}
			_ = json.Unmarshal(ev.Payload, &p)
			st.Template = p.Template
			st.Name = p.Template
			st.BoardID = p.BoardID
			st.GoalTaskID = p.GoalTaskID
			st.Goal = p.Goal
			st.Workspace = p.Workspace
			st.CreatedAt = ev.CreatedAt
			st.UpdatedAt = ev.CreatedAt
			seedItems = p.Items
			tpl = e.templates[p.Template]
			st.Budget = tpl.Budget
		case "pipeline.node_spawned":
			var p struct {
				Stage  string `json:"stage"`
				Key    string `json:"key"`
				TaskID string `json:"task_id"`
				Kind   string `json:"kind"`
			}
			_ = json.Unmarshal(ev.Payload, &p)
			if existing, ok := nodeByKey[p.Key]; ok {
				existing.TaskID = p.TaskID
				existing.invalidated = false
				existing.Verdict = ""
			} else {
				ns := &nodeState{NodeView: NodeView{
					Key:    p.Key,
					TaskID: p.TaskID,
					Stage:  p.Stage,
					Kind:   p.Kind,
					Status: tasks.Todo,
				}}
				nodesByStage[p.Stage] = append(nodesByStage[p.Stage], ns)
				nodeByKey[p.Key] = ns
			}
			st.UpdatedAt = ev.CreatedAt
		case "pipeline.node_failure":
			var p struct {
				Key          string `json:"key"`
				Sig          string `json:"sig"`
				Payload      string `json:"payload"`
				FailureCount int    `json:"failure_count"`
			}
			_ = json.Unmarshal(ev.Payload, &p)
			if n, ok := nodeByKey[p.Key]; ok {
				if n.LastErrorSig == p.Sig && p.Sig != "" {
					n.ConsecutiveIdenticalFailures++
				} else {
					n.ConsecutiveIdenticalFailures = 1
					n.LastErrorSig = p.Sig
				}
				n.FailurePayloads = append(n.FailurePayloads, p.Payload)
				n.handledFailureCount = p.FailureCount
			}
			st.UpdatedAt = ev.CreatedAt
		case "pipeline.node_retry":
			var p struct {
				Key string `json:"key"`
			}
			_ = json.Unmarshal(ev.Payload, &p)
			if n, ok := nodeByKey[p.Key]; ok {
				n.RetryCount++
			}
			st.UpdatedAt = ev.CreatedAt
		case "pipeline.node_evolving":
			var p struct {
				Key            string `json:"key"`
				ModifierTaskID string `json:"modifier_task_id"`
			}
			_ = json.Unmarshal(ev.Payload, &p)
			if n, ok := nodeByKey[p.Key]; ok {
				n.ModifierTaskID = p.ModifierTaskID
			}
			st.Evolutions++
			st.UpdatedAt = ev.CreatedAt
		case "pipeline.node_evolved":
			var p struct {
				Key string `json:"key"`
			}
			_ = json.Unmarshal(ev.Payload, &p)
			if n, ok := nodeByKey[p.Key]; ok {
				n.Evolved = true
				n.ModifierTaskID = ""
				n.ConsecutiveIdenticalFailures = 0
				n.LastErrorSig = ""
			}
			st.UpdatedAt = ev.CreatedAt
		case "pipeline.verdict_checked":
			var p struct {
				Key       string `json:"key"`
				CommentID int64  `json:"comment_id"`
				Verdict   string `json:"verdict"`
			}
			_ = json.Unmarshal(ev.Payload, &p)
			if n, ok := nodeByKey[p.Key]; ok {
				n.verdictChecked = p.CommentID
				n.Verdict = p.Verdict
			}
		case "pipeline.stage_reset":
			var p struct {
				Stage string `json:"stage"`
				Key   string `json:"key"`
			}
			_ = json.Unmarshal(ev.Payload, &p)
			for _, n := range nodesByStage[p.Stage] {
				if p.Key == "" || n.Key == p.Key {
					n.invalidated = true
					n.Verdict = ""
				}
			}
			st.UpdatedAt = ev.CreatedAt
		case "pipeline.back_arc":
			st.ReviewLoops++
			st.UpdatedAt = ev.CreatedAt
		case "pipeline.needs_human":
			var p struct {
				Reason string `json:"reason"`
			}
			_ = json.Unmarshal(ev.Payload, &p)
			st.Status = "needs_human"
			st.Reason = p.Reason
			st.UpdatedAt = ev.CreatedAt
		case "pipeline.completed":
			st.Status = "completed"
			st.UpdatedAt = ev.CreatedAt
		case "pipeline.cancelled":
			var p struct {
				Reason string `json:"reason"`
			}
			_ = json.Unmarshal(ev.Payload, &p)
			st.Status = "cancelled"
			st.Reason = p.Reason
			st.UpdatedAt = ev.CreatedAt
		}
	}
	if !started {
		// Check pipeline_runs fallback
		var tplName string
		err := e.S.DB.QueryRow(`SELECT template,board_id,goal_task_id,goal,status,reason,created_at,updated_at FROM pipeline_runs WHERE id=?`, runID).
			Scan(&tplName, &st.BoardID, &st.GoalTaskID, &st.Goal, &st.Status, &st.Reason, &st.CreatedAt, &st.UpdatedAt)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		if err != nil {
			return nil, err
		}
		st.Template = tplName
		st.Name = tplName
		tpl = e.templates[tplName]
		st.Budget = tpl.Budget
	}
	_ = seedItems

	// Refresh live task status & latest output for each node.
	for _, list := range nodesByStage {
		for _, n := range list {
			tk, err := e.Tasks.Get(n.TaskID)
			if err == nil {
				n.Status = tk.Status
				if n.Evolved && tk.Status == tasks.Done {
					n.Status = "evolved"
				}
			}
			cs, _ := e.Tasks.Comments(n.TaskID)
			for i := len(cs) - 1; i >= 0; i-- {
				if cs[i].Author != "dispatcher" && cs[i].Author != "pipeline" && !strings.HasPrefix(cs[i].Body, "Changes requested:") {
					n.Output = cs[i].Body
					pr := ParseResult(cs[i].Body)
					if len(pr.Items) > 0 {
						n.Items = pr.Items
					}
					if cs[i].ID > n.verdictChecked && pr.Verdict != "" {
						n.Verdict = pr.Verdict
					}
					break
				}
			}
		}
	}

	// Build StageViews with topological depends_on.
	for i, sp := range tpl.Stages {
		deps := append([]string{}, sp.Inputs...)
		if sp.Per != "" && !contains(deps, sp.Per) {
			deps = append(deps, sp.Per)
		}
		if len(deps) == 0 && i > 0 {
			deps = []string{tpl.Stages[i-1].ID}
		}
		ns := nodesByStage[sp.ID]
		views := make([]NodeView, 0, len(ns))
		for _, n := range ns {
			views = append(views, n.NodeView)
		}
		st.Stages = append(st.Stages, StageView{
			ID:        sp.ID,
			Name:      sp.ID,
			Status:    stageStatus(sp, views),
			DependsOn: deps,
			Nodes:     views,
		})
	}
	return st, nil
}

func stageStatus(sp StageSpec, nodes []NodeView) string {
	var mains, gates []NodeView
	for _, n := range nodes {
		switch n.Kind {
		case "main":
			mains = append(mains, n)
		case "gate":
			gates = append(gates, n)
		}
	}
	if len(mains) == 0 {
		return "pending"
	}
	allDone := true
	anyEvolved := false
	for _, n := range mains {
		if n.Status == tasks.Failed {
			return "failed"
		}
		if n.Status != tasks.Done && n.Status != "evolved" {
			allDone = false
		}
		if n.Status == "evolved" || n.Evolved {
			anyEvolved = true
		}
	}
	if !allDone {
		return "running"
	}
	if len(sp.GateBand) > 0 {
		if len(gates) < len(sp.GateBand) {
			return "running"
		}
		for _, g := range gates {
			if g.Status == tasks.Failed {
				return "failed"
			}
			if g.Status != tasks.Done && g.Status != "evolved" {
				return "running"
			}
		}
	}
	if anyEvolved {
		return "evolved"
	}
	return "done"
}

// Tick advances the pipeline state machine idempotently.
func (e *Engine) Tick(runID string) (*RunState, error) {
	for step := 0; step < 8; step++ {
		run, err := e.ProjectRun(runID)
		if err != nil {
			return nil, err
		}
		if run.Status != "running" {
			return run, nil
		}
		tpl := e.templates[run.Template]
		changed := false

		stageByID := map[string]*StageView{}
		specByID := map[string]StageSpec{}
		for i := range run.Stages {
			stageByID[run.Stages[i].ID] = &run.Stages[i]
		}
		for _, sp := range tpl.Stages {
			specByID[sp.ID] = sp
		}

		// 1. Handle active nodes across stages (auto-complete non-review-gate tasks in review,
		//    handle verdicts/back-arcs, handle failures/retries/evolutions, materialize gate bands).
		for _, sp := range tpl.Stages {
			sv := stageByID[sp.ID]
			for _, n := range sv.Nodes {
				if n.Kind == "modifier" {
					continue
				}
				tk, err := e.Tasks.Get(n.TaskID)
				if err != nil {
					continue
				}
				// Check if node is waiting on a modifier task to finish evolving it.
				if n.ModifierTaskID != "" {
					modTk, err := e.Tasks.Get(n.ModifierTaskID)
					if err == nil && (modTk.Status == tasks.Review || modTk.Status == tasks.Done) {
						if modTk.Status == tasks.Review {
							_, _ = e.Tasks.Move(modTk.ID, tasks.Done, "pipeline")
						}
						adapted := e.latestWorkerOutput(modTk.ID)
						if adapted == "" {
							adapted = sp.Prompt + "\n\n[Evolved after repeated failures: avoid previous failure mode]"
						}
						_, _ = e.Tasks.Update(tk.ID, tasks.Patch{Prompt: &adapted})
						_ = e.emit(runID, "pipeline.node_evolved", map[string]string{"key": n.Key, "task_id": tk.ID})
						if tk.Status == tasks.Failed || tk.Status == tasks.Review {
							_, _ = e.Tasks.Move(tk.ID, tasks.Todo, "pipeline")
						}
						changed = true
						continue
					}
					continue
				}

				// If task is in Review:
				if tk.Status == tasks.Review {
					if sp.Verdict {
						if acted := e.handleVerdict(run, tpl, sp, n, tk); acted {
							changed = true
							break
						}
					}
					if !sp.ReviewGate || n.Kind == "gate" {
						_, _ = e.Tasks.Move(tk.ID, tasks.Done, "pipeline")
						changed = true
						continue
					}
				}

				// Also check verdict if task was moved directly to Done (e.g. in tests or manual move).
				if tk.Status == tasks.Done && sp.Verdict {
					if acted := e.handleVerdict(run, tpl, sp, n, tk); acted {
						changed = true
						break
					}
				}

				// Handle failed node -> retry or evolve after 3 consecutive identical signatures.
				if tk.Status == tasks.Failed {
					if e.handleFailure(run, sp, n, tk) {
						changed = true
						break
					}
				}
			}
			if changed {
				break
			}

			// Materialize gate_band tasks once main node(s) are done.
			if len(sp.GateBand) > 0 && e.mainsDone(sv.Nodes) && !e.hasGateBand(sv.Nodes) {
				var mainIDs []string
				for _, n := range sv.Nodes {
					if n.Kind == "main" {
						mainIDs = append(mainIDs, n.TaskID)
					}
				}
				for _, g := range sp.GateBand {
					key := sp.ID + ":gate:" + g
					prompt := fmt.Sprintf("Verify %s gate for stage %s.\nGoal: %s", g, sp.ID, run.Goal)
					gtk, err := e.Tasks.Create(tasks.NewTask{
						BoardID:   run.BoardID,
						ParentID:  run.GoalTaskID,
						Title:     fmt.Sprintf("[%s] gate:%s", sp.ID, g),
						Prompt:    prompt,
						Workspace: run.Workspace,
						BlockedBy: mainIDs,
					})
					if err == nil {
						_, _ = e.S.DB.Exec(`UPDATE tasks SET run_id=?, stage_id=? WHERE id=?`, runID, sp.ID, gtk.ID)
						_, _ = e.S.DB.Exec(`INSERT OR REPLACE INTO pipeline_nodes(task_id,run_id,stage,node_key,kind,created_at) VALUES(?,?,?,?,?,?)`,
							gtk.ID, runID, sp.ID, key, "gate", e.Now().Unix())
						_ = e.emit(runID, "pipeline.node_spawned", map[string]string{
							"stage": sp.ID, "key": key, "task_id": gtk.ID, "kind": "gate",
						})
						changed = true
					}
				}
			}
			if changed {
				break
			}
		}
		if changed {
			continue
		}

		// 2. Materialize pending stages whose upstream gate has passed.
		for _, sp := range tpl.Stages {
			sv := stageByID[sp.ID]
			if len(sv.Nodes) > 0 {
				continue
			}
			if !e.depsPassed(sv.DependsOn, stageByID) {
				continue
			}
			if e.materializeStage(run, sp, stageByID) {
				changed = true
				break
			}
		}
		if changed {
			continue
		}

		// 3. Check if all stages have passed -> complete the run.
		allPassed := len(run.Stages) > 0
		for _, sv := range run.Stages {
			if sv.Status != "done" && sv.Status != "evolved" {
				allPassed = false
				break
			}
		}
		if allPassed {
			now := e.Now().Unix()
			_, _ = e.S.DB.Exec(`UPDATE pipeline_runs SET status='completed', updated_at=? WHERE id=?`, now, runID)
			_, _ = e.S.DB.Exec(`UPDATE tasks SET status='done', updated_at=? WHERE id=?`, now, run.GoalTaskID)
			_ = e.emit(runID, "pipeline.completed", map[string]string{})
			return e.ProjectRun(runID)
		}
		return run, nil
	}
	return e.ProjectRun(runID)
}

func (e *Engine) depsPassed(deps []string, byID map[string]*StageView) bool {
	for _, d := range deps {
		sv, ok := byID[d]
		if !ok || (sv.Status != "done" && sv.Status != "evolved") {
			return false
		}
	}
	return true
}

func (e *Engine) mainsDone(nodes []NodeView) bool {
	mains := 0
	for _, n := range nodes {
		if n.Kind == "main" {
			mains++
			if n.Status != tasks.Done && n.Status != "evolved" {
				return false
			}
		}
	}
	return mains > 0
}

func (e *Engine) hasGateBand(nodes []NodeView) bool {
	for _, n := range nodes {
		if n.Kind == "gate" {
			return true
		}
	}
	return false
}

func (e *Engine) materializeStage(run *RunState, sp StageSpec, byID map[string]*StageView) bool {
	var depTaskIDs []string
	for _, d := range byID[sp.ID].DependsOn {
		if up, ok := byID[d]; ok {
			for _, n := range up.Nodes {
				if n.Kind == "main" || n.Kind == "gate" {
					depTaskIDs = append(depTaskIDs, n.TaskID)
				}
			}
		}
	}

	switch {
	case sp.Fanout != nil:
		topics := e.resolveFanoutItems(run, sp.Fanout, byID)
		for i, topic := range topics {
			key := fmt.Sprintf("%s:%d", sp.ID, i+1)
			prompt := fmt.Sprintf("%s\n\nGoal: %s\nTopic %d: %s", strings.TrimSpace(sp.Prompt), run.Goal, i+1, topic)
			e.spawnNode(run, sp.ID, key, "main", fmt.Sprintf("[%s %d] %s", sp.ID, i+1, topic), prompt, depTaskIDs)
		}
		return true

	case sp.Per != "":
		up := byID[sp.Per]
		if up == nil {
			return false
		}
		idx := 0
		for _, un := range up.Nodes {
			if un.Kind != "main" {
				continue
			}
			idx++
			key := fmt.Sprintf("%s:%d", sp.ID, idx)
			// Boundary rule: a `per` node receives ONLY its paired upstream node's output.
			prompt := fmt.Sprintf("%s\n\n--- Input from %s ---\n%s", strings.TrimSpace(sp.Prompt), un.Key, un.Output)
			e.spawnNode(run, sp.ID, key, "main", fmt.Sprintf("[%s %d] review %s", sp.ID, idx, un.Key), prompt, []string{un.TaskID})
		}
		return idx > 0

	default:
		// Boundary rule: stage prompt receives ONLY outputs of stages listed in sp.Inputs.
		var b strings.Builder
		b.WriteString(strings.TrimSpace(sp.Prompt))
		if len(sp.Inputs) == 0 {
			b.WriteString("\n\nGoal: " + run.Goal)
		}
		for _, inStage := range sp.Inputs {
			if up, ok := byID[inStage]; ok {
				for _, un := range up.Nodes {
					if un.Kind == "main" && un.Output != "" {
						fmt.Fprintf(&b, "\n\n--- Input from %s (%s) ---\n%s", inStage, un.Key, un.Output)
					}
				}
			}
		}
		key := sp.ID + ":1"
		e.spawnNode(run, sp.ID, key, "main", fmt.Sprintf("[%s] %s", sp.ID, run.Goal), b.String(), depTaskIDs)
		return true
	}
}

func (e *Engine) resolveFanoutItems(run *RunState, f *FanoutSpec, byID map[string]*StageView) []string {
	var items []string
	if f.From != "" && f.From != "goal" {
		if up, ok := byID[f.From]; ok {
			for _, n := range up.Nodes {
				items = append(items, n.Items...)
			}
		}
	} else {
		pr := ParseResult(run.Goal)
		items = append(items, pr.Items...)
	}
	min := f.Min
	if min <= 0 {
		min = 3
	}
	for len(items) < min {
		items = append(items, fmt.Sprintf("%s — aspect %d", run.Goal, len(items)+1))
	}
	return items
}

func (e *Engine) spawnNode(run *RunState, stageID, key, kind, title, prompt string, blockedBy []string) string {
	tk, err := e.Tasks.Create(tasks.NewTask{
		BoardID:   run.BoardID,
		ParentID:  run.GoalTaskID,
		Title:     title,
		Prompt:    prompt,
		Workspace: run.Workspace,
		BlockedBy: blockedBy,
	})
	if err != nil {
		return ""
	}
	_, _ = e.S.DB.Exec(`UPDATE tasks SET run_id=?, stage_id=? WHERE id=?`, run.ID, stageID, tk.ID)
	_, _ = e.S.DB.Exec(`INSERT OR REPLACE INTO pipeline_nodes(task_id,run_id,stage,node_key,kind,created_at) VALUES(?,?,?,?,?,?)`,
		tk.ID, run.ID, stageID, key, kind, e.Now().Unix())
	_ = e.emit(run.ID, "pipeline.node_spawned", map[string]string{
		"stage": stageID, "key": key, "task_id": tk.ID, "kind": kind,
	})
	return tk.ID
}

func (e *Engine) latestWorkerOutput(taskID string) string {
	cs, _ := e.Tasks.Comments(taskID)
	for i := len(cs) - 1; i >= 0; i-- {
		if cs[i].Author != "dispatcher" && cs[i].Author != "pipeline" {
			return cs[i].Body
		}
	}
	return ""
}

// handleFailure records the failure signature and either retries with identical prompt
// or triggers evolution after 3 consecutive identical error signatures.
func (e *Engine) handleFailure(run *RunState, sp StageSpec, n NodeView, tk tasks.Task) bool {
	var sig string
	_ = e.S.DB.QueryRow(`SELECT error_sig FROM tasks WHERE id=?`, tk.ID).Scan(&sig)
	if sig == "" {
		cs, _ := e.Tasks.Comments(tk.ID)
		if len(cs) > 0 {
			sig = cs[len(cs)-1].Body
		} else {
			sig = "unknown_error"
		}
	}
	consec := 1
	if n.LastErrorSig == sig {
		consec = n.ConsecutiveIdenticalFailures + 1
	}
	_ = e.emit(run.ID, "pipeline.node_failure", map[string]any{
		"key":           n.Key,
		"sig":           sig,
		"payload":       sig,
		"failure_count": len(n.FailurePayloads) + 1,
	})
	if consec >= 3 {
		if run.Evolutions >= run.Budget.MaxEvolutions {
			now := e.Now().Unix()
			reason := fmt.Sprintf("max_evolutions (%d) exhausted on %s", run.Budget.MaxEvolutions, n.Key)
			_, _ = e.S.DB.Exec(`UPDATE pipeline_runs SET status='needs_human', reason=?, updated_at=? WHERE id=?`, reason, now, run.ID)
			_ = e.emit(run.ID, "pipeline.needs_human", map[string]string{"reason": reason, "node": n.Key})
			return true
		}
		payloads := append(append([]string{}, n.FailurePayloads...), sig)
		modKey := sp.ID + ":modifier:" + n.Key
		modPrompt := fmt.Sprintf(
			"Node %s failed %d consecutive times with identical signature %q.\nAccumulated failure payloads:\n- %s\n\nOriginal prompt:\n%s\n\nRewrite the node prompt to overcome this failure pattern.",
			n.Key, consec, sig, strings.Join(payloads, "\n- "), tk.Prompt)
		modID := e.spawnNode(run, sp.ID, modKey, "modifier", fmt.Sprintf("[modifier] evolve %s", n.Key), modPrompt, nil)
		_ = e.emit(run.ID, "pipeline.node_evolving", map[string]string{
			"key": n.Key, "modifier_task_id": modID,
		})
		return true
	}
	// Retry with identical subgraph/prompt.
	_ = e.emit(run.ID, "pipeline.node_retry", map[string]string{"key": n.Key})
	_, _ = e.Tasks.Move(tk.ID, tasks.Todo, "pipeline")
	return true
}

// handleVerdict inspects a verdict stage node's latest comment and triggers
// either the per-node split protocol or a stage back-arc on FAIL.
func (e *Engine) handleVerdict(run *RunState, tpl Template, sp StageSpec, n NodeView, tk tasks.Task) bool {
	cs, _ := e.Tasks.Comments(tk.ID)
	var lastID int64
	var body string
	for i := len(cs) - 1; i >= 0; i-- {
		if cs[i].Author != "dispatcher" && cs[i].Author != "pipeline" {
			lastID = cs[i].ID
			body = cs[i].Body
			break
		}
	}
	if lastID == 0 {
		return false
	}
	// Check if we already evaluated this exact comment ID.
	evts, _ := e.Tasks.Events(run.ID, 0, 500)
	for _, ev := range evts {
		if ev.Kind == "pipeline.verdict_checked" {
			var p struct {
				Key       string `json:"key"`
				CommentID int64  `json:"comment_id"`
			}
			_ = json.Unmarshal(ev.Payload, &p)
			if p.Key == n.Key && p.CommentID == lastID {
				return false
			}
		}
	}
	res := ParseResult(body)
	verdict := res.Verdict
	if verdict == "" {
		verdict = "PASS"
	}
	_ = e.emit(run.ID, "pipeline.verdict_checked", map[string]any{
		"key": n.Key, "comment_id": lastID, "verdict": verdict,
	})
	if verdict == "PASS" || !strings.HasPrefix(verdict, "FAIL") {
		return false
	}

	// Case A: Stage has explicit BackArcs (e.g. review -> design or explore).
	if len(sp.BackArcs) > 0 {
		target, ok := sp.BackArcs[verdict]
		if !ok {
			// Fallback to first matching prefix or default FAIL target
			for k, v := range sp.BackArcs {
				if strings.HasPrefix(verdict, k) || k == "FAIL" {
					target = v
					ok = true
					break
				}
			}
		}
		if !ok {
			return false
		}
		if run.ReviewLoops >= run.Budget.MaxReviewLoops {
			now := e.Now().Unix()
			reason := fmt.Sprintf("max_review_loops (%d) exhausted at %s (%s)", run.Budget.MaxReviewLoops, sp.ID, verdict)
			_, _ = e.S.DB.Exec(`UPDATE pipeline_runs SET status='needs_human', reason=?, updated_at=? WHERE id=?`, reason, now, run.ID)
			_ = e.emit(run.ID, "pipeline.needs_human", map[string]string{"reason": reason, "verdict": verdict})
			return true
		}
		_ = e.emit(run.ID, "pipeline.back_arc", map[string]string{
			"from": sp.ID, "to": target, "verdict": verdict, "reason": res.Summary,
		})
		e.triggerBackArc(run, tpl, target, sp.ID, res.Summary)
		return true
	}

	// Case B: `per` cross-examination stage (split protocol: re-run upstream Ci and this RCi).
	if sp.Per != "" {
		suffix := strings.TrimPrefix(n.Key, sp.ID+":")
		upKey := sp.Per + ":" + suffix
		for _, stg := range run.Stages {
			if stg.ID == sp.Per {
				for _, un := range stg.Nodes {
					if un.Key == upKey {
						_ = e.emit(run.ID, "pipeline.stage_reset", map[string]string{"stage": sp.Per, "key": upKey})
						_ = e.emit(run.ID, "pipeline.node_retry", map[string]string{"key": upKey})
						e.requeueTask(un.TaskID)
						_ = e.emit(run.ID, "pipeline.stage_reset", map[string]string{"stage": sp.ID, "key": n.Key})
						e.requeueTask(tk.ID)
						return true
					}
				}
			}
		}
	}
	return false
}

func (e *Engine) triggerBackArc(run *RunState, tpl Template, targetStage, fromStage, reason string) {
	inRange := false
	for _, sp := range tpl.Stages {
		if sp.ID == targetStage {
			inRange = true
		}
		if !inRange {
			continue
		}
		var stg *StageView
		for i := range run.Stages {
			if run.Stages[i].ID == sp.ID {
				stg = &run.Stages[i]
				break
			}
		}
		if stg == nil {
			continue
		}
		// Meta7 rule: when a back-arc targets a fanout exploration stage (WAVE 1),
		// existing exploration nodes are preserved and a new Ci node is appended for
		// the missing context (and paired RCi in the `per` stage), while downstream
		// synthesis/design/review nodes are reset to pending and re-run with old+new combined.
		if sp.ID == targetStage && sp.Fanout != nil {
			nextIdx := len(stg.Nodes) + 1
			newKey := fmt.Sprintf("%s:%d", sp.ID, nextIdx)
			prompt := fmt.Sprintf("%s\n\nGoal: %s\nAdditional context required by review: %s",
				strings.TrimSpace(sp.Prompt), run.Goal, reason)
			newTaskID := e.spawnNode(run, sp.ID, newKey, "main",
				fmt.Sprintf("[%s %d] re-contextualize", sp.ID, nextIdx), prompt, nil)

			// If any downstream stage has `per: targetStage`, spawn its paired RCi node too.
			var newGateTaskIDs []string
			for _, dsp := range tpl.Stages {
				if dsp.Per == sp.ID {
					rcKey := fmt.Sprintf("%s:%d", dsp.ID, nextIdx)
					rcPrompt := fmt.Sprintf("%s\n\n--- Input from %s ---\n(pending re-contextualization)", strings.TrimSpace(dsp.Prompt), newKey)
					rcID := e.spawnNode(run, dsp.ID, rcKey, "main",
						fmt.Sprintf("[%s %d] review %s", dsp.ID, nextIdx, newKey), rcPrompt, []string{newTaskID})
					newGateTaskIDs = append(newGateTaskIDs, rcID)
				}
			}
			if len(newGateTaskIDs) == 0 {
				newGateTaskIDs = []string{newTaskID}
			}
			// Link the next non-per stage's nodes to wait on the newly appended node(s).
			for _, dsp := range tpl.Stages {
				if dsp.ID == sp.ID || dsp.Per == sp.ID {
					continue
				}
				for _, stg2 := range run.Stages {
					if stg2.ID == dsp.ID {
						for _, dn := range stg2.Nodes {
							for _, gid := range newGateTaskIDs {
								_ = e.Tasks.AddDependency(dn.TaskID, gid)
							}
						}
					}
				}
				break
			}
			continue
		}
		if sp.Per == targetStage {
			// Existing RCi nodes for unmodified Ci nodes stay valid.
			continue
		}

		// Reset all main nodes in this stage and requeue them cleanly.
		_ = e.emit(run.ID, "pipeline.stage_reset", map[string]string{"stage": sp.ID})
		for _, n := range stg.Nodes {
			if n.Kind == "main" {
				if sp.ID == targetStage && reason != "" {
					if tk, err := e.Tasks.Get(n.TaskID); err == nil {
						updated := tk.Prompt + "\n\n--- Review Back-Arc Feedback ---\n" + reason
						_, _ = e.Tasks.Update(n.TaskID, tasks.Patch{Prompt: &updated})
					}
				}
				e.requeueTask(n.TaskID)
			}
		}
		if sp.ID == fromStage {
			break
		}
	}
}

func (e *Engine) requeueTask(taskID string) {
	tk, err := e.Tasks.Get(taskID)
	if err != nil {
		return
	}
	switch tk.Status {
	case tasks.Done:
		// Done has no manual transition in tasks.allowed; reset via DB and refresh dependents.
		now := e.Now().Unix()
		_, _ = e.S.DB.Exec(`UPDATE tasks SET status='todo', updated_at=? WHERE id=?`, now, taskID)
		_, _ = e.S.DB.Exec(`INSERT INTO events(task_id,kind,payload,created_at) VALUES(?,?,?,?)`,
			taskID, "task.moved", `{"from":"done","to":"todo","actor":"pipeline"}`, now)
		// Re-block any dependent tasks that were unblocked when this task was done.
		rows, err := e.S.DB.Query(`SELECT task_id FROM task_deps WHERE blocked_by=?`, taskID)
		if err == nil {
			var deps []string
			for rows.Next() {
				var d string
				_ = rows.Scan(&d)
				deps = append(deps, d)
			}
			rows.Close()
			for _, d := range deps {
				_, _ = e.S.DB.Exec(`UPDATE tasks SET status='blocked' WHERE id=? AND status='todo'`, d)
			}
		}
		// Also check if taskID itself has unmet deps.
		var open int
		_ = e.S.DB.QueryRow(`SELECT COUNT(*) FROM task_deps d JOIN tasks t ON t.id=d.blocked_by WHERE d.task_id=? AND t.status<>'done'`, taskID).Scan(&open)
		if open > 0 {
			_, _ = e.S.DB.Exec(`UPDATE tasks SET status='blocked' WHERE id=?`, taskID)
		}
	case tasks.Review, tasks.Failed, tasks.InProgress:
		_, _ = e.Tasks.Move(taskID, tasks.Todo, "pipeline")
	}
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

func init() {
	tasks.OnTaskTerminal = func(s *store.Store, t tasks.Task) {
		if t.RunID == "" {
			return
		}
		if eng, err := New(s); err == nil {
			_, _ = eng.Tick(t.RunID)
		}
	}
}
