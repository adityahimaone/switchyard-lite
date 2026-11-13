package catalog

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Regression: production rows named "mac: portal-hadirr" whose path is
// D:\xampp\htdocs\portal-hadirr must resolve to Windows, not Mac.
func TestMachineResolutionIgnoresStaleMetadata(t *testing.T) {
	const win = `D:\xampp\htdocs\portal-hadirr`
	if got := MachineFromPath(win); got != "windows" {
		t.Fatalf("MachineFromPath(%q) = %q, want windows", win, got)
	}
	for _, tc := range []struct{ name, path, osName, host string }{
		{"empty local metadata", win, "", ""},
		{"stale mac os", win, "mac", "mac-tailscale"},
		{"stale mac node", win, "", "mac-tailscale"},
	} {
		if got := MachineFor(tc.path, tc.osName, tc.host, "mac"); got != "windows" {
			t.Errorf("%s: MachineFor = %q, want windows", tc.name, got)
		}
	}
	if got := MachineFor("/Users/adityahimawan/Development/app", "", "", ""); got != "mac" {
		t.Errorf("mac path resolved to %q", got)
	}
	if got := MachineFor("/srv/app", "linux", "linux-host", ""); got != "linux" {
		t.Errorf("linux host resolved to %q", got)
	}
}

func TestStaleNamePrefixes(t *testing.T) {
	if !HasStalePrefix("mac: portal-hadirr") || !HasStalePrefix("windows：app") {
		t.Fatal("expected stale prefixes to be detected")
	}
	if HasStalePrefix("Hadirr Windows") {
		t.Fatal("live names must not be treated as stale")
	}
	if got := CleanName("mac: portal-hadirr", `D:\xampp\htdocs\portal-hadirr`); got != "portal-hadirr" {
		t.Fatalf("CleanName = %q", got)
	}
	if got := CleanName("", `D:\xampp\htdocs\portal-hadirr`); got != "portal-hadirr" {
		t.Fatalf("CleanName fallback = %q", got)
	}
}

func TestMatchNormalizesWindowsPaths(t *testing.T) {
	live := []Workspace{{ID: "saas-hadirr-windows", Name: "Hadirr Windows", Path: `D:\xampp\htdocs\portal-hadirr`, OS: "windows"}}
	rec, ok := Match(live, `d:/xampp/htdocs/portal-hadirr/`)
	if !ok || rec.ID != "saas-hadirr-windows" {
		t.Fatalf("Match = %+v, %v", rec, ok)
	}
	if got := MachineOf(rec); got != "windows" {
		t.Fatalf("MachineOf = %q", got)
	}
	if Normalize(`C:\Development\`) != Normalize("c:/development") {
		t.Fatal("expected path normalization to be equivalent")
	}
}

func TestListReadsNodeAgentRegistry(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/workspaces" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		if got := r.Header.Get("X-Node-Agent-Token"); got != "secret" {
			t.Errorf("token = %q", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"workspaces": []map[string]any{
				{"id": "w1", "name": "Hadirr Windows", "path": `D:\xampp\htdocs\portal-hadirr`, "os": "windows", "host": "windows-tailscale", "labels": []string{"work", "saas"}},
			},
		})
	}))
	defer srv.Close()
	c := New(srv.URL, "secret")
	list, err := c.List(context.Background(), false)
	if err != nil || len(list) != 1 {
		t.Fatalf("List = %+v, %v", list, err)
	}
	if list[0].OS != "windows" || len(list[0].Labels) != 2 {
		t.Fatalf("decoded metadata: %+v", list[0])
	}
	// cached on the second call
	if _, err := c.List(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	if got := MachineFor(list[0].Path, list[0].OS, list[0].Host, ""); got != "windows" {
		t.Fatalf("live machine = %q", got)
	}
}
