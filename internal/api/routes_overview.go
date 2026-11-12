package api

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"time"
)

func init() {
	registrars = append(registrars, func(m *http.ServeMux, a *API) {
		m.HandleFunc("GET /api/v1/overview", a.require("read", func(w http.ResponseWriter, r *http.Request) {
			counts := map[string]int{}
			rows, err := a.S.DB.Query(`SELECT status, COUNT(*) FROM tasks GROUP BY status`)
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			defer rows.Close()
			total := 0
			for rows.Next() {
				var s string
				var n int
				if err := rows.Scan(&s, &n); err != nil {
					fail(w, 500, err.Error())
					return
				}
				counts[s] = n
				total += n
			}
			var boards int
			_ = a.S.DB.QueryRow(`SELECT COUNT(*) FROM boards`).Scan(&boards)
			dbOK := a.S.DB.Ping() == nil
			status := "ok"
			if !dbOK {
				status = "degraded"
			}
			ok(w, map[string]any{"counts": counts, "total": total, "boards": boards,
				"health": map[string]any{"status": status, "db": dbOK}})
		}))

		m.HandleFunc("GET /api/v1/tasks/{id}/attachments", a.require("read", func(w http.ResponseWriter, r *http.Request) {
			rows, err := a.S.DB.Query(`SELECT id,name,mime,LENGTH(content),created_at FROM attachments WHERE task_id=? ORDER BY id`, r.PathValue("id"))
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			defer rows.Close()
			out := []map[string]any{}
			for rows.Next() {
				var id, size, at int64
				var name, mime string
				if err := rows.Scan(&id, &name, &mime, &size, &at); err != nil {
					fail(w, 500, err.Error())
					return
				}
				out = append(out, map[string]any{"id": id, "name": name, "mime": mime, "size": size, "created_at": at})
			}
			ok(w, out)
		}))

		m.HandleFunc("POST /api/v1/tasks/{id}/attachments", a.require("write", func(w http.ResponseWriter, r *http.Request) {
			tid := r.PathValue("id")
			if _, err := a.Tasks.Get(tid); err != nil {
				fromErr(w, err)
				return
			}
			var in struct {
				Name       string `json:"name"`
				Mime       string `json:"mime"`
				DataBase64 string `json:"data_base64"`
				Content    string `json:"content"`
			}
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&in); err != nil || in.Name == "" {
				fail(w, 400, "name required")
				return
			}
			if in.Mime == "" {
				in.Mime = "text/plain"
			}
			raw := []byte(in.Content)
			if in.DataBase64 != "" {
				b, err := base64.StdEncoding.DecodeString(in.DataBase64)
				if err != nil {
					fail(w, 400, "invalid base64")
					return
				}
				raw = b
			}
			now := time.Now().Unix()
			res, err := a.S.DB.Exec(`INSERT INTO attachments(task_id,name,mime,content,created_at) VALUES(?,?,?,?,?)`,
				tid, in.Name, in.Mime, raw, now)
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			id, _ := res.LastInsertId()
			w.WriteHeader(201)
			ok(w, map[string]any{"id": id, "name": in.Name, "mime": in.Mime, "size": len(raw), "created_at": now})
		}))
	})
}
