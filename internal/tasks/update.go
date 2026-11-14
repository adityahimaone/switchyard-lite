package tasks

import (
	"database/sql"
	"errors"
	"fmt"
)

// Patch holds optional task field updates; nil means unchanged.
type Patch struct {
	Title         *string   `json:"title"`
	Prompt        *string   `json:"prompt"`
	Acceptance    *string   `json:"acceptance"`
	Workspace     *string   `json:"workspace"`
	Executor      *string   `json:"executor"`
	Model         *string   `json:"model"`
	Effort        *string   `json:"effort"`
	Branch        *string   `json:"branch"`
	ExecutionMode *string   `json:"execution_mode"`
	Paths         *[]string `json:"paths"`
	Skills        *[]string `json:"skills"`
}

// Update applies the non-nil fields of p to the task and records an event.
func (v *Service) Update(id string, p Patch) (Task, error) {
	if p.Title != nil && *p.Title == "" {
		return Task{}, fmt.Errorf("%w: title cannot be empty", ErrBadRequest)
	}
	if p.ExecutionMode != nil {
		norm := NormalizeExecutionMode(*p.ExecutionMode)
		if norm == "" {
			return Task{}, fmt.Errorf("%w: invalid execution_mode %q", ErrBadRequest, *p.ExecutionMode)
		}
		p.ExecutionMode = &norm
	}
	sets := []struct {
		col string
		val *string
	}{{"title", p.Title}, {"prompt", p.Prompt}, {"acceptance", p.Acceptance}, {"workspace", p.Workspace},
		{"executor", p.Executor}, {"model", p.Model}, {"effort", p.Effort}, {"branch", p.Branch},
		{"execution_mode", p.ExecutionMode}}
	tx, err := v.S.DB.Begin()
	if err != nil {
		return Task{}, err
	}
	defer tx.Rollback()
	var x string
	if err := tx.QueryRow(`SELECT id FROM tasks WHERE id=?`, id).Scan(&x); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Task{}, fmt.Errorf("%w: task", ErrNotFound)
		}
		return Task{}, err
	}
	changed := []string{}
	for _, s := range sets {
		if s.val == nil {
			continue
		}
		if _, err := tx.Exec(`UPDATE tasks SET `+s.col+`=? WHERE id=?`, *s.val, id); err != nil {
			return Task{}, err
		}
		changed = append(changed, s.col)
	}
	for _, s := range []struct {
		col string
		val *[]string
	}{{"paths", p.Paths}, {"skills", p.Skills}} {
		if s.val == nil {
			continue
		}
		if _, err := tx.Exec(`UPDATE tasks SET `+s.col+`=? WHERE id=?`, encodeList(*s.val), id); err != nil {
			return Task{}, err
		}
		changed = append(changed, s.col)
	}
	if len(changed) > 0 {
		if _, err := tx.Exec(`UPDATE tasks SET updated_at=? WHERE id=?`, v.Now().Unix(), id); err != nil {
			return Task{}, err
		}
		if err := v.event(tx, id, "task.updated", map[string]any{"fields": changed}); err != nil {
			return Task{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return Task{}, err
	}
	return v.Get(id)
}
