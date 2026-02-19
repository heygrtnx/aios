# AIOS

A NestJS API backend that exposes an AI-powered assistant through a REST API. It uses the Vercel AI SDK with a configurable gateway, optional web search (Valyu), and PostgreSQL (Prisma). The system prompt and branding are customizable, so you can adapt it for your own product or use it as a starter for an AI-backed API.

## Features

- **AI chat endpoint** – `POST /v1/expose/prompt` to get AI-generated responses with optional web search (powered by [Valyu](https://www.npmjs.com/package/@valyu/ai-sdk))
- **Streaming endpoint** – `POST /v1/expose/prompt/stream` to stream the AI response as `text/plain` (chunked)
- **Configurable AI** – Uses [AI SDK](https://sdk.vercel.ai/) with a gateway; model and API key via env
- **Optional API key auth** – Set `API_KEY` in env to require an `x-api-key` header on all routes; omit for open access. When open access: only domains listed in `DOMAIN_CHAT` (one or more, comma-separated) have a per-day-per-IP limit (default **5**, or `PROMPTS_PER_DAY_CHAT`); all other domains are **unlimited**. Omit `DOMAIN_CHAT` for unlimited prompts everywhere.
- **Demo page** – Root URL serves a simple streaming chat UI (`public/index.html`): prompt box, Enter to send, Shift+Enter for new line.
- **API docs** – [Scalar](https://scalar.com/) API reference at `/v1/docs` with configurable servers and Bearer auth
- **Security** – Helmet, rate limiting, CORS, global validation pipe, and a custom exception filter
- **Database** – PostgreSQL with Prisma (migrations, generate, seed, Studio)
- **Logging** – Custom logger service; timezone set to Africa/Lagos

## Tech stack

- [NestJS](https://nestjs.com/) 11
- [Prisma](https://www.prisma.io/) 7 (PostgreSQL)
- [Vercel AI SDK](https://sdk.vercel.ai/) with `@ai-sdk/gateway`
- [Valyu](https://www.npmjs.com/package/@valyu/ai-sdk) (`@valyu/ai-sdk`) for web search
- [Scalar](https://scalar.com/) + [NestJS Swagger](https://docs.nestjs.com/openapi/introduction) (OpenAPI)
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

Copy the example file and set your values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (e.g. `postgresql://user:pass@localhost:5432/aios`) |
| `AI_GATEWAY_API_KEY` | Yes | API key for the AI gateway used by the SDK |
| `AI_MODEL` | No | Model identifier (default: `openai/gpt-4o-mini`) |
| `VALYU_API_KEY` | No | Valyu API key for web search (get free key at [platform.valyu.ai](https://platform.valyu.ai)); omit to disable web search |
| `PORT` | No | Server port (default: `3000`) |
| `API_KEY` | No | If set, all routes require an `x-api-key: <value>` header. Omit or leave blank for open access. |
| `DOMAIN_CHAT` | No | When `API_KEY` is not set: comma-separated list of hostnames that get a per-day-per-IP limit (request `Host` must match one). Only these domains are limited; all other domains are **unlimited**. Omit for unlimited everywhere. |
| `PROMPTS_PER_DAY_CHAT` | No | For domains listed in `DOMAIN_CHAT`, this many prompts per day per IP (default **5**). Ignored if `DOMAIN_CHAT` is not set. |
| `PLATFORM_NAME` | No | Name used in API docs title (e.g. your product name) |
| `PLATFORM_URL` | No | Main app URL (for API docs). Also used for branding: copyright is shown on localhost and when the request host is the same as or a subdomain of this URL’s host; otherwise it is hidden. |
| `DEVELOPMENT_URL` | No | Dev server host (for API docs) |
| `PRODUCTION_URL` | No | Production host (for API docs) |
| `AUTHOR_NAME` | No | Author handle shown in the demo UI header ("by X") and footer when the request is from `PLATFORM_URL` or a subdomain; omit to hide both |
| `AUTHOR_URL` | No | URL for the footer author link; only used when `AUTHOR_NAME` is set and branding is shown |
| `CORS_ORIGINS` | No | Comma-separated list of extra allowed origins (e.g. `https://app.com,https://other.com`). All `http(s)://localhost` and `http(s)://127.0.0.1` ports are always allowed by default. |

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

- **App / demo UI**: `http://localhost:3000` (streaming chat page)
- **API**: `http://localhost:3000/v1` (all API routes use the `v1` prefix)
- **API docs (Scalar)**: `http://localhost:3000/v1/docs`

On startup the server logs `Unlimited prompts: true/false` and `Copyright: enabled/disabled` (enabled when `AUTHOR_NAME` is set; copyright is always shown on localhost and on `PLATFORM_URL` or its subdomains).

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
- **Branding** – `GET /v1/branding` – Returns `{ authorName, authorUrl }` on localhost or when the request host is the same as or a subdomain of `PLATFORM_URL`; otherwise returns nulls (copyright hidden). Used by the demo UI to hydrate the header and footer.
- **Expose** – `POST /v1/expose/prompt` – Body: `{ "prompt": "string" }` – Returns AI-generated text (and can use web search internally)
- **Expose (stream)** – `POST /v1/expose/prompt/stream` – Body: `{ "prompt": "string" }` – Streams the AI response as `text/plain` with chunked transfer encoding

Full request/response details and auth options are in the API docs at `/v1/docs`.

## Project structure (high level)

```
public/                  # Static assets; root serves index.html (streaming chat UI)
src/
├── app/                 # App module, controller, service
├── lib/                 # Shared libs
│   ├── ai/              # AI service, system prompt (sp.ts)
│   ├── loggger/         # Custom logger
│   └── prisma/          # Prisma service, seed
├── middleware/          # Exception filter, API key guard, open-access limit guard
├── modules/
│   └── expose/          # Expose controller & service (prompt + stream)
└── main.ts              # Bootstrap, static files, Scalar API docs, CORS, rate limit
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

This project is [MIT licensed](LICENSE).

## Contributing

Contributions are welcome. Open an issue or a pull request as needed.
