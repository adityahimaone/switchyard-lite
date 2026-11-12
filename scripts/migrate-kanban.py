#!/usr/bin/env python3
"""Migrate Hermes kanban per-board SQLite DBs into switchyard-lite.

Idempotent: board ids derive from board name, task ids from old ids.

usage: migrate-kanban.py --src ~/.hermes/kanban/boards --dst data/switchyard-lite.db \
       [--boards f8-saas,f8-bisadaya] [--dry-run]
"""
import argparse, hashlib, os, sqlite3, sys, time

# old Hermes status -> switchyard-lite status machine
STATUS = {
    "triage": "todo",
    "todo": "todo",
    "backlog": "backlog",
    "archived": "backlog",
    "blocked": "blocked",
    "in_progress": "in_progress",
    "review": "review",
    "done": "done",
    "failed": "failed",
}


def det_id(prefix, key, used):
    i = 0
    while True:
        raw = key if i == 0 else f"{key}:{i}"
        cand = prefix + hashlib.md5(raw.encode()).hexdigest()[:12]
        if cand not in used:
            used.add(cand)
            return cand
        i += 1


def cols(con, table):
    return {r[1] for r in con.execute(f"PRAGMA table_info({table})")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=os.path.expanduser("~/.hermes/kanban/boards"))
    ap.add_argument("--dst", required=True)
    ap.add_argument("--boards", default="")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    want = [b.strip() for b in a.boards.split(",") if b.strip()]
    names = sorted(
        d for d in os.listdir(a.src)
        if os.path.isfile(os.path.join(a.src, d, "kanban.db"))
        and (not want or d in want)
    )
    if not names:
        sys.exit("no board db found")

    dst = sqlite3.connect(a.dst)
    dst.execute("PRAGMA journal_mode=WAL")
    boards_used = {r[0] for r in dst.execute("SELECT id FROM boards")}
    tasks_used = {r[0] for r in dst.execute("SELECT id FROM tasks")}

    total_boards = total_tasks = total_skipped = 0
    for name in names:
        src = sqlite3.connect(f"file:{a.src}/{name}/kanban.db?mode=ro", uri=True)
        c = cols(src, "tasks")
        existing = dst.execute("SELECT id FROM boards WHERE name=?", (name,)).fetchone()
        bid = existing[0] if existing else det_id("b", name, boards_used)
        now = int(time.time())
        fresh_board = existing is None
        if fresh_board:
            dst.execute("INSERT INTO boards(id,name,created_at) VALUES(?,?,?)", (bid, name, now))
            total_boards += 1

        sel = ["id", "title", "status", "created_at"]
        sel += [x for x in ("body", "workspace_path", "executor", "model", "effort",
                            "completed_at", "consecutive_failures") if x in c]
        rows = src.execute(f"SELECT {','.join(sel)} FROM tasks").fetchall()
        headers = sel

        for row in rows:
            r = dict(zip(headers, row))
            raw = r["status"] or "triage"
            if raw not in STATUS:
                print(f"  ! {name}/{r['id']}: unknown status {raw!r} -> todo", file=sys.stderr)
            status = STATUS.get(raw, "todo")
            tid = r["id"]
            if tid in tasks_used:
                total_skipped += 1
                continue
            created = r.get("created_at") or now
            updated = r.get("completed_at") or created
            dst.execute(
                """INSERT INTO tasks(id,board_id,parent_id,run_id,stage_id,title,prompt,acceptance,
                       status,workspace,executor,model,effort,retry_count,error_sig,created_at,updated_at)
                   VALUES(?,?,'','','',?,?,'',?,?,?,?,?,?,'',?,?)""",
                (tid, bid, r["title"] or "(untitled)", r.get("body") or "", status,
                 r.get("workspace_path") or "", r.get("executor") or "", r.get("model") or "",
                 r.get("effort") or "", r.get("consecutive_failures") or 0, created, updated),
            )
            tasks_used.add(tid)
            total_tasks += 1
        src.close()
        print(f"{name}: {len(rows)} tasks -> board {bid}")

    if a.dry_run:
        dst.rollback()
    else:
        dst.commit()
    print(f"boards={total_boards} tasks_inserted={total_tasks} skipped_existing={total_skipped}"
          f"{' (dry-run, rolled back)' if a.dry_run else ''}")


if __name__ == "__main__":
    main()