package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/logs"
	"github.com/adityahimaone/switchyard-lite/internal/tasks"
)

func init() {
	registrars = append(registrars, func(m *http.ServeMux, a *API) {
		m.HandleFunc("GET /api/v1/logs/sources", a.require("read", func(w http.ResponseWriter, r *http.Request) {
			ok(w, map[string]any{"sources": logs.Sources()})
		}))
		m.HandleFunc("GET /api/v1/logs", a.require("read", func(w http.ResponseWriter, r *http.Request) {
			q := r.URL.Query()
			tail, _ := strconv.Atoi(q.Get("tail"))
			key := strings.TrimSpace(q.Get("file"))
			if key == "" {
				key = "activity"
			}
			if key == "activity" {
				lines, err := activityLines(a, logs.NormalizeTail(tail))
				if err != nil {
					fail(w, 500, err.Error())
					return
				}
				ok(w, logs.FromLines(lines, q.Get("q"), tail))
				return
			}
			t, err := logs.Read(key, q.Get("q"), tail)
			if err != nil {
				fail(w, 400, err.Error())
				return
			}
			ok(w, t)
		}))
		// Structured events keep the Live Activity Stream card working without
		// having to parse the text tail.
		m.HandleFunc("GET /api/v1/logs/events", a.require("read", func(w http.ResponseWriter, r *http.Request) {
			limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
			if limit <= 0 || limit > 500 {
				limit = 50
			}
			rows, err := a.S.DB.Query(`SELECT id,task_id,kind,payload,created_at FROM events ORDER BY id DESC LIMIT ?`, limit)
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			defer rows.Close()
			out := []tasks.Event{}
			for rows.Next() {
				var e tasks.Event
				var raw string
				if err := rows.Scan(&e.ID, &e.TaskID, &e.Kind, &raw, &e.CreatedAt); err != nil {
					fail(w, 500, err.Error())
					return
				}
				e.Payload = json.RawMessage(raw)
				out = append(out, e)
			}
			ok(w, out)
		}))
	})
}

// activityLines renders the newest events as log-style lines, newest last.
func activityLines(a *API, limit int) ([]string, error) {
	rows, err := a.S.DB.Query(`SELECT task_id,kind,payload,created_at FROM events ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type row struct {
		task, kind, payload string
		at                  int64
	}
	items := []row{}
	for rows.Next() {
		var v row
		if err := rows.Scan(&v.task, &v.kind, &v.payload, &v.at); err != nil {
			return nil, err
		}
		items = append(items, v)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]string, 0, len(items))
	for i := len(items) - 1; i >= 0; i-- {
		v := items[i]
		out = append(out, time.Unix(v.at, 0).Format("2006-01-02 15:04:05")+"  "+padRight(v.kind, 18)+" "+padRight(v.task, 12)+"  "+eventSummary(v.payload))
	}
	return out, nil
}

func padRight(s string, n int) string {
	if len(s) >= n {
		return s + " "
	}
	return s + strings.Repeat(" ", n-len(s))
}

// eventSummary flattens the small JSON event payload into a readable line.
func eventSummary(raw string) string {
	var m map[string]any
	if json.Unmarshal([]byte(raw), &m) != nil || len(m) == 0 {
		return strings.TrimSpace(raw)
	}
	parts := []string{}
	for _, k := range []string{"title", "status", "from", "to", "actor", "fields", "reason", "error", "message", "run_id", "node"} {
		if v, ok := m[k]; ok && v != nil {
			parts = append(parts, k+"="+compactValue(v))
		}
	}
	if len(parts) == 0 {
		return strings.TrimSpace(raw)
	}
	return strings.Join(parts, " ")
}

func compactValue(v any) string {
	b, _ := json.Marshal(v)
	s := string(b)
	if len(s) > 120 {
		s = s[:117] + "..."
	}
	return s
}
