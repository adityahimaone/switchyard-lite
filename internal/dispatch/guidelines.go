package dispatch

import "strings"

// SAASDevelopmentGuidelines mirrors the internal Fast-8 rules kanban-board
// attaches to prompts. It is kept strictly server-side: the rules are injected
// at dispatch time so they never have to live in a company repository or be
// added to a commit.
const SAASDevelopmentGuidelines = `
---
[FAST-8 SAAS FRONTEND DEVELOPMENT GUIDELINES]
You are working on a Fast-8 SAAS codebase (Gadjian, Hadirr, or Baktiku).

1. Master Workspace Subpath Navigation:
   - Gadjian:
     • User: app/user.gadjian/www
     • CS: app/cs.gadjian/www
     • Personalia: app/personalia.gadjian/www
   - Hadirr:
     • User: user/www
     • CS: cs/www
   - Baktiku:
     • User: user/www
     • CS: cs/www

2. Frontend 5-Step Development Flow:
   - Step 1 (Views): Modify or create PHP template views inside '<portal>/www/view/'.
   - Step 2 (JavaScript): Write logic inside '<portal>/www/ruang_eksperimen/js/<feature>.js'.
     Include in the view file: <script src="/static/lab-result/js/<feature>.min.js?version=X.Y.Z"></script>
   - Step 3 (SCSS Styling):
     • If writing modular styles, always prefix partials with an underscore: '<portal>/www/ruang_eksperimen/scss/_<feature>.scss'.
     • Explicitly import into the portal's active stylesheet entrypoint ('style-1.scss', 'style-2.scss', 'style-3.scss', or 'style-4.scss'):
       @import "<feature>";
   - Step 4 (Minification):
     • Compile SCSS to '<portal>/www/static/lab-result/css/<name>.min.css' (compressed).
     • Minify JS to '<portal>/www/static/lab-result/js/<name>.min.js' (uglified).
     • Never commit unminified changes without their compiled static lab-result counterparts.
   - Step 5 (Cache-Busting Version Bump):
     • For CSS: increment the last segment of '?version=X.Y.Z' in '<portal>/www/view/atas.php' (e.g. 2.4 -> 2.5).
     • For JS: increment the last segment of '?version=X.Y.Z' in the respective view file (e.g. 1.0.3 -> 1.0.4).

3. Runtime & Tools:
   - Node.js requirement for Gulp + node-sass is v14.15.1.
   - Pritunl VPN must be connected for internal backend/staging communication.
   - Do NOT commit or create non-standard configuration files in the root of the company repository.
---
`

// IsSAASWorkspace reports whether a workspace path or its labels belong to a
// Fast-8 SAAS portal. The UI uses the same rule to show the rules banner.
func IsSAASWorkspace(wsPath string, labels []string) bool {
	for _, l := range labels {
		switch strings.ToLower(strings.TrimSpace(l)) {
		case "work", "saas", "fast-8", "fast8":
			return true
		}
	}
	low := strings.ToLower(strings.ReplaceAll(wsPath, `\`, "/"))
	for _, needle := range []string{"gadjian", "portal-hadirr", "hadirr", "baktiku", "/saas/"} {
		if strings.Contains(low, needle) {
			return true
		}
	}
	return false
}

// AugmentPrompt attaches the internal guidelines plus the composer's context
// references. It is idempotent so a retry never doubles the rules.
func AugmentPrompt(msg, wsPath string, labels, paths, skills []string) string {
	out := msg
	if len(paths) > 0 || len(skills) > 0 {
		var b strings.Builder
		b.WriteString("\n\n---\n[WORKSPACE CONTEXT & REFERENCES]\n")
		if len(paths) > 0 {
			b.WriteString("Relevant files (read these before editing):\n")
			for _, p := range paths {
				b.WriteString("- @" + p + "\n")
			}
		}
		if len(skills) > 0 {
			b.WriteString("Agent skills to apply:\n")
			for _, s := range skills {
				b.WriteString("- $" + s + "\n")
			}
		}
		b.WriteString("---\n")
		if !strings.Contains(out, "[WORKSPACE CONTEXT & REFERENCES]") {
			out += b.String()
		}
	}
	if IsSAASWorkspace(wsPath, labels) && !strings.Contains(out, "[FAST-8 SAAS FRONTEND DEVELOPMENT GUIDELINES]") {
		out += "\n" + SAASDevelopmentGuidelines
	}
	return out
}
