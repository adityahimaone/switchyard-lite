package api

import (
	"encoding/json"
	"net/http"

	"github.com/adityahimaone/switchyard-lite/internal/tasks"
)

func init() {
	registrars = append(registrars, func(m *http.ServeMux, a *API) {
		m.HandleFunc("PATCH /api/v1/tasks/{id}", a.require("write", func(w http.ResponseWriter, r *http.Request) {
			var p tasks.Patch
			if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
				fail(w, 400, "invalid json")
				return
			}
			t, err := a.Tasks.Update(r.PathValue("id"), p)
			if err != nil {
				fromErr(w, err)
				return
			}
			ok(w, t)
		}))
		m.HandleFunc("DELETE /api/v1/tasks/{id}", a.require("write", func(w http.ResponseWriter, r *http.Request) {
			res, err := a.S.DB.Exec(`DELETE FROM tasks WHERE id=?`, r.PathValue("id"))
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			if n, _ := res.RowsAffected(); n == 0 {
				fail(w, 404, "not found")
				return
			}
			w.WriteHeader(204)
		}))
		m.HandleFunc("DELETE /api/v1/tasks/{id}/dependencies/{dep}", a.require("write", func(w http.ResponseWriter, r *http.Request) {
			_, _ = a.S.DB.Exec(`DELETE FROM task_deps WHERE task_id=? AND blocked_by=?`, r.PathValue("id"), r.PathValue("dep"))
			w.WriteHeader(204)
		}))
	})
}
