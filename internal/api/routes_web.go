package api

import (
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/adityahimaone/switchyard-lite/internal/webui"
)

func init() {
	registrars = append(registrars, func(m *http.ServeMux, a *API) {
		m.Handle("GET /", spaHandler(webui.FS()))
	})
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
				files.ServeHTTP(w, r)
				return
			}
		}
		b, err := fs.ReadFile(root, "index.html")
		if err != nil {
			http.Error(w, "web UI not built: run `make build`", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(b)
	})
}
