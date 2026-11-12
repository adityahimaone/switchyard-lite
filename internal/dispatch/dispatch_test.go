package dispatch

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/store"
	"github.com/adityahimaone/switchyard-lite/internal/tasks"
)

type fake struct {
	mu       sync.Mutex
	succeed  bool
	reqs     []Request
	dispatch int32
	srv      *httptest.Server
	onRun    func(Request)
}

func newFake(t *testing.T, succeed bool) *fake {
	f := &fake{succeed: succeed}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Node-Agent-Token") != "tok" {
			w.WriteHeader(401)
			return
		}
		switch {
		case r.Method == "POST" && r.URL.Path == "/api/dispatch":
			var q Request
			_ = json.NewDecoder(r.Body).Decode(&q)
			atomic.AddInt32(&f.dispatch, 1)
			f.mu.Lock()
			f.reqs = append(f.reqs, q)
			f.mu.Unlock()
			if f.onRun != nil {
				f.onRun(q)
			}
			w.WriteHeader(202)
		case strings.HasPrefix(r.URL.Path, "/api/results/"):
			id := strings.TrimPrefix(r.URL.Path, "/api/results/")
			f.mu.Lock()
			n := len(f.reqs)
			f.mu.Unlock()
			if n == 0 {
				w.WriteHeader(404)
				return
			}
			res := Result{TaskID: id, Success: f.succeed, Output: "done"}
			if !f.succeed {
				res.Error = "boom"
			}
			_ = json.NewEncoder(w).Encode(res)
		}
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func setup(t *testing.T, f *fake) (*Dispatcher, tasks.Task) {
	s, err := store.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	d, err := New(s, Config{NodeAgentURL: f.srv.URL, Token: "tok", Poll: 10 * time.Millisecond, Lease: time.Minute, MaxRetries: 1})
	if err != nil {
		t.Fatal(err)
	}
	b, _ := d.Tasks.CreateBoard("b")
	tk, err := d.Tasks.Create(tasks.NewTask{BoardID: b.ID, Title: "t", Prompt: "do it", Workspace: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if tk.Status != tasks.Todo {
		_, err = d.Tasks.Move(tk.ID, tasks.Todo, "t")
		if err != nil {
			t.Fatal(err)
		}
	}
	return d, tk
}

func TestClaimRace(t *testing.T) {
	d, tk := setup(t, newFake(t, true))
	var wins int32
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if ok, _ := d.Claim(tk.ID, "run"+string(rune('a'+i))); ok {
				atomic.AddInt32(&wins, 1)
			}
		}(i)
	}
	wg.Wait()
	if wins != 1 {
		t.Fatalf("wins=%d want 1", wins)
	}
}

func TestLeaseExpiryReapsAndReclaims(t *testing.T) {
	d, tk := setup(t, newFake(t, true))
	if ok, _ := d.Claim(tk.ID, "r1"); !ok {
		t.Fatal("claim")
	}
	if _, err := d.Tasks.Move(tk.ID, tasks.InProgress, "x"); err != nil {
		t.Fatal(err)
	}
	d.Now = func() time.Time { return time.Now().Add(2 * time.Minute) }
	n, err := d.ReapExpired()
	if err != nil || n != 1 {
		t.Fatalf("reap n=%d err=%v", n, err)
	}
	got, _ := d.Tasks.Get(tk.ID)
	if got.Status != tasks.Todo {
		t.Fatalf("status %s", got.Status)
	}
	if ok, _ := d.Claim(tk.ID, "r2"); !ok {
		t.Fatal("reclaim after expiry")
	}
}

func TestStealExpiredLease(t *testing.T) {
	d, tk := setup(t, newFake(t, true))
	_, _ = d.Claim(tk.ID, "r1")
	if ok, _ := d.Claim(tk.ID, "r2"); ok {
		t.Fatal("live lease must not be stolen")
	}
	d.Now = func() time.Time { return time.Now().Add(2 * time.Minute) }
	if ok, _ := d.Claim(tk.ID, "r2"); !ok {
		t.Fatal("expired lease should be stealable")
	}
}

func TestSuccessGoesToReview(t *testing.T) {
	f := newFake(t, true)
	d, tk := setup(t, f)
	if _, err := d.Start(context.Background(), tk.ID); err != nil {
		t.Fatal(err)
	}
	d.Wait()
	got, _ := d.Tasks.Get(tk.ID)
	if got.Status != tasks.Review {
		t.Fatalf("status %s", got.Status)
	}
	if f.reqs[0].Workspace != tk.Workspace || f.reqs[0].TaskID != tk.ID {
		t.Fatalf("req %+v", f.reqs[0])
	}
}

func TestFailureRetriesThenFails(t *testing.T) {
	f := newFake(t, false)
	d, tk := setup(t, f)
	for i := 0; i < 2; i++ {
		if _, err := d.Start(context.Background(), tk.ID); err != nil {
			t.Fatal(err)
		}
		d.Wait()
		got, _ := d.Tasks.Get(tk.ID)
		want := tasks.Todo
		if i == 1 {
			want = tasks.Failed
		}
		if got.Status != want || got.RetryCount != i+1 {
			t.Fatalf("attempt %d: status=%s retries=%d", i, got.Status, got.RetryCount)
		}
	}
}

func TestNonGitSkipsWorktree(t *testing.T) {
	if IsGit(t.TempDir()) {
		t.Fatal("tempdir is not git")
	}
}
