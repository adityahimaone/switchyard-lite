package dispatch

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/adityahimaone/switchyard-lite/internal/skills"
	"github.com/adityahimaone/switchyard-lite/internal/tasks"
	"github.com/adityahimaone/switchyard-lite/internal/worker"
)

// stageTaskContext stages uploaded attachments, selected SKILL.md bundles, and
// selected MCP server definitions into <workspace>/.switchyard/ (locally or
// via node-agent Lane A stage_files RPC) and returns a prompt preamble listing
// the staged relative paths.
func (d *Dispatcher) stageTaskContext(ctx context.Context, t tasks.Task, workspace string) string {
	if strings.TrimSpace(workspace) == "" {
		return ""
	}
	var files []worker.StagedFile
	var attPaths []string
	var skillPaths []string
	var mcpNames []string

	// 1. Task attachments (uploaded files & Cmd+V pasted screenshots).
	rows, err := d.S.DB.Query(`SELECT name, content FROM attachments WHERE task_id=? ORDER BY id`, t.ID)
	if err == nil {
		for rows.Next() {
			var name string
			var data []byte
			if rows.Scan(&name, &data) == nil && len(data) > 0 {
				safe := sanitizeStageName(name)
				rel := filepath.ToSlash(filepath.Join(".switchyard", "attachments", t.ID, safe))
				files = append(files, worker.StagedFile{
					RelPath:    rel,
					DataBase64: base64.StdEncoding.EncodeToString(data),
					Mode:       0o644,
				})
				attPaths = append(attPaths, rel)
			}
		}
		rows.Close()
	}

	// 2. Selected SKILL.md bundles.
	if len(t.Skills) > 0 {
		reg := skills.NewFromEnv()
		catalog := reg.List(false)
		byName := make(map[string]skills.Skill, len(catalog))
		for _, s := range catalog {
			byName[strings.ToLower(s.Name)] = s
		}
		for _, name := range t.Skills {
			sk, ok := byName[strings.ToLower(strings.TrimSpace(name))]
			if !ok || sk.AbsPath == "" {
				continue
			}
			mdPath := filepath.Join(sk.AbsPath, "SKILL.md")
			raw, err := os.ReadFile(mdPath)
			if err != nil || len(raw) == 0 || len(raw) > 256*1024 {
				continue
			}
			rel := filepath.ToSlash(filepath.Join(".switchyard", "skills", sanitizeStageName(sk.Name), "SKILL.md"))
			files = append(files, worker.StagedFile{
				RelPath:    rel,
				DataBase64: base64.StdEncoding.EncodeToString(raw),
				Mode:       0o644,
			})
			skillPaths = append(skillPaths, rel)
		}
	}

	// 3. Selected MCP servers -> .switchyard/mcp.json.
	if len(t.MCPs) > 0 {
		mcpConfig := map[string]any{}
		for _, idOrName := range t.MCPs {
			var id, name, transport, command, argsJSON, url, envJSON string
			var enabled int
			err := d.S.DB.QueryRow(`SELECT id,name,transport,command,args_json,url,env_json,enabled FROM mcp_servers WHERE (id=? OR name=?) AND enabled=1`, idOrName, idOrName).
				Scan(&id, &name, &transport, &command, &argsJSON, &url, &envJSON, &enabled)
			if err != nil {
				continue
			}
			entry := map[string]any{"transport": transport}
			if command != "" {
				entry["command"] = command
			}
			var args []string
			if json.Unmarshal([]byte(argsJSON), &args) == nil && len(args) > 0 {
				entry["args"] = args
			}
			if url != "" {
				entry["url"] = url
			}
			var env map[string]string
			if json.Unmarshal([]byte(envJSON), &env) == nil && len(env) > 0 {
				entry["env"] = env
			}
			mcpConfig[name] = entry
			mcpNames = append(mcpNames, name)
		}
		if len(mcpConfig) > 0 {
			raw, err := json.MarshalIndent(map[string]any{"mcpServers": mcpConfig}, "", "  ")
			if err == nil {
				files = append(files, worker.StagedFile{
					RelPath:    ".switchyard/mcp.json",
					DataBase64: base64.StdEncoding.EncodeToString(raw),
					Mode:       0o644,
				})
			}
		}
	}

	if len(files) == 0 {
		return ""
	}

	// Stage locally if workspace exists on control plane, otherwise via Lane A stage_files RPC.
	if st, err := os.Stat(workspace); err == nil && st.IsDir() {
		for _, f := range files {
			raw, err := base64.StdEncoding.DecodeString(f.DataBase64)
			if err != nil {
				continue
			}
			dst := filepath.Join(workspace, filepath.FromSlash(f.RelPath))
			_ = os.MkdirAll(filepath.Dir(dst), 0o755)
			_ = os.WriteFile(dst, raw, 0o644)
		}
	} else if d.Remote != nil && d.Remote.Enabled() {
		_ = d.Remote.StageFiles(ctx, workspace, files)
	}

	var b strings.Builder
	b.WriteString("[STAGED CONTEXT]\n")
	if len(attPaths) > 0 {
		b.WriteString("Attached files/images staged in worktree:\n")
		for _, p := range attPaths {
			b.WriteString("- " + p + "\n")
		}
	}
	if len(skillPaths) > 0 {
		b.WriteString("Selected skill instructions staged in worktree (read before editing):\n")
		for _, p := range skillPaths {
			b.WriteString("- " + p + "\n")
		}
	}
	if len(mcpNames) > 0 {
		b.WriteString(fmt.Sprintf("Selected MCP servers configured in .switchyard/mcp.json: %s\n", strings.Join(mcpNames, ", ")))
	}
	b.WriteString("[/STAGED CONTEXT]\n")
	return b.String()
}

func sanitizeStageName(name string) string {
	base := filepath.Base(strings.TrimSpace(name))
	if base == "" || base == "." || base == ".." {
		return "file.bin"
	}
	return strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '-' || r == '_' {
			return r
		}
		return '_'
	}, base)
}
