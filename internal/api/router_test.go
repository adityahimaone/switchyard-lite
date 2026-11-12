package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/adityahimaone/switchyard-lite/internal/store"
)

func do(t *testing.T, h http.Handler, method, path, tok, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if tok != "" {
		r.Header.Set("Authorization", "Bearer "+tok)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestScopesAndFlow(t *testing.T) {
	s, _ := store.Open(":memory:")
	defer s.Close()
	h := New(s).Handler()
	rd, _ := CreateToken(s, "r", "read")
	wr, _ := CreateToken(s, "w", "write")

	if c := do(t, h, "GET", "/api/v1/boards", "", "").Code; c != 401 {
		t.Fatalf("no token: %d", c)
	}
	if c := do(t, h, "POST", "/api/v1/boards", rd, `{"name":"x"}`).Code; c != 403 {
		t.Fatalf("read token must not write: %d", c)
	}
	w := do(t, h, "POST", "/api/v1/boards", wr, `{"name":"x"}`)
	if w.Code != 201 {
		t.Fatalf("create board: %d %s", w.Code, w.Body)
	}
	id := between(w.Body.String(), `"id":"`, `"`)
	w = do(t, h, "POST", "/api/v1/tasks", wr, `{"board_id":"`+id+`","title":"hello"}`)
	if w.Code != 201 {
		t.Fatalf("create task: %d %s", w.Code, w.Body)
	}
	tid := between(w.Body.String(), `"id":"`, `"`)
	if c := do(t, h, "POST", "/api/v1/tasks/"+tid+"/move", wr, `{"status":"done"}`).Code; c != 409 {
		t.Fatalf("illegal move want 409 got %d", c)
	}
	if c := do(t, h, "GET", "/api/v1/boards/"+id+"/tasks", rd, "").Code; c != 200 {
		t.Fatalf("list: %d", c)
	}
}

func between(s, a, b string) string {
	i := strings.Index(s, a) + len(a)
	return s[i : i+strings.Index(s[i:], b)]
}
