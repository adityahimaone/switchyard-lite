.PHONY: dev build test lint web ship ship-fast

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

ship:
	./scripts/ship.sh

ship-fast:
	SHIP_SKIP_TESTS=1 ./scripts/ship.sh

dev:
	go run ./cmd/switchyard-lite serve
