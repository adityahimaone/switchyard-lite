package api

import (
	"database/sql"
	"net/http"
	"strings"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/nodes"
)

// flowRetention is how long a finished task stays in the live default window.
const flowRetention = 30 * time.Minute

type flowTask struct {
	TaskID    string   `json:"task_id"`
	Title     string   `json:"title"`
	Board     string   `json:"board"`
	BoardID   string   `json:"board_id"`
	ParentID  string   `json:"parent_id,omitempty"`
	RunID     string   `json:"run_id,omitempty"`
	StageID   string   `json:"stage_id,omitempty"`
	NodeID    string   `json:"node_id"`
	Machine   string   `json:"machine,omitempty"`
	Host      string   `json:"host,omitempty"`
	LatencyMs int64    `json:"latency_ms,omitempty"`
	Executor  string   `json:"executor"`
	Model     string   `json:"model,omitempty"`
	Branch    string   `json:"branch,omitempty"`
	Transport string   `json:"transport"`
	Stage     string   `json:"stage"`
	Status    string   `json:"status"`
	Workspace string   `json:"workspace"`
	BlockedBy []string `json:"blocked_by"`
	UpdatedAt int64    `json:"updated_at"`
}

type flowBoardSummary struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Total  int    `json:"total"`
	Active int    `json:"active"`
}

type flowWorkerSummary struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Path      string `json:"path"`
	Machine   string `json:"machine"`
	Host      string `json:"host,omitempty"`
	Status    string `json:"status"`
	LatencyMs int64  `json:"latency_ms,omitempty"`
}

func flowStage(status string, claimed bool) string {
	switch status {
	case "in_progress":
		if claimed {
			return "running"
		}
		return "dispatched"
	case "review":
		return "review"
	case "done":
		return "done"
	case "failed":
		return "failed"
	case "blocked":
		return "blocked"
	default:
		return "queued"
	}
}

