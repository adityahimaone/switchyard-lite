package api

import (
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"sync"

	"github.com/adityahimaone/switchyard-studio/internal/webui"
)

func init() {
	registrars = append(registrars, func(m *http.ServeMux, a *API) {
		m.Handle("GET /", spaHandler(webui.FS()))
	})
}

// indexDoc is the SPA shell plus a strong validator derived from its bytes.
// index.html is the only file whose name survives a rebuild, so it must never
// be reused from cache: without an ETag the browser has nothing to revalidate
// against and keeps pointing at the previous build's hashed assets.
type indexDoc struct {
	body []byte
	etag string
}

var (
	indexOnce sync.Once
	indexDocV indexDoc
)

func loadIndex(root fs.FS) indexDoc {
	indexOnce.Do(func() {
		b, err := fs.ReadFile(root, "index.html")
		if err != nil {
			return
		}
		sum := sha256.Sum256(b)
		indexDocV = indexDoc{body: b, etag: `"` + hex.EncodeToString(sum[:8]) + `"`}
	})
	return indexDocV
}

// spaHandler serves static files and falls back to index.html for client routes.
func spaHandler(root fs.FS) http.Handler {
	files := http.FileServerFS(root)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			fail(w, http.StatusNotFound, "not found")
			return
		}
		p := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if p != "" {
			if st, err := fs.Stat(root, p); err == nil && !st.IsDir() {
				// Vite emits content-hashed names under /assets, so those are
				// safe to cache forever. Everything else revalidates.
				if strings.HasPrefix(p, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				} else {
					w.Header().Set("Cache-Control", "no-cache")
				}
				files.ServeHTTP(w, r)
				return
			}
			// A missing file under /assets means a stale document asked for a
			// build that no longer exists. Returning the SPA shell with 200
			// makes the browser parse HTML as CSS/JS, so answer honestly.
			if strings.HasPrefix(p, "assets/") {
				w.Header().Set("Cache-Control", "no-store")
				http.Error(w, "asset not found", http.StatusNotFound)
				return
			}
		}
		doc := loadIndex(root)
		if doc.body == nil {
			http.Error(w, "web UI not built: run `make build`", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("ETag", doc.etag)
		if match := r.Header.Get("If-None-Match"); match != "" && strings.Contains(match, doc.etag) {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		_, _ = w.Write(doc.body)
	})
}
