package api

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"os"
)

const adminPasswordEnv = "SWITCHYARD_ADMIN_PASSWORD"

func init() {
	registrars = append(registrars, func(m *http.ServeMux, a *API) {
		m.HandleFunc("GET /api/v1/session", func(w http.ResponseWriter, r *http.Request) {
			ok(w, map[string]bool{"login_enabled": os.Getenv(adminPasswordEnv) != ""})
		})
		m.HandleFunc("POST /api/v1/session", func(w http.ResponseWriter, r *http.Request) {
			want := os.Getenv(adminPasswordEnv)
			if want == "" {
				fail(w, http.StatusServiceUnavailable, "login disabled: set "+adminPasswordEnv+" and restart the server")
				return
			}
			var in struct {
				Password string `json:"password"`
			}
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in); err != nil {
				fail(w, 400, "invalid json")
				return
			}
			if subtle.ConstantTimeCompare([]byte(in.Password), []byte(want)) != 1 {
				fail(w, http.StatusUnauthorized, "wrong password")
				return
			}
			tok, err := CreateToken(a.S, "web-ui-session", "admin")
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			ok(w, map[string]string{"token": tok, "scope": "admin"})
		})
	})
}
