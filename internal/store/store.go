// Package store owns the single SQLite database.
package store

import (
	"database/sql"
	_ "embed"
	"fmt"
	"strings"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schema string

//go:embed schema_dispatch.sql
var schemaProjects string

//go:embed schema_pipeline.sql
var schemaPipeline string

type Store struct{ DB *sql.DB }

// Open opens (and migrates) the database at path. Use ":memory:" in tests.
func Open(path string) (*Store, error) {
	dsn := path
	if path != ":memory:" {
		dsn = "file:" + path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)"
	} else {
		dsn = "file::memory:?_pragma=foreign_keys(1)"
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // serialises writers; keeps :memory: coherent
	for _, ddl := range []string{schema, schemaProjects, schemaPipeline} {
		if _, err := db.Exec(ddl); err != nil {
			return nil, fmt.Errorf("migrate: %w", err)
		}
	}
	for _, col := range []string{
		`ALTER TABLE tasks ADD COLUMN paths TEXT NOT NULL DEFAULT '[]'`,
		`ALTER TABLE tasks ADD COLUMN skills TEXT NOT NULL DEFAULT '[]'`,
		`ALTER TABLE tasks ADD COLUMN branch TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE tasks ADD COLUMN result TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE tasks ADD COLUMN started_at INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE tasks ADD COLUMN completed_at INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE dispatch_workspaces ADD COLUMN host TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE dispatch_workspaces ADD COLUMN os TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE dispatch_workspaces ADD COLUMN kind TEXT NOT NULL DEFAULT 'dir'`,
		`ALTER TABLE dispatch_workspaces ADD COLUMN labels TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE dispatch_workspaces ADD COLUMN note TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE task_worktrees ADD COLUMN transport TEXT NOT NULL DEFAULT 'local'`,
	} {
		if _, err := db.Exec(col); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
			return nil, fmt.Errorf("migrate column: %w", err)
		}
	}
	return &Store{DB: db}, nil
}

func (s *Store) Close() error { return s.DB.Close() }
