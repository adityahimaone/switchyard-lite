package api

import (
	"strings"
	"testing"

	"github.com/adityahimaone/switchyard-lite/internal/store"
)

func TestPipelineAndTokenRoutes(t *testing.T) {
	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	h := New(s).Handler()
	adm, _ := CreateToken(s, "admin", "admin")

	if w := do(t, h, "GET", "/api/v1/pipelines/templates", adm, ""); w.Code != 200 || !strings.Contains(w.Body.String(), "design-thinking") {
		t.Fatalf("templates %d %s", w.Code, w.Body)
	}
	b := do(t, h, "POST", "/api/v1/boards", adm, `{"name":"p"}`)
	bid := between(b.Body.String(), `"id":"`, `"`)

	w := do(t, h, "POST", "/api/v1/pipelines", adm, `{"template":"design-thinking","board_id":"`+bid+`","goal":"ship v1"}`)
	if w.Code != 201 {
		t.Fatalf("start pipeline %d %s", w.Code, w.Body)
	}
	rid := between(w.Body.String(), `"id":"`, `"`)

	if g := do(t, h, "GET", "/api/v1/pipelines/"+rid, adm, ""); g.Code != 200 || !strings.Contains(g.Body.String(), `"explore"`) {
		t.Fatalf("get run %d %s", g.Code, g.Body)
	}
	if l := do(t, h, "GET", "/api/v1/pipelines", adm, ""); l.Code != 200 || !strings.Contains(l.Body.String(), rid) {
		t.Fatalf("list runs %d %s", l.Code, l.Body)
	}
	if c := do(t, h, "POST", "/api/v1/pipelines/"+rid+"/cancel", adm, ""); c.Code != 200 || !strings.Contains(c.Body.String(), `"cancelled"`) {
		t.Fatalf("cancel %d %s", c.Code, c.Body)
	}
	if tk := do(t, h, "POST", "/api/v1/tokens", adm, `{"name":"ci","scope":"read"}`); tk.Code != 201 {
		t.Fatalf("create token %d %s", tk.Code, tk.Body)
	}
	if sse := do(t, h, "GET", "/api/v1/events/stream?once=1", adm, ""); sse.Code != 200 || !strings.Contains(sse.Body.String(), "data:") {
		t.Fatalf("sse %d %s", sse.Code, sse.Body)
	}
}
