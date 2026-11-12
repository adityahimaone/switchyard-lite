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
