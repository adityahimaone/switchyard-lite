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
	if c := do(t, h, "POST", "/api/v1/workspaces", wr, `{"id":"mac-dev","name":"Mac Dev","path":"/Users/dev/app","host":"mac-tailscale","os":"mac","kind":"repo","labels":["work"],"note":"Apple Silicon"}`).Code; c != 201 {
		t.Fatalf("ws %d", c)
	}
	if w := do(t, h, "PUT", "/api/v1/workspaces/mac-dev", wr, `{"name":"Mac Mini","path":"/Users/dev/app","host":"mac-tailscale","os":"mac","kind":"repo","labels":["work","ios"],"note":"Updated"}`); w.Code != 200 {
		t.Fatalf("ws update %d %s", w.Code, w.Body.String())
	}
	if w := do(t, h, "POST", "/api/v1/workspaces/mac-dev/ping", wr, ""); w.Code != 200 {
		t.Fatalf("ws ping %d", w.Code)
	}
	if w := do(t, h, "GET", "/api/v1/tasks/t_none/worktree", wr, ""); w.Code != 200 {
		t.Fatalf("worktree %d", w.Code)
	}
}
