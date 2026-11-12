#!/usr/bin/env python3
"""Migrate workspace + executor-adjacent config into switchyard-lite.

1. Seeds dispatch_workspaces from the live node-agent registry (GET /api/nodes).
2. Fills tasks.workspace from the old board.json default_workdir when empty.

Idempotent (path is UNIQUE). usage:
  NODE_AGENT_TOKEN=... migrate-workspaces.py --dst data/switchyard-lite.db \
      --nodes http://127.0.0.1:8788 --old ~/.hermes/kanban/boards [--dry-run]
"""
import argparse, hashlib, json, os, sqlite3, sys, time, urllib.request

SKIP_PREFIX = ("/home/adityahimaone/.hermes", "/tmp/")


def fetch_nodes(url, token):
    req = urllib.request.Request(url + "/api/nodes", headers={"X-Node-Agent-Token": token})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


def base(path):
    return path.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1] or path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dst", required=True)
    ap.add_argument("--nodes", default="http://127.0.0.1:8788")
    ap.add_argument("--old", default=os.path.expanduser("~/.hermes/kanban/boards"))
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    token = os.environ.get("NODE_AGENT_TOKEN", "")
    if not token:
        sys.exit("NODE_AGENT_TOKEN required")

    dst = sqlite3.connect(a.dst)
    now = int(time.time())
    added = 0
    for node in fetch_nodes(a.nodes, token):
        nid = node.get("node_id", "?")
        for ws in node.get("workspaces") or []:
            if not ws or ws.startswith(SKIP_PREFIX):
                continue
            name = f"{nid}: {base(ws)}"
            wid = "w" + hashlib.md5(ws.encode()).hexdigest()[:12]
            cur = dst.execute(
                "INSERT INTO dispatch_workspaces(id,name,path,created_at) VALUES(?,?,?,?) "
                "ON CONFLICT(path) DO NOTHING", (wid, name, ws, now))
            if cur.rowcount:
                added += 1
                print(f"+ workspace {name}  {ws}")

    # board.json default_workdir -> empty task workspaces
    filled = 0
    for slug in sorted(os.listdir(a.old)):
        bj = os.path.join(a.old, slug, "board.json")
        if not os.path.isfile(bj):
            continue
        dw = (json.load(open(bj)) or {}).get("default_workdir") or ""
        if not dw:
            continue
        n = dst.execute(
            "UPDATE tasks SET workspace=? WHERE board_id=(SELECT id FROM boards WHERE name=?) "
            "AND workspace=''", (dw, slug)).rowcount
        filled += n
        if n:
            print(f"~ {slug}: {n} task(s) workspace -> {dw}")

    if a.dry_run:
        dst.rollback()
        print(f"dry-run: workspaces_added={added} tasks_filled={filled} (rolled back)")
    else:
        dst.commit()
        print(f"workspaces_added={added} tasks_filled={filled}")
    total = dst.execute("SELECT count(*) FROM dispatch_workspaces").fetchone()[0]
    print(f"dispatch_workspaces_total={total}")


if __name__ == "__main__":
    main()