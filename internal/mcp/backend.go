// Package mcp exposes the switchyard-lite REST API as MCP tools.
package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
)

// Backend performs REST calls against the switchyard API.
type Backend interface {
	Do(ctx context.Context, method, path string, body any) (status int, data []byte, err error)
}

func encode(body any) (io.Reader, error) {
	if body == nil {
		return nil, nil
	}
	b, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(b), nil
}

type httpBackend struct {
	base, token string
	c           *http.Client
}

// NewHTTPBackend talks to a remote server at baseURL with a bearer token.
func NewHTTPBackend(baseURL, token string) Backend {
	return &httpBackend{base: strings.TrimRight(baseURL, "/"), token: token, c: http.DefaultClient}
}

func (b *httpBackend) Do(ctx context.Context, method, path string, body any) (int, []byte, error) {
	rd, err := encode(body)
	if err != nil {
		return 0, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, method, b.base+path, rd)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+b.token)
	if rd != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := b.c.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	return resp.StatusCode, data, err
}

type handlerBackend struct {
	h    http.Handler
	auth string
}

// NewHandlerBackend calls an in-process handler, forwarding the given Authorization header value.
func NewHandlerBackend(h http.Handler, authorization string) Backend {
	return &handlerBackend{h: h, auth: authorization}
}

func (b *handlerBackend) Do(ctx context.Context, method, path string, body any) (int, []byte, error) {
	rd, err := encode(body)
	if err != nil {
		return 0, nil, err
	}
	if rd == nil {
		rd = http.NoBody
	}
	req := httptest.NewRequest(method, path, rd).WithContext(ctx)
	req.Header.Set("Authorization", b.auth)
	w := httptest.NewRecorder()
	b.h.ServeHTTP(w, req)
	return w.Code, w.Body.Bytes(), nil
}

func httpErr(status int, data []byte) error {
	return fmt.Errorf("HTTP %d: %s", status, strings.TrimSpace(string(data)))
}
