.PHONY: install migrate dev dev-backend dev-frontend start test e2e lint format gen-api-types \
	eval eval-table costs screenshots

install:
	cd backend && uv sync
	cd frontend && pnpm install

migrate:
	cd backend && uv run shortlist migrate

# Backend on 127.0.0.1:8000 (reload) + Vite dev server on 127.0.0.1:5173 (proxies /api).
dev: migrate
	$(MAKE) -j2 dev-backend dev-frontend

dev-backend:
	cd backend && uv run shortlist serve --reload

dev-frontend:
	cd frontend && pnpm dev --open

# Build the frontend and serve everything from FastAPI on http://127.0.0.1:8000.
start: migrate
	cd frontend && pnpm build
	cd backend && uv run shortlist serve

test:
	cd backend && uv run pytest
	cd frontend && pnpm test

# One browser flow against the real backend with fixture data instead of Apify.
# First time: cd frontend && pnpm exec playwright install chromium
e2e:
	cd frontend && pnpm e2e

lint:
	cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy
	cd frontend && pnpm lint && pnpm typecheck

format:
	cd backend && uv run ruff check --fix . && uv run ruff format .

# Regenerate frontend/src/api/schema.d.ts from the FastAPI OpenAPI schema.
gen-api-types:
	mkdir -p frontend/node_modules/.tmp
	cd backend && uv run shortlist openapi > ../frontend/node_modules/.tmp/openapi.json
	cd frontend && pnpm gen:api

# Evaluate a model on the labelled jobs and update the README table.
#   make eval MODEL=qwen3.5:9b            (default: the model in Settings)
#   make eval MODEL=... PROMPT=v3-checklist ALL=1
eval:
	cd backend && uv run shortlist eval $(if $(MODEL),--model $(MODEL)) \
		$(if $(PROMPT),--prompt $(PROMPT)) $(if $(ALL),--all)
	$(MAKE) eval-table

eval-table:
	cd backend && uv run shortlist eval-table --write ../README.md

# Estimated Apify cost per month from the run history -> eval/results/apify_costs.json
costs:
	cd backend && uv run shortlist costs

# README screenshots and the demo GIF from fixture data (invented companies). Needs ffmpeg.
screenshots:
	cd frontend && pnpm screenshots
