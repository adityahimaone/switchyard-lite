package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"github.com/adityahimaone/switchyard-lite/internal/store"
)

var rank = map[string]int{"read": 1, "write": 2, "admin": 3}

func hashToken(t string) string { h := sha256.Sum256([]byte(t)); return hex.EncodeToString(h[:]) }

// CreateToken mints a token; the plaintext is returned once and only its hash is stored.
func CreateToken(s *store.Store, name, scope string) (string, error) {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	tok := "syl_" + hex.EncodeToString(b)
	_, err := s.DB.Exec(`INSERT INTO api_tokens(name,hash,scope,created_at) VALUES(?,?,?,?)`,
		name, hashToken(tok), scope, time.Now().Unix())
	return tok, err
}

// require wraps a handler and enforces a minimum scope.
func (a *API) require(scope string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tok := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if tok == "" {
			fail(w, http.StatusUnauthorized, "missing bearer token")
			return
		}
		var got string
		if err := a.S.DB.QueryRow(`SELECT scope FROM api_tokens WHERE hash=?`, hashToken(tok)).Scan(&got); err != nil {
			fail(w, http.StatusUnauthorized, "invalid token")
			return
		}
		if rank[got] < rank[scope] {
			fail(w, http.StatusForbidden, "token scope "+got+" lacks "+scope)
			return
		}
		h(w, r)
	}
}
