package models

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// AllExecutorIDs defines the canonical list of supported agent harnesses.
var AllExecutorIDs = []string{"agy", "claude", "codex", "commandcode", "omp", "dsh"}

// ExecutorBinaryNames returns the CLI binary name(s) associated with an executor ID.
func ExecutorBinaryNames(executorID string) []string {
	switch strings.ToLower(strings.TrimSpace(executorID)) {
	case "agy", "antigravity":
		return []string{"agy"}
	case "claude":
		return []string{"claude"}
	case "codex":
		return []string{"codex"}
	case "commandcode":
		return []string{"commandcode"}
	case "omp":
		return []string{"omp"}
	case "dsh":
		return []string{"dsh"}
	default:
		if strings.TrimSpace(executorID) == "" {
			return nil
		}
		return []string{strings.ToLower(strings.TrimSpace(executorID))}
	}
}

// ResolveLocalExecutorBinary finds whether the binary for executorID is installed on the host.
func ResolveLocalExecutorBinary(executorID string) (string, bool) {
	home, _ := os.UserHomeDir()
	bins := ExecutorBinaryNames(executorID)
	for _, name := range bins {
		if p, err := exec.LookPath(name); err == nil {
			return p, true
		}
		candidates := []string{
			"/opt/homebrew/bin/" + name,
			"/usr/local/bin/" + name,
		}
		if home != "" {
			candidates = append(candidates,
				filepath.Join(home, ".local", "bin", name),
				filepath.Join(home, ".bun", "bin", name),
				filepath.Join(home, ".cargo", "bin", name),
				filepath.Join(home, "go", "bin", name),
			)
			if nvmMatches, err := filepath.Glob(filepath.Join(home, ".nvm", "versions", "node", "*", "bin", name)); err == nil {
				candidates = append(candidates, nvmMatches...)
			}
		}
		for _, c := range candidates {
			if info, err := os.Stat(c); err == nil && !info.IsDir() {
				return c, true
			}
		}
	}
	return "", false
}

// ProbeLocalExecutors checks binary availability for every known executor on this host.
func ProbeLocalExecutors() map[string]bool {
	out := make(map[string]bool, len(AllExecutorIDs))
	for _, id := range AllExecutorIDs {
		_, ok := ResolveLocalExecutorBinary(id)
		out[id] = ok
	}
	return out
}

// RemoteExecutorProbeCommand builds a read-only shell command that prints `<id>=1` or `<id>=0`
// for each known executor on POSIX (Mac/Linux) or Windows worker nodes.
func RemoteExecutorProbeCommand(isWindows bool) string {
	if isWindows {
		return `powershell -NoProfile -Command "$ids=@('agy','claude','codex','commandcode','omp','dsh'); foreach($b in $ids){ $found=$null -ne (Get-Command $b -ErrorAction SilentlyContinue); if(-not $found){ foreach($d in @(\"$env:USERPROFILE\\.local\\bin\",\"$env:APPDATA\\npm\",\"$env:USERPROFILE\\.bun\\bin\",\"$env:USERPROFILE\\.cargo\\bin\")){ if((Test-Path \"$d\\$b.exe\") -or (Test-Path \"$d\\$b.cmd\")){ $found=$true; break } } }; Write-Output (\"$b=\" + ($(if($found){1}else{0}))) }"`
	}
	return `for b in agy claude codex commandcode omp dsh; do found=0; if command -v "$b" >/dev/null 2>&1; then found=1; else for c in "$HOME/.local/bin/$b" "$HOME/.bun/bin/$b" "$HOME/.cargo/bin/$b" "$HOME/go/bin/$b" /opt/homebrew/bin/"$b" /usr/local/bin/"$b" "$HOME"/.nvm/versions/node/*/bin/"$b"; do if [ -x "$c" ]; then found=1; break; fi; done; fi; printf '%s=%s\n' "$b" "$found"; done`
}

// ParseRemoteExecutorProbe parses `<id>=1` / `<id>=0` output lines into a presence map.
func ParseRemoteExecutorProbe(raw string) map[string]bool {
	out := make(map[string]bool, len(AllExecutorIDs))
	for _, id := range AllExecutorIDs {
		out[id] = false
	}
	for _, line := range strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n") {
		trim := strings.TrimSpace(line)
		eq := strings.IndexByte(trim, '=')
		if eq <= 0 {
			continue
		}
		k := strings.ToLower(strings.TrimSpace(trim[:eq]))
		v := strings.TrimSpace(trim[eq+1:])
		if _, ok := out[k]; ok {
			out[k] = v == "1" || strings.EqualFold(v, "true")
		}
	}
	return out
}

// RemoteAgyModelsCommand returns a command to invoke `agy models` on a remote worker node.
func RemoteAgyModelsCommand(isWindows bool) string {
	if isWindows {
		return `agy models`
	}
	return `AGY=""; for c in "$HOME/.local/bin/agy" "$(command -v agy 2>/dev/null)" /opt/homebrew/bin/agy /usr/local/bin/agy "$HOME"/.nvm/versions/node/*/bin/agy; do [ -x "$c" ] && AGY="$c" && break; done; [ -n "$AGY" ] && "$AGY" models`
}
