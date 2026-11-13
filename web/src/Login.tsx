import { useEffect, useState } from "react";
import { KeyRound, Lock } from "lucide-react";
import { api, apiOr, post, setToken } from "./api";
import { ErrorBox } from "./ui";

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
    <main style={{ maxWidth: 420, margin: "14vh auto", padding: "0 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, justifyContent: "center" }}>
        <span className="brand-mark" aria-hidden>
          S
        </span>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
          Switchyard <span className="lite-badge">LITE</span>
        </h1>
      </div>

      <ErrorBox error={err} />

      {enabled === false && (
        <p className="muted" style={{ textAlign: "center", fontSize: 12, marginBottom: 16 }}>
          Password login is disabled. Set <code>SWITCHYARD_ADMIN_PASSWORD</code> and restart the server, or paste an API token below.
        </p>
      )}

      {enabled && (
        <form onSubmit={login} className="panel" style={{ marginBottom: 14 }}>
          <label className="f">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Lock className="size-3.5 text-[var(--c-ink-3)]" />
              <span>Admin password</span>
            </span>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          </label>
          <button className="btn primary" style={{ width: "100%", marginTop: 4 }}>
            Sign in
          </button>
        </form>
      )}

      <form onSubmit={useToken} className="panel">
        <label className="f">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <KeyRound className="size-3.5 text-[var(--c-ink-3)]" />
            <span>API token</span>
          </span>
          <input value={tok} onChange={(e) => setTok(e.target.value)} placeholder="syl_…" className="mono" />
        </label>
        <button className="btn" style={{ width: "100%", marginTop: 4 }}>
          Use token
        </button>
      </form>
    </main>
  );
}
