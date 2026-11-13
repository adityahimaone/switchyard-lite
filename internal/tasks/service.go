// Package tasks implements boards, tasks, dependencies, comments and the
// status machine. Every mutation writes an event in the same transaction.
package tasks

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/store"
)

const (
	Backlog    = "backlog"
	Todo       = "todo"
	Blocked    = "blocked"
	InProgress = "in_progress"
	Review     = "review"
	Done       = "done"
	Failed     = "failed"
)

var (
	ErrNotFound   = errors.New("not found")
	ErrBadMove    = errors.New("invalid status transition")
	ErrCycle      = errors.New("dependency cycle")
	ErrBadRequest = errors.New("bad request")
)

// allowed lists legal manual/engine transitions.
var allowed = map[string][]string{
	Backlog:    {Todo},
	Todo:       {Backlog, Blocked, InProgress},
	Blocked:    {Todo},
	InProgress: {Review, Todo, Failed},
	Review:     {Done, Todo},
	Failed:     {Todo},
	Done:       {},
}

type Board struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	DefaultExecutor string `json:"default_executor"`
	DefaultModel    string `json:"default_model"`
}

type Task struct {
	ID         string   `json:"id"`
	BoardID    string   `json:"board_id"`
	ParentID   string   `json:"parent_id,omitempty"`
	RunID      string   `json:"run_id,omitempty"`
	StageID    string   `json:"stage_id,omitempty"`
	Title      string   `json:"title"`
	Prompt     string   `json:"prompt"`
	Acceptance string   `json:"acceptance,omitempty"`
	Status     string   `json:"status"`
	Workspace  string   `json:"workspace,omitempty"`
	Executor   string   `json:"executor,omitempty"`
	Model      string   `json:"model,omitempty"`
	Effort     string   `json:"effort,omitempty"`
	RetryCount int      `json:"retry_count"`
	BlockedBy  []string `json:"blocked_by"`
	CreatedAt  int64    `json:"created_at"`
	UpdatedAt  int64    `json:"updated_at"`
}

type NewTask struct {
	BoardID, ParentID, Title, Prompt, Acceptance, Status, Workspace, Executor, Model, Effort string
	BlockedBy                                                                                []string
}

type Service struct {
	S   *store.Store
	Now func() time.Time
}

func New(s *store.Store) *Service { return &Service{S: s, Now: time.Now} }

func newID(prefix string) string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}

func (v *Service) event(tx *sql.Tx, taskID, kind string, payload any) error {
	b, _ := json.Marshal(payload)
	_, err := tx.Exec(`INSERT INTO events(task_id,kind,payload,created_at) VALUES(?,?,?,?)`,
		taskID, kind, string(b), v.Now().Unix())
	return err
}

func (v *Service) CreateBoard(name string) (Board, error) {
	return v.CreateBoardWithDefaults(name, "", "")
}

func (v *Service) CreateBoardWithDefaults(name, defaultExecutor, defaultModel string) (Board, error) {
	if name == "" {
		return Board{}, fmt.Errorf("%w: name required", ErrBadRequest)
	}
	b := Board{ID: newID("b"), Name: name, DefaultExecutor: defaultExecutor, DefaultModel: defaultModel}
	_, err := v.S.DB.Exec(`INSERT INTO boards(id,name,default_executor,default_model,created_at) VALUES(?,?,?,?,?)`,
		b.ID, name, defaultExecutor, defaultModel, v.Now().Unix())
	return b, err
}

