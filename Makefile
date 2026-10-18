.DEFAULT_GOAL := help

PYTHON ?= python3
NPM ?= npm
COMPOSE ?= docker compose
BACKEND_PYTHON := .venv/bin/python
TEST_DB_CONTAINER := notebook-test-postgres
PYTEST_ARGS ?=

.PHONY: help env setup setup-backend setup-frontend up down logs db-up backend frontend \
	migrate seed migrate-local seed-local test-db-up test-db-down test test-backend \
	test-frontend lint lint-backend lint-frontend build check test-pwa smoke

help: ## Show available commands (default)
	@awk 'BEGIN {FS = ":.*## "; print "Local development commands:\n"} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

env: ## Create root and backend .env templates without overwriting existing files
	@test -e .env || cp .env.example .env
	@test -e backend/.env || cp .env.example backend/.env
	@echo "Configure .env for Docker, or backend/.env for native development."

setup: env setup-backend setup-frontend ## Create environment templates and install local dependencies

setup-backend: ## Create the Python virtualenv and install backend development dependencies
	$(PYTHON) -m venv backend/.venv
	cd backend && $(BACKEND_PYTHON) -m pip install -r requirements-dev.txt

setup-frontend: ## Install frontend dependencies from the lockfile
	cd frontend && $(NPM) ci

up: ## Build and start the Docker application stack
	$(COMPOSE) up --build -d --wait

down: ## Stop the Docker application stack, preserving database volumes
	$(COMPOSE) down

logs: ## Follow Docker application logs
	$(COMPOSE) logs -f backend frontend

db-up: ## Start only the development PostgreSQL service
	$(COMPOSE) up -d --wait postgres

backend: ## Run the native backend with hot reload (configure backend/.env first)
	cd backend && $(BACKEND_PYTHON) -m uvicorn app.main:create_app --factory --reload --host 127.0.0.1 --port 8000

frontend: ## Run Vite locally (use a second terminal)
	cd frontend && $(NPM) run dev -- --host 127.0.0.1

migrate: ## Apply migrations in the Docker backend
	$(COMPOSE) exec backend python -m alembic upgrade head

seed: ## Explicitly seed the Docker database
	$(COMPOSE) exec backend python -m app.seed

migrate-local: ## Apply migrations using backend/.env or exported environment variables
	cd backend && $(BACKEND_PYTHON) -m alembic upgrade head

seed-local: ## Explicitly seed the native development database
	cd backend && $(BACKEND_PYTHON) -m app.seed

test-db-up: ## Create or start disposable PostgreSQL on localhost:55432 and wait for readiness
	@if docker container inspect $(TEST_DB_CONTAINER) >/dev/null 2>&1; then \
		docker start $(TEST_DB_CONTAINER) >/dev/null; \
	else \
		docker run -d --name $(TEST_DB_CONTAINER) \
			-e POSTGRES_PASSWORD=lexi-test-only -e POSTGRES_DB=lexi_test \
			-p 127.0.0.1:55432:5432 postgres:17-alpine >/dev/null; \
	fi
	@attempt=0; until docker exec $(TEST_DB_CONTAINER) pg_isready -U postgres -d lexi_test >/dev/null 2>&1; do \
		attempt=$$((attempt + 1)); \
		if [ "$$attempt" -ge 30 ]; then echo "Test database did not become ready within 30 attempts." >&2; exit 1; fi; \
		sleep 1; \
	done

test-db-down: ## Stop the disposable test database without deleting it
	docker stop $(TEST_DB_CONTAINER)

test: test-backend test-frontend ## Run backend and frontend tests (start the test database first)

test-backend: ## Run API tests; optionally set PYTEST_ARGS or TEST_DATABASE_URL
	cd backend && $(BACKEND_PYTHON) -m pytest $(PYTEST_ARGS)

test-frontend: ## Run frontend component tests
	cd frontend && $(NPM) test

lint: lint-backend lint-frontend ## Run Python and JavaScript checks

lint-backend: ## Lint and compile Python sources, including migrations
	cd backend && $(BACKEND_PYTHON) -m ruff check app tests alembic
	cd backend && $(BACKEND_PYTHON) -m compileall -q app

lint-frontend: ## Lint JavaScript sources
	cd frontend && $(NPM) run lint

build: ## Build the frontend for production
	cd frontend && $(NPM) run build

check: lint test build ## Run the application checks (requires the test database)

test-pwa: ## Build and run the browser PWA checks (requires Playwright Chromium)
	cd frontend && $(NPM) run test:pwa

smoke: ## Check a running app; export SHARED_PASSWORD and optionally SMOKE_BASE_URL
	backend/$(BACKEND_PYTHON) scripts/smoke.py
