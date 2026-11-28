package tasks

import (
	"errors"
	"testing"

	"github.com/adityahimaone/switchyard-studio/internal/store"
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

func TestMoveReleasesDispatchClaim(t *testing.T) {
	v, b := newSvc(t)
	a, err := v.Create(NewTask{BoardID: b.ID, Title: "claimed task"})
	if err != nil {
		t.Fatal(err)
	}
	claimCount := func() int {
		var n int
		if err := v.S.DB.QueryRow(`SELECT COUNT(*) FROM dispatch_claims WHERE task_id=?`, a.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	insertClaim := func(runID string) {
		if _, err := v.S.DB.Exec(
			`INSERT OR REPLACE INTO dispatch_claims(task_id,worker_id,run_id,attempt,claimed_at,lease_expires_at) VALUES(?,?,?,?,?,?)`,
			a.ID, "w-test", runID, 1, 100, 500,
		); err != nil {
			t.Fatal(err)
		}
	}

	// Claim taken while todo -> moving into in_progress must keep the claim.
	insertClaim("run_1")
	if _, err := v.Move(a.ID, InProgress, "dispatcher"); err != nil {
		t.Fatal(err)
	}
	if got := claimCount(); got != 1 {
		t.Fatalf("expected claim to remain on move to in_progress, got %d", got)
	}

	// Moving out of in_progress to failed must release the claim in the same tx.
	if _, err := v.Move(a.ID, Failed, "api"); err != nil {
		t.Fatal(err)
	}
	if got := claimCount(); got != 0 {
		t.Fatalf("expected claim released on move in_progress->failed, got %d", got)
	}

	// Moving out of in_progress to todo, waiting_input, and review must also release.
	for _, target := range []string{Todo, WaitingInput, Review} {
		if _, err := v.Move(a.ID, Todo, "retry"); err != nil {
			t.Fatalf("reset to todo before %s: %v", target, err)
		}
		insertClaim("run_" + target)
		if _, err := v.Move(a.ID, InProgress, "dispatcher"); err != nil {
			t.Fatalf("move to in_progress before %s: %v", target, err)
		}
		if _, err := v.Move(a.ID, target, "api"); err != nil {
			t.Fatalf("move in_progress->%s: %v", target, err)
		}
		if got := claimCount(); got != 0 {
			t.Fatalf("expected claim released on move in_progress->%s, got %d", target, got)
		}
	}
}
