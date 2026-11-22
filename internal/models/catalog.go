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
	BaseURL      string
	Token        string
	TTL          time.Duration
	HTTP         *http.Client
	Now          func() time.Time
	RunAgyModels func(ctx context.Context) ([]byte, error)

	mu    sync.Mutex
	cache map[string]entry
}

func New(base, token string) *Catalog {
	return &Catalog{BaseURL: base, Token: token, TTL: 5 * time.Minute, Now: time.Now, cache: map[string]entry{}}
}

func (c *Catalog) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

// List returns the executor's model catalog JSON (via node-agent or local CLI).
func (c *Catalog) List(ctx context.Context, executor string, refresh bool) (json.RawMessage, error) {
	c.mu.Lock()
	e, hit := c.cache[executor]
	c.mu.Unlock()
	if hit && !refresh && c.now().Sub(e.at) < c.TTL {
		return e.data, nil
	}
	if isAgyExecutor(executor) {
		raw := c.listAgyModels(ctx, executor)
		c.mu.Lock()
		if c.cache == nil {
			c.cache = map[string]entry{}
		}
		c.cache[executor] = entry{at: c.now(), data: raw}
		c.mu.Unlock()
		return raw, nil
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