func inferMachine(workspace, host, nodeID string, nodeList []nodes.Node) string {
	lower := strings.ToLower(strings.TrimSpace(workspace))
	if strings.HasPrefix(lower, "/users/") {
		return "mac"
	}
	if (len(lower) >= 2 && lower[1] == ':') || strings.Contains(workspace, `\`) {
		return "windows"
	}
	if n, ok := nodes.Find(nodeList, workspace, ""); ok {
		if m := nodes.MachineOf(n); m != "" {
			return m
		}
	}
	s := strings.ToLower(nodeID + " " + host)
	switch {
	case strings.Contains(s, "mac"), strings.Contains(s, "darwin"):
		return "mac"
	case strings.Contains(s, "win"):
		return "windows"
	default:
		return "linux"
	}
}

func queryFlowTasks(db *sql.DB, boardID, window string, now time.Time) ([]flowTask, error) {
	runQuery := func(where string, args []any, limit int) ([]flowTask, error) {
		q := `SELECT t.id,t.title,t.board_id,COALESCE(b.name,''),
		             COALESCE(t.parent_id,''),COALESCE(t.run_id,''),COALESCE(t.stage_id,''),
		             t.status,t.workspace,t.executor,COALESCE(t.model,''),COALESCE(t.branch,''),
		             t.updated_at,COALESCE(c.worker_id,''),COALESCE(w.transport,'')
		      FROM tasks t
		      LEFT JOIN boards b ON b.id=t.board_id
		      LEFT JOIN dispatch_claims c ON c.task_id=t.id
		      LEFT JOIN task_worktrees w ON w.task_id=t.id`
		clauses := []string{}
		var qArgs []any
		if where != "" {
			clauses = append(clauses, where)
			qArgs = append(qArgs, args...)
		}
		if boardID != "" {
			clauses = append(clauses, `t.board_id=?`)
			qArgs = append(qArgs, boardID)
		}
		if len(clauses) > 0 {
			q += ` WHERE ` + strings.Join(clauses, ` AND `)
		}
		q += ` ORDER BY t.updated_at DESC LIMIT ?`
		qArgs = append(qArgs, limit)

		rows, err := db.Query(q, qArgs...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()

		out := []flowTask{}
		for rows.Next() {
			var t flowTask
			var workerID, transport string
			if err := rows.Scan(
				&t.TaskID, &t.Title, &t.BoardID, &t.Board,
				&t.ParentID, &t.RunID, &t.StageID,
				&t.Status, &t.Workspace, &t.Executor, &t.Model, &t.Branch,
				&t.UpdatedAt, &workerID, &transport,
			); err != nil {
				continue
			}
			t.BlockedBy = []string{}
			t.Transport = "http"
			if transport == "worker" {
				t.Transport = "worker"
			}
			t.Stage = flowStage(t.Status, workerID != "")
			out = append(out, t)
		}
		return out, rows.Err()
	}

	switch window {
	case "30m":
		return runQuery(`t.updated_at >= ?`, []any{now.Add(-flowRetention).Unix()}, 200)
	case "24h":
		return runQuery(`t.updated_at >= ?`, []any{now.Add(-24 * time.Hour).Unix()}, 200)
	case "7d":
		return runQuery(`t.updated_at >= ?`, []any{now.Add(-7 * 24 * time.Hour).Unix()}, 200)
	case "all":
		return runQuery("", nil, 200)
	default: // "" / "smart": active tasks or updated recently, falling back to recent tasks if empty.
		tasks, err := runQuery(
			`(t.updated_at >= ? OR t.status IN ('in_progress','review','todo','blocked'))`,
			[]any{now.Add(-flowRetention).Unix()},
			200,
		)
		if err != nil || len(tasks) > 0 {
			return tasks, err
		}
		return runQuery("", nil, 100)
	}
}

func queryFlowBoards(db *sql.DB) []flowBoardSummary {
	out := []flowBoardSummary{}
	rows, err := db.Query(`
		SELECT b.id, b.name, COUNT(t.id),
		       COALESCE(SUM(CASE WHEN t.status IN ('in_progress','review','todo','blocked') THEN 1 ELSE 0 END), 0)
		FROM boards b
		LEFT JOIN tasks t ON t.board_id = b.id
		GROUP BY b.id, b.name
		ORDER BY b.created_at ASC
	`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var b flowBoardSummary
		if rows.Scan(&b.ID, &b.Name, &b.Total, &b.Active) == nil {
			out = append(out, b)
		}
	}
	return out
}

// registerFlow adds GET /api/v1/flow/active. It powers the global multi-board
// flow map: active & recent tasks, board rollups, and registered/live worker hosts.
func init() {
	registrars = append(registrars, func(m *http.ServeMux, a *API) {
		m.HandleFunc("GET /api/v1/flow/active", a.require("read", func(w http.ResponseWriter, r *http.Request) {
			x, err := getDeps(a)
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			boardID := strings.TrimSpace(r.URL.Query().Get("board_id"))
			window := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("window")))
			now := time.Now()

			out, err := queryFlowTasks(a.S.DB, boardID, window, now)
			if err != nil {
				fail(w, 500, err.Error())
				return
			}

			nodeList, _ := x.n.List(r.Context())
			wsRecords, _ := queryWorkspaces(r.Context(), a, x.n, x.c)

			wsByPath := make(map[string]workspaceRecord, len(wsRecords))
			workersOut := make([]flowWorkerSummary, 0, len(wsRecords)+len(nodeList))
			seenNodes := map[string]bool{}
			for _, ws := range wsRecords {
				wsByPath[nodes.Normalize(ws.Path)] = ws
				mKind := ws.Machine
				if mKind == "" || mKind == "current" {
					mKind = inferMachine(ws.Path, ws.Host, ws.Node, nodeList)
				}
				if ws.Node != "" {
					seenNodes[ws.Node] = true
				}
				workersOut = append(workersOut, flowWorkerSummary{
					ID:        ws.ID,
					Name:      ws.Name,
					Path:      ws.Path,
					Machine:   mKind,
					Host:      ws.Host,
					Status:    ws.Status,
					LatencyMs: ws.LatencyMs,
				})
			}
			for _, n := range nodeList {
				if seenNodes[n.NodeID] {
					continue
				}
				status := "unreachable"
				if n.Fresh(now) {
					status = "connected"
				}
				mKind := nodes.MachineOf(n)
				if mKind == "" {
					mKind = inferMachine("", n.Hostname, n.NodeID, nodeList)
				}
				path := ""
				if len(n.Workspaces) > 0 {
					path = n.Workspaces[0]
				}
				workersOut = append(workersOut, flowWorkerSummary{
					ID:      "node:" + n.NodeID,
					Name:    n.NodeID,
					Path:    path,
					Machine: mKind,
					Host:    n.Hostname,
					Status:  status,
				})
			}

			for i := range out {
				t := &out[i]
				if ws, ok := wsByPath[nodes.Normalize(t.Workspace)]; ok {
					t.Host = ws.Host
					t.LatencyMs = ws.LatencyMs
					if ws.Node != "" {
						t.NodeID = ws.Node
					}
					if ws.Machine != "" && ws.Machine != "current" {
						t.Machine = ws.Machine
					}
				}
				if t.Workspace != "" && t.NodeID == "" {
					if n, ok := nodes.Find(nodeList, t.Workspace, t.Machine); ok {
						t.NodeID = n.NodeID
					}
				}
				if t.Machine == "" || t.Machine == "current" {
					t.Machine = inferMachine(t.Workspace, t.Host, t.NodeID, nodeList)
				}
			}

			// One query for all dependency edges avoids an N+1 per visible task.
			depRows, err := a.S.DB.Query(`SELECT task_id, blocked_by FROM task_deps`)
			if err == nil {
				defer depRows.Close()
				byID := map[string]*flowTask{}
				for i := range out {
					byID[out[i].TaskID] = &out[i]
				}
				for depRows.Next() {
					var id, dep string
					if depRows.Scan(&id, &dep) == nil {
						if t := byID[id]; t != nil {
							t.BlockedBy = append(t.BlockedBy, dep)
						}
					}
				}
			}

			boardsOut := queryFlowBoards(a.S.DB)
			ok(w, map[string]any{
				"tasks":             out,
				"boards":            boardsOut,
				"workers":           workersOut,
				"retention_seconds": int(flowRetention.Seconds()),
			})
		}))
	})
}
