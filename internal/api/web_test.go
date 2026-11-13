package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/adityahimaone/switchyard-lite/internal/store"
)

func TestWebSessionOverview(t *testing.T) {
	s, err := store.Open(t.TempDir() + "/t.db")
	if err != nil {
		t.Fatal(err)
	}
	h := New(s).Handler()
	do := func(method, p, body, tok string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, p, strings.NewReader(body))
		if tok != "" {
			r.Header.Set("Authorization", "Bearer "+tok)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	t.Setenv(adminPasswordEnv, "")
	if c := do("POST", "/api/v1/session", `{"password":"x"}`, "").Code; c != 503 {
		t.Fatalf("disabled login = %d", c)
	}
	t.Setenv(adminPasswordEnv, "pw")
	if c := do("POST", "/api/v1/session", `{"password":"bad"}`, "").Code; c != 401 {
		t.Fatalf("bad pw = %d", c)
	}
	w := do("POST", "/api/v1/session", `{"password":"pw"}`, "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "syl_") {
		t.Fatalf("login = %d %s", w.Code, w.Body)
	}
	tok := strings.Split(strings.Split(w.Body.String(), `"token":"`)[1], `"`)[0]
	if c := do("GET", "/api/v1/overview", "", tok).Code; c != 200 {
		t.Fatalf("overview = %d", c)
	}
	if c := do("GET", "/board/xyz", "", "").Code; c != http.StatusOK && c != 404 {
		t.Fatalf("spa = %d", c)
	}
	if c := do("GET", "/api/v1/nope", "", "").Code; c != 404 {
		t.Fatalf("api 404 = %d", c)
	}
}

func TestChangePasswordStoresHashAndRotatesLogin(t *testing.T) {
	s, err := store.Open(t.TempDir() + "/t.db")
	if err != nil {
		t.Fatal(err)
	}
	h := New(s).Handler()
	do := func(method, p, body, tok string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, p, strings.NewReader(body))
		if tok != "" {
			r.Header.Set("Authorization", "Bearer "+tok)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	t.Setenv(adminPasswordEnv, "old-password")

	w := do("POST", "/api/v1/session", `{"password":"old-password"}`, "")
	if w.Code != 200 {
		t.Fatalf("login = %d %s", w.Code, w.Body)
	}
	tok := strings.Split(strings.Split(w.Body.String(), `"token":"`)[1], `"`)[0]

	if c := do("POST", "/api/v1/session/password", `{"current_password":"wrong","new_password":"new-password-1"}`, tok).Code; c != 401 {
		t.Fatalf("wrong current = %d", c)
	}
	if c := do("POST", "/api/v1/session/password", `{"current_password":"old-password","new_password":"short"}`, tok).Code; c != 400 {
		t.Fatalf("short password = %d", c)
	}
	if c := do("POST", "/api/v1/session/password", `{"current_password":"old-password","new_password":"new-password-1"}`, tok).Code; c != 200 {
		t.Fatalf("change = %d", c)
	}

	if c := do("POST", "/api/v1/session", `{"password":"old-password"}`, "").Code; c != 401 {
		t.Fatalf("old password still works: %d", c)
	}
	if c := do("POST", "/api/v1/session", `{"password":"new-password-1"}`, "").Code; c != 200 {
		t.Fatalf("new password rejected: %d", c)
	}
	if body := do("GET", "/api/v1/session", "", "").Body.String(); !strings.Contains(body, `"password_source":"stored"`) {
		t.Fatalf("session source = %s", body)
	}
	if stored := storedPasswordHash(s); strings.Contains(stored, "new-password-1") || !strings.HasPrefix(stored, "pbkdf2-sha256$") {
		t.Fatalf("password not hashed: %q", stored)
	}
}

func TestSetFirstPasswordWithoutEnv(t *testing.T) {
	s, err := store.Open(t.TempDir() + "/t.db")
	if err != nil {
		t.Fatal(err)
	}
	h := New(s).Handler()
	t.Setenv(adminPasswordEnv, "")
	tok, err := CreateToken(s, "bootstrap", "admin")
	if err != nil {
		t.Fatal(err)
	}
	do := func(method, p, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, p, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+tok)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if body := do("GET", "/api/v1/session", "").Body.String(); !strings.Contains(body, `"login_enabled":false`) {
		t.Fatalf("expected disabled login: %s", body)
	}
	if c := do("POST", "/api/v1/session/password", `{"current_password":"","new_password":"first-password"}`).Code; c != 200 {
		t.Fatalf("set first password = %d", c)
	}
	if body := do("GET", "/api/v1/session", "").Body.String(); !strings.Contains(body, `"login_enabled":true`) {
		t.Fatalf("login should be enabled: %s", body)
	}
}
