package tasks

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// TaskQuestion represents an interactive open question / grill-me prompt
// attached to a Kanban card, supporting multiple-choice options and custom replies.
type TaskQuestion struct {
	ID              string   `json:"id"`
	TaskID          string   `json:"task_id"`
	Question        string   `json:"question"`
	Options         []string `json:"options"`
	MultiSelect     bool     `json:"multi_select,omitempty"`
	Context         string   `json:"context,omitempty"`
	Author          string   `json:"author,omitempty"`
	Status          string   `json:"status"` // "pending" | "answered" | "dismissed"
	Answer          string   `json:"answer,omitempty"`
	SelectedOptions []string `json:"selected_options,omitempty"`
	AnsweredBy      string   `json:"answered_by,omitempty"`
	CreatedAt       int64    `json:"created_at"`
	AnsweredAt      int64    `json:"answered_at,omitempty"`
}

// AskQuestionInput creates a new interactive question on a task.
type AskQuestionInput struct {
	Question    string   `json:"question"`
	Options     []string `json:"options,omitempty"`
	MultiSelect bool     `json:"multi_select,omitempty"`
	Context     string   `json:"context,omitempty"`
	Author      string   `json:"author,omitempty"`
}

// AnswerQuestionInput records the user's or agent's chosen option/answer.
type AnswerQuestionInput struct {
	QuestionID      string   `json:"question_id,omitempty"`
	SelectedOptions []string `json:"selected_options,omitempty"`
	Answer          string   `json:"answer,omitempty"`
	Author          string   `json:"author,omitempty"`
}

