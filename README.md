# DocMind API

**AI Document Intelligence API** -- parse receipts, invoices, bank statements, contracts, and any document into structured JSON using your choice of LLM provider.

[Live Documentation](https://sjgant80-hub.github.io/docmind-api/) | [GitHub](https://github.com/sjgant80-hub/docmind-api)

---

## Features

- **Multi-LLM support** -- route requests through Anthropic Claude, OpenAI GPT, or Google Gemini
- **Five document types** -- receipts, invoices, bank statements, contracts, and general documents
- **Flexible input** -- file upload (multipart), base64-encoded images, or raw text
- **Batch processing** -- parse up to 20 documents in a single request
- **Conversational AI** -- chat endpoint for general-purpose LLM access
- **API key management** -- tiered access control (free / pro / enterprise) with built-in rate limiting
- **Zero external databases** -- runs entirely in-memory; swap in your own persistence layer as needed

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/sjgant80-hub/docmind-api.git
cd docmind-api

# Install dependencies
npm install

# Copy the example env file and add your keys
cp .env.example .env
# Edit .env with your LLM provider key(s)

# Start the server
npm start
```

The server starts on `http://localhost:3000` by default. A demo API key is printed to the console on startup.

For development with auto-reload:

```bash
npm run dev
```

**Requirements:** Node.js >= 18

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment (`production` / `development`) | -- |
| `ADMIN_KEY` | Master key for admin endpoints | Auto-generated |
| `ANTHROPIC_API_KEY` | Anthropic API key (Claude) | -- |
| `OPENAI_API_KEY` | OpenAI API key (GPT) | -- |
| `GOOGLE_API_KEY` | Google AI API key (Gemini) | -- |
| `DEFAULT_PROVIDER` | Default LLM provider: `anthropic`, `openai`, or `google` | `anthropic` |
| `RATE_LIMIT_PER_MINUTE` | Global rate limit (requests per minute) | `60` |
| `USAGE_WEBHOOK_URL` | Optional webhook URL for usage event notifications | -- |

At least one LLM provider key is required.

---

## API Endpoints

All `/v1/*` endpoints require an API key via the `X-API-Key` header (unless noted otherwise).

| Method | Path | Description | Auth |
|---|---|---|---|
| `GET` | `/health` | Health check -- returns status, version, active providers, uptime | No |
| `GET` | `/v1/types` | List supported document types and available providers | No |
| `POST` | `/v1/parse` | Parse a single document (file upload, text, or base64) | Yes |
| `POST` | `/v1/parse/batch` | Batch parse up to 20 files | Yes |
| `POST` | `/v1/chat` | Conversational AI (multi-LLM gateway) | Yes |
| `POST` | `/v1/keys` | Create a new API key (admin only) | Admin |
| `GET` | `/v1/keys` | List all API keys (admin only) | Admin |
| `DELETE` | `/v1/keys/:name` | Deactivate an API key by name (admin only) | Admin |
| `GET` | `/v1/usage` | Retrieve usage statistics (admin only) | Admin |

---

## Usage Examples

### Parse a document (file upload)

**cURL:**

```bash
curl -X POST http://localhost:3000/v1/parse \
  -H "X-API-Key: YOUR_API_KEY" \
  -F "file=@receipt.jpg" \
  -F "type=receipt" \
  -F "quality=fast"
```

**JavaScript:**

```javascript
const form = new FormData();
form.append('file', fileInput.files[0]);
form.append('type', 'receipt');
form.append('quality', 'fast');

const response = await fetch('http://localhost:3000/v1/parse', {
  method: 'POST',
  headers: { 'X-API-Key': 'YOUR_API_KEY' },
  body: form,
});

const result = await response.json();
console.log(result.data); // Structured JSON output
```

### Parse a document (raw text)

**cURL:**

```bash
curl -X POST http://localhost:3000/v1/parse \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "invoice",
    "text": "Invoice #1042\nDate: 2025-03-15\nItem: Consulting — 10 hrs @ $150\nTotal: $1,500.00",
    "provider": "anthropic",
    "quality": "best"
  }'
```

**JavaScript:**

```javascript
const response = await fetch('http://localhost:3000/v1/parse', {
  method: 'POST',
  headers: {
    'X-API-Key': 'YOUR_API_KEY',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    type: 'invoice',
    text: 'Invoice #1042\nDate: 2025-03-15\nItem: Consulting — 10 hrs @ $150\nTotal: $1,500.00',
    provider: 'anthropic',
    quality: 'best',
  }),
});

const result = await response.json();
console.log(result.data);
```

### Parse a document (base64)

```bash
curl -X POST http://localhost:3000/v1/parse \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "bank_statement",
    "image_base64": "'"$(base64 -w0 statement.png)"'",
    "image_mime": "image/png"
  }'
```

---

## Document Types

| Type | Key | What It Extracts |
|---|---|---|
| Receipt | `receipt` | Merchant, items, totals, VAT, payment method, category |
| Invoice | `invoice` | Line items, vendor/client details, payment terms, VAT |
| Bank Statement | `bank_statement` | Transactions with categories, balances, period summary |
| Contract | `contract` | Key terms, obligations, termination clauses, risk flags |
| General | `general` | Entities, key-value pairs, tables, summary (any document) |

Set the `type` field in your request body. If omitted, defaults to `general`.

---

## LLM Providers

Each provider offers two quality tiers (`fast` and `best`):

| Provider | Fast Model | Best Model |
|---|---|---|
| Anthropic | Claude Haiku 4 | Claude Sonnet 4 |
| OpenAI | GPT-4o Mini | GPT-4o |
| Google | Gemini 2.0 Flash | Gemini 2.5 Flash |

Specify `"provider"` and `"quality"` in the request body to control routing. If the requested provider is unavailable, the API falls back to the first configured provider.

---

## Pricing Tiers

| Tier | Monthly Requests | Rate Limit | Max File Size |
|---|---|---|---|
| **Free** | 100 /day | 10 /min | 5 MB |
| **Pro** | 5,000 /day | 60 /min | 25 MB |
| **Enterprise** | 50,000 /day | 300 /min | 50 MB |

API keys are created through the admin endpoint (`POST /v1/keys`) with the desired tier.

---

## Deployment

### Railway

A `railway.json` and `Procfile` are included for one-click deployment:

```bash
# Install the Railway CLI, then:
railway login
railway init
railway up
```

Set your environment variables in the Railway dashboard.

### Docker

```bash
docker build -t docmind-api .
docker run -p 3000:3000 --env-file .env docmind-api
```

### RapidAPI

DocMind API is available as a managed listing on [RapidAPI](https://rapidapi.com). See `RAPIDAPI_LISTING.md` for integration details.

---

## Project Structure

```
docmind-api/
  server.js               # Main application
  package.json             # Dependencies and scripts
  .env.example             # Environment variable template
  Dockerfile               # Container build
  Procfile                 # Railway / Heroku process file
  railway.json             # Railway deployment config
  rapidapi-middleware.js   # RapidAPI proxy-secret auth layer
  openapi.yaml             # OpenAPI 3.0 specification
  public/                  # Landing page assets
  index.html               # Documentation site (GitHub Pages)
```

---

## Related Projects

- [AI Native Solutions Hub](https://sjgant80-hub.github.io/ai-native-solutions-hub/) -- central directory for all AI-native tools
- [FallMesh](https://github.com/sjgant80-hub/fallmesh) -- distributed mesh networking
- [FallGo](https://github.com/sjgant80-hub/fallgo) -- Go-based backend toolkit
- [sjgant80-hub on GitHub](https://github.com/sjgant80-hub) -- all repositories

---

## License

MIT

---

<p align="center">
  Powered by <strong>Konomi Architecture</strong> &middot; <em>&phi;&middot;&kappa;=1</em><br>
  Member of the <a href="https://aicraftspeopleguild.github.io/">AI Craftspeople Guild</a>
</p>
