package nodes

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestMatchNormalizesPlatformPaths(t *testing.T) {
	list := []Node{{
		NodeID:   "mac",
		Hostname: "Adityas-MacBook-Pro.local",
		Workspaces: []string{
			"/Users/dev/app/",
			`D:\xampp\htdocs\portal`,
		},
	}}

	cases := []struct {
		path string
		want bool
	}{
		{"/Users/dev/app", true},          // trailing slash dropped
		{"/users/dev/app/", true},         // case + slash folded
		{`D:\xampp\htdocs\portal`, true},  // windows separators
		{"D:/xampp/htdocs/portal", true},  // forward slashes match backslashes
		{`d:\XAMPP\htdocs\portal\`, true}, // windows case-insensitive
		{"/Users/dev/other", false},
		{"", false},
	}
	for _, c := range cases {
		if _, ok := Match(list, c.path); ok != c.want {
			t.Errorf("Match(%q) = %v, want %v", c.path, ok, c.want)
		}
	}
}

func TestFreshWindow(t *testing.T) {
	now := time.Date(2026, 11, 13, 11, 0, 0, 0, time.UTC)
	fresh := Node{Status: "idle", LastSeen: now.Add(-10 * time.Second)}
	if !fresh.Fresh(now) {
		t.Error("recent heartbeat should be fresh")
	}
	stale := Node{Status: "idle", LastSeen: now.Add(-10 * time.Minute)}
	if stale.Fresh(now) {
		t.Error("stale heartbeat should not be fresh")
	}
	offline := Node{Status: "offline", LastSeen: now}
	if offline.Fresh(now) {
		t.Error("offline node should not be fresh")
	}
	never := Node{Status: "idle"}
	if never.Fresh(now) {
		t.Error("node that never reported should not be fresh")
	}
}

func TestListCachesAndSendsToken(t *testing.T) {
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if got := r.Header.Get("X-Node-Agent-Token"); got != "tok" {
			t.Errorf("token header = %q", got)
		}
		if r.URL.Path != "/api/nodes" {
			t.Errorf("path = %q", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode([]Node{{NodeID: "mac", Workspaces: []string{"/a"}}})
	}))
	defer srv.Close()

	reg := New(srv.URL, "tok")
	now := time.Now()
	reg.Now = func() time.Time { return now }

	for i := 0; i < 3; i++ {
		list, err := reg.List(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if len(list) != 1 || list[0].NodeID != "mac" {
			t.Fatalf("unexpected list: %+v", list)
		}
	}
	if hits != 1 {
		t.Errorf("upstream hits = %d, want 1 (cached)", hits)
	}

	now = now.Add(reg.TTL + time.Second)
	if _, err := reg.List(context.Background()); err != nil {
		t.Fatal(err)
	}
	if hits != 2 {
		t.Errorf("upstream hits = %d, want 2 after TTL expiry", hits)
	}
}

func TestUnconfiguredRegistryIsQuiet(t *testing.T) {
	if _, err := New("", "").List(context.Background()); err != nil {
		t.Fatalf("unconfigured registry should not error: %v", err)
	}
	var nilReg *Registry
	if list, err := nilReg.List(context.Background()); err != nil || list != nil {
		t.Fatalf("nil registry should return nothing: %v %v", list, err)
	}
}
