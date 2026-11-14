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

// The active-flow switch: what the Pipelines screen toggles, and what Start falls
// back to when the caller names no template.
func TestDefaultFlowSwitchRoute(t *testing.T) {
	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	h := New(s).Handler()
	adm, _ := CreateToken(s, "admin", "admin")

	if g := do(t, h, "GET", "/api/v1/pipelines/default", adm, ""); g.Code != 200 || !strings.Contains(g.Body.String(), "design-thinking") {
		t.Fatalf("default read %d %s", g.Code, g.Body)
	}

	if p := do(t, h, "POST", "/api/v1/pipelines/default", adm, `{"default":"meta7"}`); p.Code != 200 || !strings.Contains(p.Body.String(), `"meta7"`) {
		t.Fatalf("switch to meta7 %d %s", p.Code, p.Body)
	}
	if p := do(t, h, "POST", "/api/v1/pipelines/default", adm, `{"default":"nope"}`); p.Code != 400 {
		t.Fatalf("unknown flow must be refused, got %d %s", p.Code, p.Body)
	}

	bid := between(do(t, h, "POST", "/api/v1/boards", adm, `{"name":"p2"}`).Body.String(), `"id":"`, `"`)
	w := do(t, h, "POST", "/api/v1/pipelines", adm, `{"board_id":"`+bid+`","goal":"ship meta7"}`)
	if w.Code != 201 || !strings.Contains(w.Body.String(), `"template":"meta7"`) {
		t.Fatalf("start without template should use the switch: %d %s", w.Code, w.Body)
	}

	if p := do(t, h, "POST", "/api/v1/pipelines/default", adm, `{"default":""}`); p.Code != 200 || !strings.Contains(p.Body.String(), "design-thinking") {
		t.Fatalf("clear switch %d %s", p.Code, p.Body)
	}
}

func TestPipelineRetryAndRestartRoutes(t *testing.T) {
	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	h := New(s).Handler()
	adm, _ := CreateToken(s, "admin", "admin")

	bid := between(do(t, h, "POST", "/api/v1/boards", adm, `{"name":"p3"}`).Body.String(), `"id":"`, `"`)
	tk := do(t, h, "POST", "/api/v1/tasks", adm, `{"board_id":"`+bid+`","title":"Task A","prompt":"Do A","status":"todo"}`)
	if tk.Code != 201 {
		t.Fatalf("create task %d %s", tk.Code, tk.Body)
	}

	w := do(t, h, "POST", "/api/v1/pipelines", adm, `{"template":"meta7","board_id":"`+bid+`","include_board_tasks":true}`)
	if w.Code != 201 || !strings.Contains(w.Body.String(), `"explore"`) {
		t.Fatalf("start include_board_tasks %d %s", w.Code, w.Body)
	}
	rid := between(w.Body.String(), `"id":"`, `"`)

	rt := do(t, h, "POST", "/api/v1/pipelines/"+rid+"/retry", adm, `{"stage":"explore"}`)
	if rt.Code != 200 || !strings.Contains(rt.Body.String(), `"explore:1"`) {
		t.Fatalf("retry stage %d %s", rt.Code, rt.Body)
	}

	rs := do(t, h, "POST", "/api/v1/pipelines/"+rid+"/restart", adm, "")
	if rs.Code != 201 || strings.Contains(rs.Body.String(), `"id":"`+rid+`"`) {
		t.Fatalf("restart pipeline %d %s", rs.Code, rs.Body)
	}
}