func (v *Service) UpdateBoard(id, name, defaultExecutor, defaultModel string) (Board, error) {
	if name == "" {
		return Board{}, fmt.Errorf("%w: name required", ErrBadRequest)
	}
	res, err := v.S.DB.Exec(`UPDATE boards SET name=?, default_executor=?, default_model=? WHERE id=?`,
		name, defaultExecutor, defaultModel, id)
	if err != nil {
		return Board{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Board{}, fmt.Errorf("%w: board", ErrNotFound)
	}
	return Board{ID: id, Name: name, DefaultExecutor: defaultExecutor, DefaultModel: defaultModel}, nil
}

func (v *Service) DeleteBoard(id string) error {
	res, err := v.S.DB.Exec(`DELETE FROM boards WHERE id=?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("%w: board", ErrNotFound)
	}
	return nil
}

func (v *Service) ListBoards() ([]Board, error) {
	rows, err := v.S.DB.Query(`SELECT id,name,default_executor,default_model FROM boards ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Board{}
	for rows.Next() {
		var b Board
		if err := rows.Scan(&b.ID, &b.Name, &b.DefaultExecutor, &b.DefaultModel); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (v *Service) Create(n NewTask) (Task, error) {
	if n.Title == "" || n.BoardID == "" {
		return Task{}, fmt.Errorf("%w: title and board_id required", ErrBadRequest)
	}
	tx, err := v.S.DB.Begin()
	if err != nil {
		return Task{}, err
	}
	defer tx.Rollback()
	var def struct{ ex, mo string }
	if err := tx.QueryRow(`SELECT default_executor,default_model FROM boards WHERE id=?`, n.BoardID).Scan(&def.ex, &def.mo); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Task{}, fmt.Errorf("%w: board", ErrNotFound)
		}
		return Task{}, err
	}
	if n.Executor == "" {
		n.Executor = def.ex
		if n.Model == "" {
			n.Model = def.mo
		}
	}
	id := newID("t")
	now := v.Now().Unix()
	initialStatus := Todo
	if n.Status == Backlog {
		initialStatus = Backlog
	}
	_, err = tx.Exec(`INSERT INTO tasks(id,board_id,parent_id,title,prompt,acceptance,status,workspace,executor,model,effort,created_at,updated_at)
		VALUES(?,?,NULLIF(?,''),?,?,?,?,?,?,?,?,?,?)`,
		id, n.BoardID, n.ParentID, n.Title, n.Prompt, n.Acceptance, initialStatus, n.Workspace, n.Executor, n.Model, n.Effort, now, now)
	if err != nil {
		return Task{}, err
	}
	for _, dep := range n.BlockedBy {
		if err := addDep(tx, id, dep); err != nil {
			return Task{}, err
		}
	}
	if err := refreshBlocked(tx, id); err != nil {
		return Task{}, err
	}
	if err := v.event(tx, id, "task.created", map[string]string{"title": n.Title}); err != nil {
		return Task{}, err
	}
	if err := tx.Commit(); err != nil {
		return Task{}, err
	}
	return v.Get(id)
}

const cols = `id,board_id,COALESCE(parent_id,''),run_id,stage_id,title,prompt,acceptance,status,workspace,executor,model,effort,retry_count,created_at,updated_at`

func scan(r interface{ Scan(...any) error }) (Task, error) {
	var t Task
	err := r.Scan(&t.ID, &t.BoardID, &t.ParentID, &t.RunID, &t.StageID, &t.Title, &t.Prompt, &t.Acceptance,
		&t.Status, &t.Workspace, &t.Executor, &t.Model, &t.Effort, &t.RetryCount, &t.CreatedAt, &t.UpdatedAt)
	t.BlockedBy = []string{}
	return t, err
}

func (v *Service) deps(id string) []string {
	out := []string{}
	rows, err := v.S.DB.Query(`SELECT blocked_by FROM task_deps WHERE task_id=?`, id)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var d string
		if rows.Scan(&d) == nil {
			out = append(out, d)
		}
	}
	return out
}

func (v *Service) Get(id string) (Task, error) {
	t, err := scan(v.S.DB.QueryRow(`SELECT `+cols+` FROM tasks WHERE id=?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return t, ErrNotFound
	}
	if err == nil {
		t.BlockedBy = v.deps(id)
	}
	return t, err
}

// List returns tasks of a board, optionally filtered by status.
func (v *Service) List(boardID, status string) ([]Task, error) {
	q := `SELECT ` + cols + ` FROM tasks WHERE board_id=?`
	args := []any{boardID}
	if status != "" {
		q += ` AND status=?`
		args = append(args, status)
	}
	rows, err := v.S.DB.Query(q+` ORDER BY created_at, id`, args...)
	if err != nil {
		return nil, err
	}
	var out []Task
	for rows.Next() {
		t, err := scan(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, t)
	}
	rows.Close()
	for i := range out {
		out[i].BlockedBy = v.deps(out[i].ID)
	}
	if out == nil {
		out = []Task{}
	}
	return out, nil
}

// Move applies a status transition and unblocks dependents when a task is done.
func (v *Service) Move(id, to, actor string) (Task, error) {
	tx, err := v.S.DB.Begin()
	if err != nil {
		return Task{}, err
	}
	defer tx.Rollback()
	var from string
	if err := tx.QueryRow(`SELECT status FROM tasks WHERE id=?`, id).Scan(&from); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Task{}, ErrNotFound
		}
		return Task{}, err
	}
	ok := false
	for _, s := range allowed[from] {
		ok = ok || s == to
	}
	if !ok {
		return Task{}, fmt.Errorf("%w: %s -> %s", ErrBadMove, from, to)
	}
	if to == Todo || to == InProgress {
		var open int
		_ = tx.QueryRow(`SELECT COUNT(*) FROM task_deps d JOIN tasks t ON t.id=d.blocked_by WHERE d.task_id=? AND t.status<>'done'`, id).Scan(&open)
		if open > 0 {
			to = Blocked
		}
	}
	if _, err := tx.Exec(`UPDATE tasks SET status=?,updated_at=? WHERE id=?`, to, v.Now().Unix(), id); err != nil {
		return Task{}, err
	}
	if err := v.event(tx, id, "task.moved", map[string]string{"from": from, "to": to, "actor": actor}); err != nil {
		return Task{}, err
	}
	if to == Done {
		rows, err := tx.Query(`SELECT task_id FROM task_deps WHERE blocked_by=?`, id)
		if err != nil {
			return Task{}, err
		}
		var dependents []string
		for rows.Next() {
			var d string
			_ = rows.Scan(&d)
			dependents = append(dependents, d)
		}
		rows.Close()
		for _, d := range dependents {
			if err := refreshBlocked(tx, d); err != nil {
				return Task{}, err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return Task{}, err
	}
	t, err := v.Get(id)
	if err == nil && actor != "pipeline" && t.RunID != "" && OnTaskTerminal != nil {
		if t.Status == Review || t.Status == Done || t.Status == Failed {
			OnTaskTerminal(v.S, t)
		}
	}
	return t, err
}

// OnTaskTerminal is an optional hook fired when a pipeline task reaches review, done, or failed.
var OnTaskTerminal func(s *store.Store, t Task)

// refreshBlocked flips a todo/blocked task according to its open dependencies.
func refreshBlocked(tx *sql.Tx, id string) error {
	var open int
	var status string
	if err := tx.QueryRow(`SELECT status FROM tasks WHERE id=?`, id).Scan(&status); err != nil {
		return err
	}
	if status != Todo && status != Blocked {
		return nil
	}
	if err := tx.QueryRow(`SELECT COUNT(*) FROM task_deps d JOIN tasks t ON t.id=d.blocked_by WHERE d.task_id=? AND t.status<>'done'`, id).Scan(&open); err != nil {
		return err
	}
	next := Todo
	if open > 0 {
		next = Blocked
	}
	_, err := tx.Exec(`UPDATE tasks SET status=? WHERE id=?`, next, id)
	return err
}

func addDep(tx *sql.Tx, task, blockedBy string) error {
	if task == blockedBy {
		return ErrCycle
	}
	// cycle if `task` is reachable from `blockedBy` through blocked_by edges
	var hit int
	err := tx.QueryRow(`WITH RECURSIVE up(id) AS (
		SELECT ? UNION SELECT d.blocked_by FROM task_deps d JOIN up ON d.task_id=up.id)
		SELECT COUNT(*) FROM up WHERE id=?`, blockedBy, task).Scan(&hit)
	if err != nil {
		return err
	}
	if hit > 0 {
		return ErrCycle
	}
	var exists int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM tasks WHERE id=?`, blockedBy).Scan(&exists); err != nil || exists == 0 {
		return fmt.Errorf("%w: dependency %s", ErrNotFound, blockedBy)
	}
	_, err = tx.Exec(`INSERT OR IGNORE INTO task_deps(task_id,blocked_by) VALUES(?,?)`, task, blockedBy)
	return err
}

func (v *Service) AddDependency(task, blockedBy string) error {
	tx, err := v.S.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := addDep(tx, task, blockedBy); err != nil {
		return err
	}
	if err := refreshBlocked(tx, task); err != nil {
		return err
	}
	if err := v.event(tx, task, "task.dep_added", map[string]string{"blocked_by": blockedBy}); err != nil {
		return err
	}
	return tx.Commit()
}

type Comment struct {
	ID        int64  `json:"id"`
	TaskID    string `json:"task_id"`
	Author    string `json:"author"`
	Body      string `json:"body"`
	CreatedAt int64  `json:"created_at"`
}

func (v *Service) AddComment(taskID, author, body string) (Comment, error) {
	if body == "" {
		return Comment{}, fmt.Errorf("%w: body required", ErrBadRequest)
	}
	if _, err := v.Get(taskID); err != nil {
		return Comment{}, err
	}
	now := v.Now().Unix()
	res, err := v.S.DB.Exec(`INSERT INTO comments(task_id,author,body,created_at) VALUES(?,?,?,?)`, taskID, author, body, now)
	if err != nil {
		return Comment{}, err
	}
	id, _ := res.LastInsertId()
	_, _ = v.S.DB.Exec(`INSERT INTO events(task_id,kind,payload,created_at) VALUES(?,?,?,?)`, taskID, "comment.added", `{}`, now)
	return Comment{id, taskID, author, body, now}, nil
}

func (v *Service) Comments(taskID string) ([]Comment, error) {
	rows, err := v.S.DB.Query(`SELECT id,task_id,author,body,created_at FROM comments WHERE task_id=? ORDER BY id`, taskID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Comment{}
	for rows.Next() {
		var c Comment
		if err := rows.Scan(&c.ID, &c.TaskID, &c.Author, &c.Body, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

type Event struct {
	ID        int64           `json:"id"`
	TaskID    string          `json:"task_id"`
	Kind      string          `json:"kind"`
	Payload   json.RawMessage `json:"payload"`
	CreatedAt int64           `json:"created_at"`
}

// Events returns events after `since` (exclusive), optionally for one task.
func (v *Service) Events(taskID string, since int64, limit int) ([]Event, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	q := `SELECT id,task_id,kind,payload,created_at FROM events WHERE id>?`
	args := []any{since}
	if taskID != "" {
		q += ` AND task_id=?`
		args = append(args, taskID)
	}
	rows, err := v.S.DB.Query(q+` ORDER BY id LIMIT ?`, append(args, limit)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Event{}
	for rows.Next() {
		var e Event
		var p string
		if err := rows.Scan(&e.ID, &e.TaskID, &e.Kind, &p, &e.CreatedAt); err != nil {
			return nil, err
		}
		e.Payload = json.RawMessage(p)
		out = append(out, e)
	}
	return out, rows.Err()
}
