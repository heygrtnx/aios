# AIOS

A NestJS API backend that exposes an AI-powered assistant through a REST API. It uses the Vercel AI SDK (v6) with a configurable gateway, optional pre-response web search (Valyu), and PostgreSQL (Prisma). The system prompt and branding are customizable, so you can adapt it for your own product or use it as a starter for an AI-backed API.

## Features

- **AI chat endpoint** – `POST /v1/chat/prompt` returns a complete AI-generated text response
- **Streaming endpoint** – `POST /v1/chat/prompt/stream` streams the AI response as SSE (`text/event-stream`); emits `searching` → `search_done` → `text` delta events → `done`
- **Pre-response web search** – When `VALYU_API_KEY` is set, the server searches the web *before* calling the AI and injects the results as context; powered by [Valyu](https://www.npmjs.com/package/@valyu/ai-sdk)
- **Configurable AI** – Uses [Vercel AI SDK v6](https://sdk.vercel.ai/) with `@ai-sdk/gateway`; model and API key via env
- **Optional API key auth** – Set `API_KEY` in env to require an `x-api-key` header on all routes; omit for open access. When open access: only domains listed in `DOMAIN_CHAT` (one or more, comma-separated) have a per-day-per-IP limit (default **5**, or `PROMPTS_PER_DAY_CHAT`); all other domains are **unlimited**. Omit `DOMAIN_CHAT` for unlimited prompts everywhere.
- **WhatsApp bot** – Connect a WhatsApp Cloud API app to receive and reply to messages; per-user conversation history stored in Redis; read receipts and typing indicators
- **Slack bot** – Connect a Slack app to receive and reply to `app_mention` and direct messages; per-user conversation history stored in Redis; request signature verification; event deduplication
- **Product upload → Google Sheets** – Upload a CSV, JSON, or Excel file of products; the AI asks for a secret confirmation code; on match, data is populated to a Google Sheet
- **Demo page** – Root URL serves a streaming chat UI (`public/index.html`): prompt box, Enter to send, Shift+Enter for new line, paste-to-attachment for long text
- **API docs** – [Scalar](https://scalar.com/) API reference at `/v1/docs` with configurable servers and Bearer auth
- **Security** – Helmet, rate limiting, CORS, global validation pipe, and a custom exception filter
- **Database** – PostgreSQL with Prisma (migrations, generate, seed, Studio)
- **Logging** – Custom logger service; timezone set to Africa/Lagos

## Tech stack

- [NestJS](https://nestjs.com/) 11
- [Prisma](https://www.prisma.io/) 7 (PostgreSQL)
- [Vercel AI SDK v6](https://sdk.vercel.ai/) with `@ai-sdk/gateway`
- [Valyu](https://www.npmjs.com/package/@valyu/ai-sdk) (`@valyu/ai-sdk`) for pre-response web search
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
| `SLACK_BOT_TOKEN` | No | Slack bot OAuth token (starts with `xoxb-`). Required for the Slack bot to send messages. |
| `SLACK_SIGNING_SECRET` | No | Slack app signing secret. Used to verify that incoming webhook requests originate from Slack. Verification is skipped when unset (not recommended in production). |
| `SLACK_CLIENT_ID` | No | Slack app client ID (found in Basic Information). Required for the install redirect and OAuth callback. |
| `SLACK_CLIENT_SECRET` | No | Slack app client secret (found in Basic Information). Required to handle the OAuth install callback. |
| `SLACK_SCOPES` | No | Comma-separated bot scopes to request during install (e.g. `app_mentions:read,chat:write,im:history`). Used by the `/v1/chat/slack/add` install redirect. |
| `WHATSAPP_CLOUD_API_VERSION` | No | WhatsApp Cloud API version (e.g. `v17.0`). Required for the WhatsApp bot. |
| `WHATSAPP_CLOUD_API_PHONE_NUMBER_ID` | No | Phone number ID from your Meta app dashboard. Required for the WhatsApp bot. |
| `WHATSAPP_CLOUD_API_ACCESS_TOKEN` | No | Permanent or temporary access token from your Meta app. Required for the WhatsApp bot. |
| `WHATSAPP_CLOUD_API_WEBHOOK_VERIFICATION_TOKEN` | No | Token you define and enter in the Meta webhook config to verify the subscription challenge. |
| `GOOGLE_CLIENT_EMAIL` | No | Google service account email. Required for the product upload → Google Sheets feature. |
| `GOOGLE_PRIVATE_KEY` | No | Google service account private key (PEM format, `\n` escaped). Required for the product upload → Google Sheets feature. |
| `GOOGLE_SHEET_ID` | No | The spreadsheet ID from the Google Sheet URL. Required for the product upload → Google Sheets feature. |
| `UPLOAD_SECRET_CODE` | No | Secret code the user must provide to confirm uploading products to Google Sheets. Required for the product upload → Google Sheets feature. |

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
- **Chat** – `POST /v1/chat/prompt` – Body: `{ "prompt": "string" }` – Returns a complete AI-generated text response
- **Chat (stream)** – `POST /v1/chat/prompt/stream` – Body: `{ "prompt": "string" }` – Streams the response as `text/event-stream` SSE
- **WhatsApp** – `GET /v1/chat/webhook` – Webhook verification challenge (Meta subscription setup)
- **WhatsApp** – `POST /v1/chat/webhook` – Incoming WhatsApp messages
- **Slack (install)** – `GET /v1/chat/slack/add` – Redirects to the Slack OAuth install page (scopes driven by `SLACK_CLIENT_ID` + `SLACK_SCOPES` in env)
- **Slack (OAuth callback)** – `GET /v1/chat/slack/events` – Slack OAuth install callback; exchanges the `code` param for an access token after a workspace installs the app
- **Slack (events)** – `POST /v1/chat/slack/events` – Slack Event API webhook; handles `url_verification` and `event_callback` (app_mention, message.im)
- **Product upload** – `POST /v1/chat/products/upload` – Multipart file upload (CSV, JSON, Excel); parses the file, stores data in Redis, and streams an AI response asking for the secret confirmation code. Follow up via the streaming endpoint to provide the code and trigger the Google Sheets write.

### SSE event types (streaming endpoint)

Each event is a JSON object on a `data:` line.

| Event | Fields | Description |
|-------|--------|-------------|
| `searching` | `query` | Web search started (only emitted when `VALYU_API_KEY` is set) |
| `search_done` | — | Web search complete; AI generation begins |
| `text` | `v` | Incremental text delta from the model |
| `reasoning` | `v` | Incremental reasoning delta (extended-thinking models) |
| `tool_call` | `tool`, `args` | Model called an internal tool (e.g. `database`) |
| `tool_result` | `tool` | Internal tool returned a result |
| `upload` | `uploadKey`, `rowCount`, `columns` | Product file parsed and stored; emitted at the start of a product upload stream |
| `done` | — | Stream complete |
| `error` | `msg` | Stream-level error |

Full request/response details and auth options are in the API docs at `/v1/docs`.

## Project structure (high level)

```
public/                  # Static assets; root serves index.html (streaming chat UI)
src/
├── app/                 # App module, controller, service
├── lib/                 # Shared libs
│   ├── ai/              # AI service, system prompt (sp.ts)
│   ├── loggger/         # Custom logger
│   ├── prisma/          # Prisma service, seed
│   ├── google/sheet/    # GoogleSheetsService — read, append, batch write, clear
│   ├── redis/           # RedisService — key-value store with TTL
│   ├── slack/           # SlackService — send messages, verify request signatures
│   └── whatsapp/        # WhatsappService — send messages, read receipts, typing indicator
├── middleware/          # Exception filter, API key guard, open-access limit guard, decorators
├── modules/
│   └── chat/            # Chat controller & service (prompt, stream, WhatsApp, Slack events)
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

## WhatsApp bot setup

1. Create a Meta app at [developers.facebook.com](https://developers.facebook.com) and add the **WhatsApp** product.
2. Under **WhatsApp > API Setup**, copy the **Phone Number ID** → `WHATSAPP_CLOUD_API_PHONE_NUMBER_ID` and generate a **Temporary Access Token** (or configure a permanent one via a System User) → `WHATSAPP_CLOUD_API_ACCESS_TOKEN`.
3. Set `WHATSAPP_CLOUD_API_VERSION` to the API version shown in the dashboard (e.g. `v17.0`).
4. Under **WhatsApp > Configuration**, set the webhook URL to `https://<your-host>/v1/chat/webhook`, choose a verify token of your own and set it as `WHATSAPP_CLOUD_API_WEBHOOK_VERIFICATION_TOKEN`, then subscribe to the `messages` field.
5. Restart the server. The bot replies to incoming text messages with per-user conversation history persisted in Redis.

## Slack bot setup

### 1. Create a Slack app

Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**.

### 2. Get your credentials

- **Basic Information** → copy **Signing Secret** → set as `SLACK_SIGNING_SECRET`
- **Basic Information** → copy **Client ID** → set as `SLACK_CLIENT_ID`
- **Basic Information** → copy **Client Secret** → set as `SLACK_CLIENT_SECRET`
- **OAuth & Permissions** → add bot scope **`chat:write`** → **Install to Workspace** → copy the **Bot User OAuth Token** (`xoxb-…`) → set as `SLACK_BOT_TOKEN`

### 3. Expose your server publicly

Slack needs to reach your endpoint. If running locally, use a tunnel:

```bash
npx ngrok http 3000
```

Copy the `https://….ngrok.io` URL.

### 4. Enable Event Subscriptions

In your Slack app → **Event Subscriptions** → toggle **Enable Events** → set Request URL to:

```
https://<your-ngrok-or-domain>/v1/chat/slack/events
```

Slack will immediately send a `url_verification` challenge — the server handles it automatically and Slack will show **Verified**.

Then under **Subscribe to bot events**, add:
- `app_mention` — bot is @mentioned in a channel
- `message.im` — direct messages to the bot

Save changes.

### 5. Enable Direct Messages (App Home)

To allow users to DM the bot directly, go to your Slack app → **App Home** → scroll to **Show Tabs** → enable **Messages Tab** → check **"Allow users to send Slash commands and messages from the messages tab"**.

Without this, users will see *"Sending messages to this app has been turned off"* when they try to DM the bot.

### 6. Invite the bot to a channel

In Slack: `/invite @<your-app-name>` in any channel you want it active in.

### 7. Talk to it

- **In a channel**: `@your-bot-name hello`
- **In DMs**: send a message directly

The bot replies in-thread and remembers conversation history per user (last 20 messages, 7-day TTL via Redis). Slack retries are deduplicated automatically.

### How other users find and chat with the bot

#### Within the same workspace

Anyone already in the workspace can:
- **DM the bot** — search for it by name in the sidebar under **Apps**, or click **+** next to **Direct messages**
- **Mention it in a channel** — `@your-bot-name hello` in any channel it has been invited to

Invite it to more channels with `/invite @your-bot-name`.

#### For users in other workspaces

You have two options:

**Option A — Share an install link (easiest)**

In your Slack app settings → **Manage Distribution** → enable **Distribute App** → set the **Redirect URL** to:

```
https://<your-domain>/v1/chat/slack/events
```

Then share the install link:

```
https://<your-domain>/v1/chat/slack/add
```

Visiting that URL redirects straight to Slack's OAuth page using the `SLACK_CLIENT_ID` and `SLACK_SCOPES` from env. After the user authorizes, Slack redirects back to the callback above which exchanges the code for a token and shows a success page.

Make sure `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, and `SLACK_SCOPES` are set in env for this to work.

> **Note:** The current implementation uses a single `SLACK_BOT_TOKEN`, so it only sends messages back to the one workspace it was originally installed in. To support multiple workspaces you would need to store each workspace's token after their OAuth install completes.

**Option B — Publish to the Slack App Directory**

Go to **Manage Distribution** → **Submit to App Directory**. Slack reviews and lists it publicly so anyone can discover and install it.

| Goal | What to do |
|------|-----------|
| Same workspace | Search the bot by name → DM or invite to channel |
| Other workspaces (private) | Share the install URL from Manage Distribution |
| Public (anyone) | Submit to Slack App Directory |

## Product upload → Google Sheets

Upload a CSV, JSON, or Excel file of products and have the AI populate a Google Sheet — with a secret code confirmation step.

### How it works

1. **Upload** — `POST /v1/chat/products/upload` with a `file` field (multipart/form-data). Accepted formats: `.csv`, `.json`, `.xlsx`, `.xls` (max 10 MB).
2. **AI asks for the code** — The server parses the file, stores the data in Redis (1-hour TTL), and streams an AI response that asks the user for a secret confirmation code.
3. **User provides the code** — Send the code via `POST /v1/chat/prompt/stream` with the conversation history from step 2 so the AI has context.
4. **AI uploads** — If the code matches `UPLOAD_SECRET_CODE` in env, the AI calls its `uploadToSheet` tool which clears the target sheet and writes all product rows. If the code is wrong, the AI asks the user to try again.

### Step 1 — Create a Google Cloud Service Account

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. Create a new project (or select an existing one).
3. Navigate to **APIs & Services** → **Library** → search for **Google Sheets API** → click **Enable**.
4. Go to **APIs & Services** → **Credentials** → **Create Credentials** → **Service Account**.
5. Give it a name (e.g. `aios-sheets`) → click **Done**.
6. Click the service account you just created → go to the **Keys** tab → **Add Key** → **Create new key** → choose **JSON** → click **Create**.
7. A JSON file downloads. Open it and grab two values:
   - `client_email` — looks like `aios-sheets@your-project.iam.gserviceaccount.com`
   - `private_key` — the long PEM string starting with `-----BEGIN PRIVATE KEY-----`

### Step 2 — Create a Google Sheet and share it with the service account

1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet (or open an existing one).
2. Name it whatever you want (e.g. "Products").
3. Copy the **spreadsheet ID** from the URL — it's the long string between `/d/` and `/edit`:

```
https://docs.google.com/spreadsheets/d/THIS_PART_IS_THE_ID/edit
```

4. Click the **Share** button in the top right.
5. Paste the `client_email` from Step 1 into the email field.
6. Set permission to **Editor**.
7. Click **Send** (uncheck "Notify people" if you want).

### Step 3 — Set the environment variables

Add these to your `.env` file:

```env
GOOGLE_CLIENT_EMAIL=aios-sheets@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...(your full key)...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=your-spreadsheet-id-from-step-2
UPLOAD_SECRET_CODE=choose-a-secret-code
```

> **Important:** The `GOOGLE_PRIVATE_KEY` must be on **one line** with literal `\n` for newlines (exactly as it appears in the downloaded JSON file), wrapped in **double quotes**.

> `UPLOAD_SECRET_CODE` is the code the AI will ask the user for before uploading. Choose any value you want.

### Step 4 — Restart and test

```bash
pnpm run start:dev
```

| Variable | What to check |
|----------|---------------|
| `GOOGLE_CLIENT_EMAIL` | Real service account email from Step 1 |
| `GOOGLE_PRIVATE_KEY` | Real private key from Step 1 (one line, `\n` for newlines, double-quoted) |
| `GOOGLE_SHEET_ID` | Spreadsheet ID from Step 2 |
| `UPLOAD_SECRET_CODE` | Any secret string you choose |

### Example flow (cURL)

```bash
# 1. Upload the file
curl -X POST https://<host>/v1/chat/products/upload \
  -H "x-api-key: <your-api-key>" \
  -F "file=@products.csv"

# SSE stream returns:
# data: {"t":"upload","uploadKey":"<uuid>","rowCount":50,"columns":["Name","Price","SKU"]}
# data: {"t":"text","v":"I've got your 50 products ready. To upload them to Google Sheets, I'll need your secret confirmation code."}
# data: {"t":"done"}

# 2. Provide the code (include history from step 1)
curl -X POST https://<host>/v1/chat/prompt/stream \
  -H "x-api-key: <your-api-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "my-secret-code",
    "history": [
      {"role":"user","content":"[PRODUCT_UPLOAD]\nFile: \"products.csv\"\nTotal rows: 50 (including header)\nUpload key: <uuid>\nColumns: Name, Price, SKU\n\nPreview:\nName | Price | SKU\nWidget A | 9.99 | W001\nWidget B | 14.99 | W002\n\nI want to upload these products to Google Sheets."},
      {"role":"assistant","content":"I've got your 50 products ready. To upload them to Google Sheets, I'll need your secret confirmation code."}
    ]
  }'

# SSE stream returns:
# data: {"t":"text","v":"Uploading now..."}
# data: {"t":"text","v":" Done! 50 rows have been written to your Google Sheet."}
# data: {"t":"done"}
```

### Troubleshooting

| Problem | Fix |
|---------|-----|
| `Upload secret code is not configured` | Set `UPLOAD_SECRET_CODE` in `.env` and restart |
| `Google Sheet ID is not configured` | Set `GOOGLE_SHEET_ID` in `.env` and restart |
| `403` or permission error on Google Sheets | Make sure you shared the spreadsheet with the service account email as **Editor** (Step 2) |
| `Upload session expired` | The parsed data is stored in Redis for 1 hour. Upload the file again if it expired |
| `Invalid secret code` | The code you entered doesn't match `UPLOAD_SECRET_CODE` in `.env`. Try again with the correct one |
| File rejected at upload | Only `.csv`, `.json`, `.xlsx`, and `.xls` files are accepted (max 10 MB) |

## License

This project is [MIT licensed](LICENSE).

## Contributing

Contributions are welcome. Open an issue or a pull request as needed.
