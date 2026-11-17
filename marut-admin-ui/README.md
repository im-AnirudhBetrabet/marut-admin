# MARUT Admin Frontend

Production-oriented React + TypeScript + Vite foundation for MARUT Admin V2.

## Requirements

- Node.js 20.19+ or 22.12+
- npm 10+

## Getting started

```bash
npm install
cp .env.example .env
npm run dev
```

## Quality checks

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## Architecture boundaries

- This repository contains the frontend only.
- The frontend communicates with the backend through versioned REST APIs.
- Do not connect to Supabase or the database directly from browser code.
- Business rules and authorization enforcement belong to the backend.
- API contracts should follow the backend's published OpenAPI specification.
- Feature functionality is intentionally represented by placeholders at this stage.

## Project structure

```text
src/
  app/          Application composition and route definitions
  components/   Shared UI primitives
  features/     Feature-specific modules (added incrementally)
  hooks/        Shared React hooks
  layouts/      Application shell and navigation
  pages/        Route-level pages/placeholders
  services/     API client and integration boundaries
  styles/       Design tokens, global styles and layout styles
  tests/        Test setup and smoke tests
  types/        Shared frontend types
```

## Implementation sequence

Build one approved capability at a time. Avoid adding mock business logic or speculative API contracts to the skeleton.
