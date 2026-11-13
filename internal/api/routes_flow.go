package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/nodes"
)

// flowRetention is how long a finished task stays on the live flow map.
const flowRetention = 30 * time.Minute

type flowTask struct {
	TaskID    string   `json:"task_id"`
	Title     string   `json:"title"`
	Board     string   `json:"board"`
	BoardID   string   `json:"board_id"`
	NodeID    string   `json:"node_id"`
	Executor  string   `json:"executor"`
	Transport string   `json:"transport"`
	Stage     string   `json:"stage"`
	Status    string   `json:"status"`
	Workspace string   `json:"workspace"`
	BlockedBy []string `json:"blocked_by"`
	UpdatedAt int64    `json:"updated_at"`
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

// registerFlow adds GET /api/v1/flow/active. It is the switchyard-lite
// equivalent of kanban-board's /api/flow/active: a live view of which node is
// working on what, derived from the task/claim/worktree tables rather than a
// second in-memory tracker.
func init() {
	registrars = append(registrars, func(m *http.ServeMux, a *API) {
		m.HandleFunc("GET /api/v1/flow/active", a.require("read", func(w http.ResponseWriter, r *http.Request) {
			x, err := getDeps(a)
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			boardID := strings.TrimSpace(r.URL.Query().Get("board_id"))
			q := `SELECT t.id,t.title,t.board_id,COALESCE(b.name,''),t.status,t.workspace,t.executor,
			             t.updated_at,COALESCE(c.worker_id,''),COALESCE(w.transport,'')
			      FROM tasks t
			      LEFT JOIN boards b ON b.id=t.board_id
			      LEFT JOIN dispatch_claims c ON c.task_id=t.id
			      LEFT JOIN task_worktrees w ON w.task_id=t.id
			      WHERE t.updated_at >= ?`
			args := []any{time.Now().Add(-flowRetention).Unix()}
			if boardID != "" {
				q += ` AND t.board_id=?`
				args = append(args, boardID)
			}
			q += ` ORDER BY t.updated_at DESC LIMIT 200`
			rows, err := a.S.DB.Query(q, args...)
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			defer rows.Close()

			nodeList, _ := x.n.List(r.Context())
			out := []flowTask{}
			for rows.Next() {
				var t flowTask
				var workerID, transport string
				if err := rows.Scan(&t.TaskID, &t.Title, &t.BoardID, &t.Board, &t.Status,
					&t.Workspace, &t.Executor, &t.UpdatedAt, &workerID, &transport); err != nil {
					continue
				}
				t.BlockedBy = []string{}
				t.Transport = "http"
				if transport == "worker" {
					t.Transport = "worker"
				}
				// dispatch_claims.worker_id is the control-plane dispatcher, not
				// the worker that runs the code. Resolve the owning node from
				// the node-agent report instead.
				t.NodeID = ""
				if t.Workspace != "" {
					if n, ok := nodes.Find(nodeList, t.Workspace, ""); ok {
						t.NodeID = n.NodeID
					}
				}
				t.Stage = flowStage(t.Status, workerID != "")
				out = append(out, t)
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
			ok(w, map[string]any{"tasks": out, "retention_seconds": int(flowRetention.Seconds())})
		}))
	})
}
