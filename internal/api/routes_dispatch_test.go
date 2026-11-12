package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/adityahimaone/switchyard-lite/internal/store"
)

func TestDispatchRoutes(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"models":["m1"]}`))
	}))
	defer up.Close()
	t.Setenv("NODE_AGENT_URL", up.URL)
	s, _ := store.Open(":memory:")
	defer s.Close()
	h := New(s).Handler()
	wr, _ := CreateToken(s, "w", "admin")
	if c := do(t, h, "GET", "/api/v1/models?executor=x", wr, "").Code; c != 200 {
		t.Fatalf("models %d", c)
	}
	if c := do(t, h, "POST", "/api/v1/workers", wr, `{"name":"n1"}`).Code; c != 201 {
		t.Fatalf("worker %d", c)
	}
	if w := do(t, h, "GET", "/api/v1/workers", wr, ""); w.Code != 200 || w.Body.Len() < 10 {
		t.Fatalf("workers %d", w.Code)
	}
	if c := do(t, h, "GET", "/api/v1/tasks/nope/diff", wr, "").Code; c != 409 {
		t.Fatalf("diff %d", c)
	}
	if c := do(t, h, "POST", "/api/v1/tasks/nope/dispatch", wr, "").Code; c != 404 {
		t.Fatalf("dispatch %d", c)
	}
	if c := do(t, h, "POST", "/api/v1/workspaces", wr, `{"path":"/tmp/x"}`).Code; c != 201 {
		t.Fatalf("ws %d", c)
	}
}
