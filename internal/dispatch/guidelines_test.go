package dispatch

import (
	"strings"
	"testing"
)

func TestIsSAASWorkspaceFromPathAndLabels(t *testing.T) {
	cases := []struct {
		name   string
		path   string
		labels []string
		want   bool
	}{
		{"windows hadirr path", `D:\xampp\htdocs\portal-hadirr`, nil, true},
		{"windows gadjian path", `D:\xampp\htdocs\portal-gadjian`, nil, true},
		{"posix baktiku path", "/srv/www/baktiku-portal", nil, true},
		{"saas label", "/srv/ordinary-app", []string{"saas"}, true},
		{"work label", "/srv/ordinary-app", []string{"Work"}, true},
		{"ordinary workspace", "/Users/dev/switchyard-lite", nil, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := IsSAASWorkspace(c.path, c.labels); got != c.want {
				t.Fatalf("IsSAASWorkspace(%q, %v) = %v, want %v", c.path, c.labels, got, c.want)
			}
		})
	}
}

func TestAugmentPromptInjectsContextAndGuidelines(t *testing.T) {
	msg := "Fix the login view"
	paths := []string{"user/www/view/login.php"}
	skills := []string{"frontend-design"}

	got := AugmentPrompt(msg, `D:\xampp\htdocs\portal-hadirr`, nil, paths, skills)
	for _, want := range []string{
		msg,
		"[WORKSPACE CONTEXT & REFERENCES]",
		"- @user/www/view/login.php",
		"- $frontend-design",
		"[FAST-8 SAAS FRONTEND DEVELOPMENT GUIDELINES]",
		"SCSS Styling",
		"Cache-Busting Version Bump",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("augmented prompt missing %q\n---\n%s", want, got)
		}
	}
}

func TestAugmentPromptIsIdempotent(t *testing.T) {
	once := AugmentPrompt("Fix the login view", "/srv/saas/portal", []string{"work"}, []string{"a.php"}, []string{"design"})
	twice := AugmentPrompt(once, "/srv/saas/portal", []string{"work"}, []string{"a.php"}, []string{"design"})
	if twice != once {
		t.Fatalf("second augmentation changed the prompt:\nfirst:\n%s\nsecond:\n%s", once, twice)
	}
	if strings.Count(twice, "[FAST-8 SAAS FRONTEND DEVELOPMENT GUIDELINES]") != 1 {
		t.Fatal("guidelines injected more than once")
	}
	if strings.Count(twice, "[WORKSPACE CONTEXT & REFERENCES]") != 1 {
		t.Fatal("context block injected more than once")
	}
}

func TestAugmentPromptSkipsGuidelinesForOrdinaryWorkspace(t *testing.T) {
	got := AugmentPrompt("Fix it", "/Users/dev/switchyard-lite", nil, []string{"web/src/App.tsx"}, nil)
	if !strings.Contains(got, "- @web/src/App.tsx") {
		t.Fatalf("file reference missing: %s", got)
	}
	if strings.Contains(got, "[FAST-8 SAAS FRONTEND DEVELOPMENT GUIDELINES]") {
		t.Fatal("guidelines must not be attached to a non-SAAS workspace")
	}
}
