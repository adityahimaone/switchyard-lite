package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/adityahimaone/switchyard-lite/internal/api"
	"github.com/adityahimaone/switchyard-lite/internal/mcp"
	"github.com/adityahimaone/switchyard-lite/internal/store"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Println("usage: switchyard-lite serve|token create [flags]")
		os.Exit(2)
	}
	switch os.Args[1] {
	case "serve":
		fs := flag.NewFlagSet("serve", flag.ExitOnError)
		addr := fs.String("addr", ":8790", "listen address")
		db := fs.String("db", "switchyard-lite.db", "sqlite path")
		_ = fs.Parse(os.Args[2:])
		s, err := store.Open(*db)
		if err != nil {
			log.Fatal(err)
		}
		log.Printf("listening on %s", *addr)
		log.Fatal(http.ListenAndServe(*addr, api.New(s).Handler()))
	case "mcp":
		url, tok := os.Getenv("SWITCHYARD_URL"), os.Getenv("SWITCHYARD_TOKEN")
		if url == "" || tok == "" {
			log.Fatal("SWITCHYARD_URL and SWITCHYARD_TOKEN are required")
		}
		if err := mcp.NewServer(mcp.NewHTTPBackend(url, tok)).Run(context.Background(), &sdk.StdioTransport{}); err != nil {
			log.Fatal(err)
		}
	case "token":
		fs := flag.NewFlagSet("token", flag.ExitOnError)
		db := fs.String("db", "switchyard-lite.db", "sqlite path")
		name := fs.String("name", "agent", "token name")
		scope := fs.String("scope", "write", "read|write|admin")
		_ = fs.Parse(os.Args[3:])
		s, err := store.Open(*db)
		if err != nil {
			log.Fatal(err)
		}
		tok, err := api.CreateToken(s, *name, *scope)
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println(tok)
	default:
		fmt.Println("unknown command")
		os.Exit(2)
	}
}
