.PHONY: dev build test lint web

build: web
	@mkdir -p bin
	go build -o bin/switchyard-lite ./cmd/switchyard-lite

web:
	pnpm -C web install --frozen-lockfile
	pnpm -C web build

test:
	go test -race ./...
	pnpm -C web test

lint:
	go vet ./...
	pnpm -C web exec tsc --noEmit

dev:
	go run ./cmd/switchyard-lite serve