// AskQuestion attaches a pending question with selectable choices to a task.
func (v *Service) AskQuestion(taskID string, in AskQuestionInput) (TaskQuestion, error) {
	qText := strings.TrimSpace(in.Question)
	if qText == "" {
		return TaskQuestion{}, fmt.Errorf("%w: question required", ErrBadRequest)
	}
	if _, err := v.Get(taskID); err != nil {
		return TaskQuestion{}, err
	}
	opts := cleanStringSlice(in.Options)
	author := strings.TrimSpace(in.Author)
	if author == "" {
		author = "agent"
	}
	now := v.Now().Unix()
	q := TaskQuestion{
		ID:          newID("q"),
		TaskID:      taskID,
		Question:    qText,
		Options:     opts,
		MultiSelect: in.MultiSelect,
		Context:     strings.TrimSpace(in.Context),
		Author:      author,
		Status:      "pending",
		CreatedAt:   now,
	}

	tx, err := v.S.DB.Begin()
	if err != nil {
		return TaskQuestion{}, err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`UPDATE task_questions SET status='dismissed' WHERE task_id=? AND status='pending'`, taskID); err != nil {
		return TaskQuestion{}, err
	}
	multiInt := 0
	if q.MultiSelect {
		multiInt = 1
	}
	if _, err := tx.Exec(
		`INSERT INTO task_questions(id,task_id,question,options,multi_select,context,author,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
		q.ID, taskID, q.Question, encodeList(q.Options), multiInt, q.Context, q.Author, q.Status, now,
	); err != nil {
		return TaskQuestion{}, err
	}

	rawQ, _ := json.Marshal(q)
	if _, err := tx.Exec(`UPDATE tasks SET question_json=?, updated_at=? WHERE id=?`, string(rawQ), now, taskID); err != nil {
		return TaskQuestion{}, err
	}

	var commentLines []string
	commentLines = append(commentLines, "[OPEN QUESTION] "+q.Question)
	if q.Context != "" {
		commentLines = append(commentLines, q.Context)
	}
	for i, opt := range q.Options {
		commentLines = append(commentLines, fmt.Sprintf("%d. %s", i+1, opt))
	}
	_, _ = tx.Exec(`INSERT INTO comments(task_id,author,body,created_at) VALUES(?,?,?,?)`,
		taskID, author, strings.Join(commentLines, "\n"), now)

	if err := v.event(tx, taskID, "question.asked", map[string]any{
		"question_id":  q.ID,
		"question":     q.Question,
		"options":      q.Options,
		"multi_select": q.MultiSelect,
		"author":       q.Author,
	}); err != nil {
		return TaskQuestion{}, err
	}
	if err := tx.Commit(); err != nil {
		return TaskQuestion{}, err
	}
	return q, nil
}

// ListQuestions returns all questions for a task, newest first.
func (v *Service) ListQuestions(taskID string) ([]TaskQuestion, error) {
	if _, err := v.Get(taskID); err != nil {
		return nil, err
	}
	rows, err := v.S.DB.Query(
		`SELECT id,task_id,question,COALESCE(options,'[]'),multi_select,COALESCE(context,''),COALESCE(author,'agent'),status,COALESCE(answer,''),COALESCE(selected_options,'[]'),COALESCE(answered_by,''),created_at,COALESCE(answered_at,0)
		FROM task_questions WHERE task_id=? ORDER BY created_at DESC, rowid DESC`,
		taskID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TaskQuestion{}
	for rows.Next() {
		q, err := scanQuestion(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, q)
	}
	return out, rows.Err()
}

// AnswerQuestion marks the targeted (or latest pending) question answered and clears the card's pending prompt.
func (v *Service) AnswerQuestion(taskID string, in AnswerQuestionInput) (TaskQuestion, Task, error) {
	selected := cleanStringSlice(in.SelectedOptions)
	custom := strings.TrimSpace(in.Answer)
	if len(selected) == 0 && custom == "" {
		return TaskQuestion{}, Task{}, fmt.Errorf("%w: answer or selected_options required", ErrBadRequest)
	}
	finalAnswer := custom
	if len(selected) > 0 {
		joined := strings.Join(selected, ", ")
		if custom != "" && custom != joined {
			finalAnswer = joined + " — " + custom
		} else {
			finalAnswer = joined
		}
	}
	answeredBy := strings.TrimSpace(in.Author)
	if answeredBy == "" {
		answeredBy = "user"
	}

	tx, err := v.S.DB.Begin()
	if err != nil {
		return TaskQuestion{}, Task{}, err
	}
	defer tx.Rollback()

	var q TaskQuestion
	var qID = strings.TrimSpace(in.QuestionID)
	if qID != "" {
		q, err = scanQuestion(tx.QueryRow(
			`SELECT id,task_id,question,COALESCE(options,'[]'),multi_select,COALESCE(context,''),COALESCE(author,'agent'),status,COALESCE(answer,''),COALESCE(selected_options,'[]'),COALESCE(answered_by,''),created_at,COALESCE(answered_at,0)
			FROM task_questions WHERE id=? AND task_id=?`,
			qID, taskID,
		))
	} else {
		q, err = scanQuestion(tx.QueryRow(
			`SELECT id,task_id,question,COALESCE(options,'[]'),multi_select,COALESCE(context,''),COALESCE(author,'agent'),status,COALESCE(answer,''),COALESCE(selected_options,'[]'),COALESCE(answered_by,''),created_at,COALESCE(answered_at,0)
			FROM task_questions WHERE task_id=? AND status='pending' ORDER BY created_at DESC, rowid DESC LIMIT 1`,
			taskID,
		))
	}
	if errors.Is(err, sql.ErrNoRows) {
		return TaskQuestion{}, Task{}, fmt.Errorf("%w: pending question", ErrNotFound)
	}
	if err != nil {
		return TaskQuestion{}, Task{}, err
	}

	now := v.Now().Unix()
	q.Status = "answered"
	q.Answer = finalAnswer
	q.SelectedOptions = selected
	q.AnsweredBy = answeredBy
	q.AnsweredAt = now

	if _, err := tx.Exec(
		`UPDATE task_questions SET status='answered', answer=?, selected_options=?, answered_by=?, answered_at=? WHERE id=?`,
		q.Answer, encodeList(q.SelectedOptions), q.AnsweredBy, now, q.ID,
	); err != nil {
		return TaskQuestion{}, Task{}, err
	}

	// Only clear tasks.question_json if it corresponds to this question (or leave cleared so pending bar disappears).
	if _, err := tx.Exec(`UPDATE tasks SET question_json='', updated_at=? WHERE id=?`, now, taskID); err != nil {
		return TaskQuestion{}, Task{}, err
	}

	_, _ = tx.Exec(`INSERT INTO comments(task_id,author,body,created_at) VALUES(?,?,?,?)`,
		taskID, answeredBy, fmt.Sprintf("Selected answer for \"%s\": %s", q.Question, q.Answer), now)

	if err := v.event(tx, taskID, "question.answered", map[string]any{
		"question_id":      q.ID,
		"question":         q.Question,
		"answer":           q.Answer,
		"selected_options": q.SelectedOptions,
		"answered_by":      q.AnsweredBy,
	}); err != nil {
		return TaskQuestion{}, Task{}, err
	}
	if err := tx.Commit(); err != nil {
		return TaskQuestion{}, Task{}, err
	}
	t, err := v.Get(taskID)
	return q, t, err
}

func scanQuestion(r interface{ Scan(...any) error }) (TaskQuestion, error) {
	var q TaskQuestion
	var optsRaw, selRaw string
	var multiInt int
	err := r.Scan(
		&q.ID, &q.TaskID, &q.Question, &optsRaw, &multiInt,
		&q.Context, &q.Author, &q.Status, &q.Answer, &selRaw, &q.AnsweredBy, &q.CreatedAt, &q.AnsweredAt,
	)
	q.MultiSelect = multiInt == 1
	q.Options = decodeList(optsRaw)
	q.SelectedOptions = decodeList(selRaw)
	return q, err
}

func cleanStringSlice(in []string) []string {
	out := make([]string, 0, len(in))
	seen := map[string]bool{}
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}
