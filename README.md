# AIOS

A NestJS API backend that exposes an AI-powered assistant via HTTP. It uses the Vercel AI SDK with a configurable gateway, optional web search, and PostgreSQL (Prisma). The system prompt and branding are customizable, so you can adapt it for your own product or use it as a starter for an AI-backed API.

## Features

- **AI chat endpoint** – `POST /v1/expose/prompt` to get AI-generated responses with optional web search
- **Configurable AI** – Uses [AI SDK](https://sdk.vercel.ai/) with a gateway; model and API key via env
- **Swagger** – API docs at `/v1/docs` with configurable servers and Bearer auth
- **Security** – Helmet, rate limiting, CORS, global validation pipe, and a custom exception filter
- **Database** – PostgreSQL with Prisma (migrations, generate, seed, Studio)
- **Logging** – Custom logger service; timezone set to Africa/Lagos

## Tech stack

- [NestJS](https://nestjs.com/) 11
- [Prisma](https://www.prisma.io/) 7 (PostgreSQL)
- [Vercel AI SDK](https://sdk.vercel.ai/) with `@ai-sdk/gateway`
- [@valyu/ai-sdk](https://www.npmjs.com/package/@valyu/ai-sdk) for web search
- [Swagger](https://docs.nestjs.com/openapi/introduction) (OpenAPI)
- TypeScript, class-validator, class-transformer, Winston

## Prerequisites

- **Node.js** 18+
- **pnpm** (recommended) or npm/yarn
- **PostgreSQL** (local or remote)
- **AI gateway API key** (e.g. from your AI provider / gateway)

## Project setup

```bash
pnpm install
```

## Environment variables

Copy the example env file and set your values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (e.g. `postgresql://user:pass@localhost:5432/aios`) |
| `AI_GATEWAY_API_KEY` | Yes | API key for the AI gateway used by the SDK |
| `AI_MODEL` | No | Model identifier (default: `anthropic/claude-sonnet-4.5`) |
| `PORT` | No | Server port (default: `3000`) |
| `PLATFORM_NAME` | No | Name used in Swagger title and docs (e.g. your product name) |
| `PLATFORM_URL` | No | Main app URL (for Swagger) |
| `DEVELOPMENT_URL` | No | Dev server host (for Swagger) |
| `PRODUCTION_URL` | No | Production host (for Swagger) |

## Database

Generate the Prisma client and run migrations:

```bash
# Apply migrations and generate client
pnpm prisma migrate deploy
pnpm prisma generate

# Optional: seed (current seed is a no-op placeholder)
pnpm run seed
```

For local development with migration creation and Studio:

```bash
pnpm run prisma:dev
```

## Run the project

```bash
# Development (watch mode)
pnpm run start:dev

# Production build and run (includes migrate, generate, seed, then nest build)
pnpm run build
pnpm run start:prod
```

- API: `http://localhost:3000` (or your `PORT`)
- Swagger: `http://localhost:3000/v1/docs`

All routes are under the `v1` prefix.

## Run tests

```bash
# Unit tests
pnpm run test

# E2E tests
pnpm run test:e2e

# Coverage
pnpm run test:cov
```

## API overview

- **Server** – `GET /v1` – Health / hello
- **Expose** – `POST /v1/expose/prompt` – Body: `{ "prompt": "string" }` – Returns AI-generated text (and can use web search internally)

Full request/response details and auth options are in Swagger at `/v1/docs`.

## Project structure (high level)

```
src/
├── app/                 # App module, controller, service
├── lib/                 # Shared libs
│   ├── ai/              # AI service, system prompt (sp.ts)
│   ├── loggger/         # Custom logger
│   └── prisma/          # Prisma service, seed
├── middleware/          # Exception filter, helpers
├── modules/
│   └── expose/          # Expose controller & service (prompt endpoint)
└── main.ts              # Bootstrap, Swagger, CORS, rate limit, validation
```

To change the assistant’s personality and scope, edit the system prompt in `src/lib/ai/sp.ts`.

## Scripts reference

| Script | Description |
|--------|-------------|
| `pnpm run start` | Start once |
| `pnpm run start:dev` | Start in watch mode |
| `pnpm run start:prod` | Run production build (`node dist/main`) |
| `pnpm run build` | Migrate, generate, seed, then `nest build` |
| `pnpm run prisma:dev` | `migrate dev` + generate + Studio |
| `pnpm run prisma:studio` | Open Prisma Studio |
| `pnpm run seed` | Run Prisma seed script |
| `pnpm run lint` | ESLint with fix |
| `pnpm run format` | Prettier on `src` and `test` |

## License

This project is open source. Add a `LICENSE` file (e.g. MIT or your choice) and update `license` in `package.json` when you publish.

## Contributing

Contributions are welcome. Open an issue or a pull request as needed.
