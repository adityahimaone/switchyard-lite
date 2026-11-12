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
	})
}
