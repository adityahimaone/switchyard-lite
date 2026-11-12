package api

import (
	"net/http"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/adityahimaone/switchyard-lite/internal/mcp"
)

func init() {
	registrars = append(registrars, func(m *http.ServeMux, a *API) {
		h := sdk.NewStreamableHTTPHandler(func(r *http.Request) *sdk.Server {
			// Tool calls re-enter the REST mux with the caller's own token, so scopes are enforced per endpoint.
			return mcp.NewServer(mcp.NewHandlerBackend(m, r.Header.Get("Authorization")))
		}, nil)
		gated := a.require("read", h.ServeHTTP)
		for _, meth := range []string{"GET", "POST", "DELETE"} {
			m.HandleFunc(meth+" /mcp", gated)
		}
	})
}
