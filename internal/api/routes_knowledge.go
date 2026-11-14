package api

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
)

type knowledgeDoc struct {
	ID        string            `json:"id"`
	Slug      string            `json:"slug"`
	Title     string            `json:"title"`
	Subtitle  string            `json:"subtitle,omitempty"`
	Category  string            `json:"category"`
	Badge     string            `json:"badge,omitempty"`
	Summary   string            `json:"summary,omitempty"`
	Content   string            `json:"content,omitempty"`
	Sections  []json.RawMessage `json:"sections,omitempty"`
	CreatedAt int64             `json:"created_at"`
	UpdatedAt int64             `json:"updated_at"`
}

var nonSlugRe = regexp.MustCompile(`[^a-z0-9-]+`)

func slugifyDoc(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = nonSlugRe.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	return s
}

func newDocID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return "kd_" + hex.EncodeToString(b)
}

func init() {
	registrars = append(registrars, func(m *http.ServeMux, a *API) {
		m.HandleFunc("GET /api/v1/knowledge", a.require("read", func(w http.ResponseWriter, r *http.Request) {
			q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
			cat := strings.TrimSpace(r.URL.Query().Get("category"))
			rows, err := a.S.DB.Query(`SELECT id,slug,title,subtitle,category,badge,summary,content,sections_json,created_at,updated_at FROM knowledge_docs ORDER BY updated_at DESC, created_at DESC`)
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			defer rows.Close()
			out := []knowledgeDoc{}
			for rows.Next() {
				var d knowledgeDoc
				var secRaw string
				if err := rows.Scan(&d.ID, &d.Slug, &d.Title, &d.Subtitle, &d.Category, &d.Badge, &d.Summary, &d.Content, &secRaw, &d.CreatedAt, &d.UpdatedAt); err != nil {
					fail(w, 500, err.Error())
					return
				}
				_ = json.Unmarshal([]byte(secRaw), &d.Sections)
				if cat != "" && !strings.EqualFold(d.Category, cat) {
					continue
				}
				if q != "" {
					hay := strings.ToLower(d.Title + "\n" + d.Subtitle + "\n" + d.Summary + "\n" + d.Content + "\n" + d.Category + "\n" + secRaw)
					if !strings.Contains(hay, q) {
						continue
					}
				}
				out = append(out, d)
			}
			ok(w, out)
		}))

		m.HandleFunc("GET /api/v1/knowledge/{slug}", a.require("read", func(w http.ResponseWriter, r *http.Request) {
			key := strings.TrimSpace(r.PathValue("slug"))
			var d knowledgeDoc
			var secRaw string
			err := a.S.DB.QueryRow(
				`SELECT id,slug,title,subtitle,category,badge,summary,content,sections_json,created_at,updated_at FROM knowledge_docs WHERE slug=? OR id=? LIMIT 1`,
				key, key,
			).Scan(&d.ID, &d.Slug, &d.Title, &d.Subtitle, &d.Category, &d.Badge, &d.Summary, &d.Content, &secRaw, &d.CreatedAt, &d.UpdatedAt)
			if errors.Is(err, sql.ErrNoRows) {
				fail(w, 404, "knowledge doc not found")
				return
			}
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			_ = json.Unmarshal([]byte(secRaw), &d.Sections)
			ok(w, d)
		}))

		upsert := a.require("write", func(w http.ResponseWriter, r *http.Request) {
			var in struct {
				Slug     string            `json:"slug"`
				Title    string            `json:"title"`
				Subtitle string            `json:"subtitle"`
				Category string            `json:"category"`
				Badge    string            `json:"badge"`
				Summary  string            `json:"summary"`
				Content  string            `json:"content"`
				Sections []json.RawMessage `json:"sections"`
			}
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20)).Decode(&in); err != nil {
				fail(w, 400, "invalid json")
				return
			}
			pathSlug := strings.TrimSpace(r.PathValue("slug"))
			slug := slugifyDoc(firstNonEmpty(pathSlug, in.Slug))
			if slug == "" {
				slug = slugifyDoc(in.Title)
			}
			if slug == "" || strings.TrimSpace(in.Title) == "" {
				fail(w, 400, "title and slug required")
				return
			}
			category := strings.TrimSpace(in.Category)
			if category == "" {
				category = "Custom Knowledge"
			}
			badge := strings.TrimSpace(in.Badge)
			if badge == "" {
				badge = "Custom"
			}
			secBytes := []byte("[]")
			if len(in.Sections) > 0 {
				if b, err := json.Marshal(in.Sections); err == nil {
					secBytes = b
				}
			}
			now := time.Now().Unix()
			var existingID string
			var createdAt int64
			err := a.S.DB.QueryRow(`SELECT id, created_at FROM knowledge_docs WHERE slug=? OR id=? LIMIT 1`, slug, slug).Scan(&existingID, &createdAt)
			if errors.Is(err, sql.ErrNoRows) {
				id := newDocID()
				if _, err := a.S.DB.Exec(
					`INSERT INTO knowledge_docs(id,slug,title,subtitle,category,badge,summary,content,sections_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
					id, slug, strings.TrimSpace(in.Title), strings.TrimSpace(in.Subtitle), category, badge,
					strings.TrimSpace(in.Summary), in.Content, string(secBytes), now, now,
				); err != nil {
					fail(w, 500, err.Error())
					return
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(201)
				ok(w, knowledgeDoc{
					ID: id, Slug: slug, Title: strings.TrimSpace(in.Title), Subtitle: strings.TrimSpace(in.Subtitle),
					Category: category, Badge: badge, Summary: strings.TrimSpace(in.Summary), Content: in.Content,
					Sections: in.Sections, CreatedAt: now, UpdatedAt: now,
				})
				return
			}
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			if _, err := a.S.DB.Exec(
				`UPDATE knowledge_docs SET title=?, subtitle=?, category=?, badge=?, summary=?, content=?, sections_json=?, updated_at=? WHERE id=?`,
				strings.TrimSpace(in.Title), strings.TrimSpace(in.Subtitle), category, badge,
				strings.TrimSpace(in.Summary), in.Content, string(secBytes), now, existingID,
			); err != nil {
				fail(w, 500, err.Error())
				return
			}
			ok(w, knowledgeDoc{
				ID: existingID, Slug: slug, Title: strings.TrimSpace(in.Title), Subtitle: strings.TrimSpace(in.Subtitle),
				Category: category, Badge: badge, Summary: strings.TrimSpace(in.Summary), Content: in.Content,
				Sections: in.Sections, CreatedAt: createdAt, UpdatedAt: now,
			})
		})
		m.HandleFunc("POST /api/v1/knowledge", upsert)
		m.HandleFunc("PUT /api/v1/knowledge/{slug}", upsert)

		m.HandleFunc("DELETE /api/v1/knowledge/{slug}", a.require("write", func(w http.ResponseWriter, r *http.Request) {
			key := strings.TrimSpace(r.PathValue("slug"))
			res, err := a.S.DB.Exec(`DELETE FROM knowledge_docs WHERE slug=? OR id=?`, key, key)
			if err != nil {
				fail(w, 500, err.Error())
				return
			}
			if n, _ := res.RowsAffected(); n == 0 {
				fail(w, 404, "knowledge doc not found")
				return
			}
			w.WriteHeader(204)
		}))
	})
}
