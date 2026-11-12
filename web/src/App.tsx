import { useEffect, useState } from "react";
import { getToken } from "./api";
import { BoardScreen } from "./Board";
import { TaskDrawer } from "./Drawer";
import { Login } from "./Login";
import { ReviewScreen } from "./Review";
import { FlowScreen, OverviewScreen, PipelineScreen, SettingsScreen, WorkersScreen } from "./Screens";

const NAV = [["board", "Board"], ["review", "Review"], ["pipelines", "Pipelines"], ["flow", "Flow map"], ["overview", "Overview"], ["workers", "Workers"], ["settings", "Settings"]] as const;

export function useHash() {
  const read = () => location.hash.replace(/^#\/?/, "");
  const [h, set] = useState(read);
  useEffect(() => { const f = () => set(read()); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  return h;
}

export function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const hash = useHash();
  const [drawer, setDrawer] = useState<string>();
  useEffect(() => { const f = () => setAuthed(false); addEventListener("switchyard:unauth", f); return () => removeEventListener("switchyard:unauth", f); }, []);
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  const [route, arg] = hash.split("/");
  const page = NAV.some(([k]) => k === route) ? route : "board";
  const go = (p: string) => { location.hash = "/" + p; };
  return (
    <div className="shell">
      <nav className="side" aria-label="Main"><h1>Switchyard</h1>
        {NAV.map(([k, l]) => <a key={k} href={`#/${k}`} aria-current={page === k ? "page" : undefined}>{l}</a>)}
      </nav>
      <main>
        {page === "board" && <BoardScreen open={setDrawer} />}
        {page === "review" && <ReviewScreen taskId={arg} pick={(id) => go("review/" + id)} />}
        {page === "pipelines" && <PipelineScreen />}
        {page === "flow" && <FlowScreen open={setDrawer} />}
        {page === "overview" && <OverviewScreen />}
        {page === "workers" && <WorkersScreen />}
        {page === "settings" && <SettingsScreen logout={() => setAuthed(false)} />}
      </main>
      {drawer && <TaskDrawer id={drawer} onClose={() => setDrawer(undefined)} review={(id) => { setDrawer(undefined); go("review/" + id); }} />}
    </div>
  );
}
