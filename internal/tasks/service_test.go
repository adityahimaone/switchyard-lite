package tasks

import (
	"errors"
	"testing"

	"github.com/adityahimaone/switchyard-lite/internal/store"
)

func newSvc(t *testing.T) (*Service, Board) {
	t.Helper()
	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	v := New(s)
	b, err := v.CreateBoard("main")
	if err != nil {
		t.Fatal(err)
	}
	return v, b
}

func TestDepsBlockAndUnblock(t *testing.T) {
	v, b := newSvc(t)
	a, _ := v.Create(NewTask{BoardID: b.ID, Title: "a"})
	c, _ := v.Create(NewTask{BoardID: b.ID, Title: "c", BlockedBy: []string{a.ID}})
	if c.Status != Blocked {
		t.Fatalf("want blocked, got %s", c.Status)
	}
	for _, s := range []string{InProgress, Review, Done} {
		if _, err := v.Move(a.ID, s, "test"); err != nil {
			t.Fatalf("move %s: %v", s, err)
		}
	}
	c, _ = v.Get(c.ID)
	if c.Status != Todo {
		t.Fatalf("want todo after dep done, got %s", c.Status)
	}
}

func TestCycleRejected(t *testing.T) {
	v, b := newSvc(t)
	a, _ := v.Create(NewTask{BoardID: b.ID, Title: "a"})
	c, _ := v.Create(NewTask{BoardID: b.ID, Title: "c", BlockedBy: []string{a.ID}})
	if err := v.AddDependency(a.ID, c.ID); !errors.Is(err, ErrCycle) {
		t.Fatalf("want ErrCycle, got %v", err)
	}
}

func TestIllegalMoveAndReviewGate(t *testing.T) {
	v, b := newSvc(t)
	a, _ := v.Create(NewTask{BoardID: b.ID, Title: "a"})
	if _, err := v.Move(a.ID, Done, "x"); !errors.Is(err, ErrBadMove) {
		t.Fatalf("todo->done must be rejected, got %v", err)
	}
	if _, err := v.Move(a.ID, InProgress, "x"); err != nil {
		t.Fatal(err)
	}
	if _, err := v.Move(a.ID, Done, "x"); !errors.Is(err, ErrBadMove) {
		t.Fatalf("in_progress->done must go through review, got %v", err)
	}
}

func TestEventsAppendOnly(t *testing.T) {
	v, b := newSvc(t)
	a, _ := v.Create(NewTask{BoardID: b.ID, Title: "a"})
	_, _ = v.Move(a.ID, InProgress, "x")
	ev, _ := v.Events(a.ID, 0, 10)
	if len(ev) != 2 || ev[0].Kind != "task.created" || ev[1].Kind != "task.moved" {
		t.Fatalf("unexpected events %+v", ev)
	}
}
