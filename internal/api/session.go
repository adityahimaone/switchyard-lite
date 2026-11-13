package api

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/adityahimaone/switchyard-lite/internal/store"
)

const (
	adminPasswordEnv     = "SWITCHYARD_ADMIN_PASSWORD"
	adminPasswordHashKey = "admin_password_hash"
	passwordIterations   = 120000
	minPasswordLength    = 8
)

// pbkdf2SHA256 is a small stdlib-only PBKDF2-HMAC-SHA256 implementation. The
// server previously compared the env password in plaintext; a stored password
// must never be recoverable from the SQLite file.
func pbkdf2SHA256(password, salt []byte, iter, keyLen int) []byte {
	prf := hmac.New(sha256.New, password)
	hashLen := prf.Size()
	blocks := (keyLen + hashLen - 1) / hashLen
	dk := make([]byte, 0, blocks*hashLen)
	var counter [4]byte
	for block := 1; block <= blocks; block++ {
		prf.Reset()
		_, _ = prf.Write(salt)
		binary.BigEndian.PutUint32(counter[:], uint32(block))
		_, _ = prf.Write(counter[:])
		u := prf.Sum(nil)
		t := make([]byte, len(u))
		copy(t, u)
		for n := 2; n <= iter; n++ {
			prf.Reset()
			_, _ = prf.Write(u)
			u = prf.Sum(u[:0])
			for i := range t {
				t[i] ^= u[i]
			}
		}
		dk = append(dk, t...)
	}
	return dk[:keyLen]
}

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := pbkdf2SHA256([]byte(password), salt, passwordIterations, 32)
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s",
		passwordIterations,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key)), nil
}

func verifyStoredPassword(stored, password string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false
	}
	iter, err := strconv.Atoi(parts[1])
	if err != nil || iter < 1000 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return false
	}
	got := pbkdf2SHA256([]byte(password), salt, iter, len(want))
	return subtle.ConstantTimeCompare(got, want) == 1
}

func storedPasswordHash(s *store.Store) string {
	var v string
	_ = s.DB.QueryRow(`SELECT value FROM dispatch_settings WHERE key=?`, adminPasswordHashKey).Scan(&v)
	return v
}

func setStoredPasswordHash(s *store.Store, hash string) error {
	_, err := s.DB.Exec(
		`INSERT INTO dispatch_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
		adminPasswordHashKey, hash)
	return err
}

// passwordSource reports which credential login currently uses.
func passwordSource(s *store.Store) string {
	if storedPasswordHash(s) != "" {
		return "stored"
	}
	if os.Getenv(adminPasswordEnv) != "" {
		return "env"
	}
	return "none"
}

func loginEnabled(s *store.Store) bool { return passwordSource(s) != "none" }

// checkPassword verifies against the stored hash first, then the env fallback.
func checkPassword(s *store.Store, password string) bool {
	if stored := storedPasswordHash(s); stored != "" {
		return verifyStoredPassword(stored, password)
	}
	want := os.Getenv(adminPasswordEnv)
	if want == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(password), []byte(want)) == 1
}

func init() {
	registrars = append(registrars, func(m *http.ServeMux, a *API) {
		m.HandleFunc("GET /api/v1/session", func(w http.ResponseWriter, r *http.Request) {
			source := passwordSource(a.S)
			ok(w, map[string]any{
				"login_enabled":   source != "none",
				"password_source": source,
				// A first-time password can be set from Settings even when the
				// env var is absent, which turns password login on.
				"can_set_password": true,
			})
		})
		m.HandleFunc("POST /api/v1/session", func(w http.ResponseWriter, r *http.Request) {
			if !loginEnabled(a.S) {
				fail(w, http.StatusServiceUnavailable,
					"login disabled: set a password in Settings or define "+adminPasswordEnv+" and restart the server")
				return
			}
			var in struct {
				Password string `json:"password"`
			}
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in); err != nil {
				fail(w, 400, "invalid json")
				return
			}
			if !checkPassword(a.S, in.Password) {
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

		// Change (or set the first) admin password. Requires an admin token, so
		// a read-only token or a task-scoped agent cannot rotate credentials.
		m.HandleFunc("POST /api/v1/session/password", a.require("admin", func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				CurrentPassword string `json:"current_password"`
				NewPassword     string `json:"new_password"`
			}
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&in); err != nil {
				fail(w, 400, "invalid json")
				return
			}
			if len(in.NewPassword) < minPasswordLength {
				fail(w, 400, fmt.Sprintf("new password must be at least %d characters", minPasswordLength))
				return
			}
			if in.NewPassword == in.CurrentPassword {
				fail(w, 400, "new password must differ from the current one")
				return
			}
			if passwordSource(a.S) != "none" && !checkPassword(a.S, in.CurrentPassword) {
				fail(w, http.StatusUnauthorized, "current password is incorrect")
				return
			}
			hash, err := hashPassword(in.NewPassword)
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			if err := setStoredPasswordHash(a.S, hash); err != nil {
				fail(w, 500, err.Error())
				return
			}
			ok(w, map[string]any{"ok": true, "password_source": "stored"})
		}))

		// Revert to the server's env password (useful when the env var is the
		// source of truth for a deployment).
		m.HandleFunc("DELETE /api/v1/session/password", a.require("admin", func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				CurrentPassword string `json:"current_password"`
			}
			_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in)
			if storedPasswordHash(a.S) != "" && !checkPassword(a.S, in.CurrentPassword) {
				fail(w, http.StatusUnauthorized, "current password is incorrect")
				return
			}
			if _, err := a.S.DB.Exec(`DELETE FROM dispatch_settings WHERE key=?`, adminPasswordHashKey); err != nil {
				fail(w, 500, err.Error())
				return
			}
			ok(w, map[string]any{"ok": true, "password_source": passwordSource(a.S)})
		}))
	})
}
