import { useEffect, useState } from "react";
import { KeyRound, Lock } from "lucide-react";
import { api, apiOr, post, setToken } from "./api";
import { ErrorBox } from "./ui";
import { BrandLockup } from "@/components/ui/brand";

export function Login({ onDone }: { onDone: () => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [tok, setTok] = useState("");
  const [err, setErr] = useState<unknown>();

  useEffect(() => {
    apiOr<{ login_enabled: boolean }>("/api/v1/session", { login_enabled: false }).then(
      (r) => setEnabled(r.login_enabled),
      () => setEnabled(false)
    );
  }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setErr(undefined);
    try {
      const r = await post<{ token: string }>("/api/v1/session", { password: pw });
      setToken(r.token);
      onDone();
    } catch (x) {
      setErr(x);
    }
  }

  async function useToken(e: React.FormEvent) {
    e.preventDefault();
    setErr(undefined);
    setToken(tok.trim());
    try {
      await api("/api/v1/boards");
      onDone();
    } catch (x) {
      setToken("");
      setErr(x);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[440px] flex-col justify-center px-4 py-12">
      <div className="rounded-[28px] border border-line bg-well/70 p-2 shadow-[var(--lift-3)]">
        <div className="rounded-[20px] border border-line bg-surface p-6 shadow-[var(--lift-1),var(--lift-inset)]">
          <div className="mb-5 flex flex-col items-center gap-2 text-center">
            <BrandLockup size={34} />
            <p className="m-0 text-xs text-ink-3">
              Autonomous coding agent dispatch, worktree isolation &amp; diff review gate.
            </p>
          </div>

          <ErrorBox error={err} />

          {enabled === false && (
            <p className="muted mb-4 rounded-[12px] border border-line bg-well/60 px-3 py-2 text-center text-xs leading-relaxed">
              Password login is disabled. Set <code>SWITCHYARD_ADMIN_PASSWORD</code> and restart the server, or paste an API token below.
            </p>
          )}

          {enabled && (
            <form onSubmit={login} className="mb-4 space-y-3 border-b border-line pb-4">
              <label className="f mb-0">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-2">
                  <Lock className="size-3.5 text-ink-3" />
                  <span>Admin password</span>
                </span>
                <input
                  type="password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  autoFocus
                  placeholder="Enter admin password…"
                />
              </label>
              <button className="btn primary w-full justify-center">
                Sign in
              </button>
            </form>
          )}

          <form onSubmit={useToken} className="space-y-3">
            <label className="f mb-0">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-2">
                <KeyRound className="size-3.5 text-ink-3" />
                <span>API token</span>
              </span>
              <input
                value={tok}
                onChange={(e) => setTok(e.target.value)}
                placeholder="syl_…"
                className="mono"
              />
            </label>
            <button className="btn obsidian w-full justify-center">
              Use token
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
