package store

import (
	_ "embed"
	"fmt"
)

//go:embed schema_dispatch.sql
var schemaDispatch string

// EnsureDispatch applies the dispatch tables. Idempotent and additive.
func (s *Store) EnsureDispatch() error {
	if _, err := s.DB.Exec(schemaDispatch); err != nil {
		return fmt.Errorf("migrate dispatch: %w", err)
	}
	return nil
}
