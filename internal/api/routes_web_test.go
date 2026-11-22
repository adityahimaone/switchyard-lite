package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestSPAHandlerCachingAndMissingAssets(t *testing.T) {
	root := fstest.MapFS{
		"index.html":           {Data: []byte(`<!doctype html><script src="/assets/index-abc.js"></script>`)},
		"assets/index-abc.js":  {Data: []byte("console.log(1)")},
		"assets/index-abc.css": {Data: []byte("body{color:red}")},
		"favicon.svg":          {Data: []byte("<svg/>")},
	}
	h := spaHandler(root)

	do := func(method, target string, hdr map[string]string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, target, nil)
		for k, v := range hdr {
			req.Header.Set(k, v)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	t.Run("index has etag and revalidates", func(t *testing.T) {
		first := do("GET", "/", nil)
		if first.Code != 200 {
			t.Fatalf("status %d", first.Code)
		}
		etag := first.Header().Get("ETag")
		if etag == "" {
			t.Fatal("missing ETag: a rebuild cannot invalidate the cached shell")
		}
		if cc := first.Header().Get("Cache-Control"); cc != "no-cache" {
			t.Fatalf("index cache-control = %q", cc)
		}
		second := do("GET", "/", map[string]string{"If-None-Match": etag})
		if second.Code != http.StatusNotModified {
			t.Fatalf("expected 304, got %d", second.Code)
		}
		if second.Body.Len() != 0 {
			t.Fatalf("304 must have empty body, got %q", second.Body.String())
		}
	})

	t.Run("hashed assets are immutable", func(t *testing.T) {
		rec := do("GET", "/assets/index-abc.css", nil)
		if rec.Code != 200 {
			t.Fatalf("status %d", rec.Code)
		}
		if cc := rec.Header().Get("Cache-Control"); !strings.Contains(cc, "immutable") {
			t.Fatalf("asset cache-control = %q", cc)
		}
	})

	t.Run("missing asset is 404 not html", func(t *testing.T) {
		rec := do("GET", "/assets/index-gone.css", nil)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d (body %q)", rec.Code, rec.Body.String())
		}
		if strings.Contains(rec.Body.String(), "<!doctype html>") {
			t.Fatal("must not fall back to the SPA shell for a missing asset")
		}
	})

	t.Run("client route still gets the shell", func(t *testing.T) {
		rec := do("GET", "/board", nil)
		if rec.Code != 200 || !strings.Contains(rec.Body.String(), "<!doctype html>") {
			t.Fatalf("status %d body %q", rec.Code, rec.Body.String())
		}
	})

	t.Run("api paths never hit the spa", func(t *testing.T) {
		rec := do("GET", "/api/v1/nope", nil)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status %d", rec.Code)
		}
		if strings.Contains(rec.Body.String(), "<!doctype html>") {
			t.Fatal("api path must not return the shell")
		}
	})
}
