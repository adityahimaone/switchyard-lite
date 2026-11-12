// Package models proxies node-agent's model catalog with a short cache.
package models

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type entry struct {
	at   time.Time
	data json.RawMessage
}

// Catalog caches GET {base}/api/models?executor=.
type Catalog struct {
	BaseURL string
	Token   string
	TTL     time.Duration
	HTTP    *http.Client
	Now     func() time.Time

	mu    sync.Mutex
	cache map[string]entry
}

func New(base, token string) *Catalog {
	return &Catalog{BaseURL: base, Token: token, TTL: 5 * time.Minute, Now: time.Now, cache: map[string]entry{}}
}

// List returns the node-agent's raw JSON for an executor.
func (c *Catalog) List(ctx context.Context, executor string, refresh bool) (json.RawMessage, error) {
	c.mu.Lock()
	e, hit := c.cache[executor]
	c.mu.Unlock()
	if hit && !refresh && c.Now().Sub(e.at) < c.TTL {
		return e.data, nil
	}
	u := strings.TrimRight(c.BaseURL, "/") + "/api/models?executor=" + url.QueryEscape(executor)
	req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
	if err != nil {
		return nil, err
	}
	if c.Token != "" {
		req.Header.Set("X-Node-Agent-Token", c.Token)
	}
	h := c.HTTP
	if h == nil {
		h = &http.Client{Timeout: 15 * time.Second}
	}
	resp, err := h.Do(req)
	if err == nil {
		defer resp.Body.Close()
		if resp.StatusCode/100 != 2 {
			err = fmt.Errorf("node-agent models: %d", resp.StatusCode)
		} else {
			var raw json.RawMessage
			if err = json.NewDecoder(resp.Body).Decode(&raw); err == nil {
				c.mu.Lock()
				c.cache[executor] = entry{c.Now(), raw}
				c.mu.Unlock()
				return raw, nil
			}
		}
	}
	if hit { // serve stale on upstream failure
		return e.data, nil
	}
	return nil, err
}
