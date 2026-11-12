import { useEffect, useState } from "react";
import { api, apiOr, post, setToken } from "./api";
import { ErrorBox } from "./ui";

export function Login({ onDone }: { onDone: () => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [tok, setTok] = useState("");
  const [err, setErr] = useState<unknown>();
  useEffect(() => { apiOr<{ login_enabled: boolean }>("/api/v1/session", { login_enabled: false }).then((r) => setEnabled(r.login_enabled), () => setEnabled(false)); }, []);

  async function login(e: React.FormEvent) {
    e.preventDefault(); setErr(undefined);
    try { const r = await post<{ token: string }>("/api/v1/session", { password: pw }); setToken(r.token); onDone(); }
    catch (x) { setErr(x); }
  }
  async function useToken(e: React.FormEvent) {
    e.preventDefault(); setErr(undefined);
    setToken(tok.trim());
    try { await api("/api/v1/boards"); onDone(); } catch (x) { setToken(""); setErr(x); }
  }
  return (
    <main style={{ maxWidth: 380, margin: "10vh auto" }}>
      <h1>Switchyard</h1>
      <ErrorBox error={err} />
      {enabled === false && <p className="muted">Password login is disabled. Set <code>SWITCHYARD_ADMIN_PASSWORD</code> and restart the server, or paste an API token below.</p>}
      {enabled && (
        <form onSubmit={login} className="panel">
          <label className="f">Admin password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></label>
          <button className="btn primary">Sign in</button>
        </form>
      )}
      <form onSubmit={useToken} className="panel">
        <label className="f">API token<input value={tok} onChange={(e) => setTok(e.target.value)} placeholder="syl_…" /></label>
        <button className="btn">Use token</button>
      </form>
    </main>
  );
}
