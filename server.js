// ═══════════════════════════════════════════════════════════════
// DocMind API — AI Document Intelligence
// One endpoint. Any document. Structured JSON.
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─── Config ───────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'dm_admin_' + crypto.randomBytes(16).toString('hex');
const DEFAULT_PROVIDER = process.env.DEFAULT_PROVIDER || 'anthropic';
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_PER_MINUTE) || 60;

// ─── LLM Providers ───────────────────────────────────────────
const PROVIDERS = {
  anthropic: {
    name: 'Anthropic (Claude)',
    url: 'https://api.anthropic.com/v1/messages',
    models: { fast: 'claude-haiku-4-20250414', best: 'claude-sonnet-4-20250514' },
    key: () => process.env.ANTHROPIC_API_KEY,
  },
  openai: {
    name: 'OpenAI (GPT)',
    url: 'https://api.openai.com/v1/chat/completions',
    models: { fast: 'gpt-4o-mini', best: 'gpt-4o' },
    key: () => process.env.OPENAI_API_KEY,
  },
  google: {
    name: 'Google (Gemini)',
    urlBase: 'https://generativelanguage.googleapis.com/v1beta/models/',
    models: { fast: 'gemini-2.0-flash', best: 'gemini-2.5-flash' },
    key: () => process.env.GOOGLE_API_KEY,
  },
};

function getAvailableProvider(preferred) {
  if (preferred && PROVIDERS[preferred] && PROVIDERS[preferred].key()) return preferred;
  for (const [id, p] of Object.entries(PROVIDERS)) {
    if (p.key()) return id;
  }
  return null;
}

// ─── LLM Call Abstraction ─────────────────────────────────────
async function callLLM(provider, model, systemPrompt, userContent, options = {}) {
  const p = PROVIDERS[provider];
  if (!p || !p.key()) throw new Error(`Provider ${provider} not configured`);

  const isVision = options.imageBase64 && options.imageMime;
  const startTime = Date.now();

  if (provider === 'anthropic') {
    const messages = [];
    if (isVision) {
      messages.push({
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: options.imageMime, data: options.imageBase64 } },
          { type: 'text', text: userContent }
        ]
      });
    } else {
      messages.push({ role: 'user', content: userContent });
    }

    const res = await fetch(p.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': p.key(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || p.models.fast,
        max_tokens: options.maxTokens || 4096,
        system: systemPrompt,
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic ${res.status}: ${err}`);
    }
    const data = await res.json();
    return {
      text: data.content[0].text,
      usage: { input: data.usage?.input_tokens, output: data.usage?.output_tokens },
      latencyMs: Date.now() - startTime,
      model: data.model,
      provider: 'anthropic',
    };
  }

  if (provider === 'openai') {
    const messages = [{ role: 'system', content: systemPrompt }];
    if (isVision) {
      messages.push({
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${options.imageMime};base64,${options.imageBase64}` } },
          { type: 'text', text: userContent }
        ]
      });
    } else {
      messages.push({ role: 'user', content: userContent });
    }

    const res = await fetch(p.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${p.key()}`,
      },
      body: JSON.stringify({
        model: model || p.models.fast,
        max_tokens: options.maxTokens || 4096,
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI ${res.status}: ${err}`);
    }
    const data = await res.json();
    return {
      text: data.choices[0].message.content,
      usage: { input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens },
      latencyMs: Date.now() - startTime,
      model: data.model,
      provider: 'openai',
    };
  }

  if (provider === 'google') {
    const modelId = model || p.models.fast;
    const url = `${p.urlBase}${modelId}:generateContent?key=${p.key()}`;
    const parts = [];
    if (isVision) {
      parts.push({ inlineData: { mimeType: options.imageMime, data: options.imageBase64 } });
    }
    parts.push({ text: systemPrompt + '\n\n' + userContent });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { maxOutputTokens: options.maxTokens || 4096 },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google ${res.status}: ${err}`);
    }
    const data = await res.json();
    return {
      text: data.candidates[0].content.parts[0].text,
      usage: { input: data.usageMetadata?.promptTokenCount, output: data.usageMetadata?.candidatesTokenCount },
      latencyMs: Date.now() - startTime,
      model: modelId,
      provider: 'google',
    };
  }

  throw new Error(`Unknown provider: ${provider}`);
}

// ─── Document Extraction Prompts ──────────────────────────────
const EXTRACTION_PROMPTS = {
  receipt: {
    system: `You are a receipt parser. Extract structured data from receipt images/text.
Return ONLY valid JSON with this exact schema:
{
  "merchant": "string",
  "date": "YYYY-MM-DD",
  "currency": "GBP|USD|EUR",
  "subtotal": number,
  "tax": number,
  "tax_rate": "20%",
  "total": number,
  "payment_method": "card|cash|contactless",
  "items": [{ "description": "string", "quantity": number, "unit_price": number, "total": number }],
  "category": "food|transport|office|entertainment|utilities|other",
  "confidence": 0.0-1.0
}
If a field cannot be determined, use null. Always return valid JSON.`,
    user: 'Parse this receipt and extract all data as JSON.',
  },

  invoice: {
    system: `You are an invoice parser. Extract structured data from invoices.
Return ONLY valid JSON with this exact schema:
{
  "invoice_number": "string",
  "date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD",
  "vendor": { "name": "string", "address": "string", "vat_number": "string" },
  "client": { "name": "string", "address": "string" },
  "currency": "GBP|USD|EUR",
  "line_items": [{ "description": "string", "quantity": number, "unit_price": number, "vat_rate": "20%", "total": number }],
  "subtotal": number,
  "vat": number,
  "total": number,
  "payment_terms": "string",
  "bank_details": { "sort_code": "string", "account": "string" },
  "confidence": 0.0-1.0
}
If a field cannot be determined, use null. Always return valid JSON.`,
    user: 'Parse this invoice and extract all data as JSON.',
  },

  bank_statement: {
    system: `You are a bank statement parser. Extract and categorize transactions.
Return ONLY valid JSON with this exact schema:
{
  "account_holder": "string",
  "account_number": "string (last 4 digits only)",
  "sort_code": "string",
  "statement_period": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
  "opening_balance": number,
  "closing_balance": number,
  "currency": "GBP|USD|EUR",
  "transactions": [{
    "date": "YYYY-MM-DD",
    "description": "string",
    "type": "credit|debit",
    "amount": number,
    "balance": number,
    "category": "income|rent|utilities|food|transport|subscriptions|insurance|entertainment|transfers|fees|other",
    "vat_likely": boolean
  }],
  "summary": { "total_credits": number, "total_debits": number, "transaction_count": number },
  "confidence": 0.0-1.0
}
If a field cannot be determined, use null. Always return valid JSON.`,
    user: 'Parse this bank statement. Extract all transactions and categorize each one.',
  },

  contract: {
    system: `You are a contract analyzer. Extract key terms and obligations.
Return ONLY valid JSON with this exact schema:
{
  "title": "string",
  "type": "employment|service|nda|lease|sale|partnership|other",
  "parties": [{ "name": "string", "role": "string" }],
  "effective_date": "YYYY-MM-DD",
  "expiry_date": "YYYY-MM-DD",
  "key_terms": [{ "clause": "string", "summary": "string", "risk_level": "low|medium|high" }],
  "obligations": [{ "party": "string", "obligation": "string", "deadline": "string" }],
  "termination_clauses": ["string"],
  "payment_terms": { "amount": number, "currency": "string", "frequency": "string", "conditions": "string" },
  "governing_law": "string",
  "red_flags": ["string"],
  "confidence": 0.0-1.0
}
If a field cannot be determined, use null. Always return valid JSON.`,
    user: 'Analyze this contract. Extract key terms, obligations, and flag any risks.',
  },

  general: {
    system: `You are a document intelligence engine. Extract structured data from any document.
Return ONLY valid JSON with this schema:
{
  "document_type": "string",
  "title": "string",
  "date": "YYYY-MM-DD",
  "language": "string",
  "entities": [{ "type": "person|company|address|date|amount|reference", "value": "string" }],
  "key_values": [{ "key": "string", "value": "string" }],
  "tables": [{ "headers": ["string"], "rows": [["string"]] }],
  "summary": "string (max 200 words)",
  "confidence": 0.0-1.0
}
If a field cannot be determined, use null. Always return valid JSON.`,
    user: 'Extract all structured data from this document.',
  },
};

// ─── API Key Store (in-memory — swap for DB in production) ────
const apiKeys = new Map();
const usageLog = [];

function createApiKey(name, tier = 'free') {
  const key = 'dm_' + tier[0] + '_' + crypto.randomBytes(20).toString('hex');
  const record = {
    key,
    name,
    tier, // free | pro | enterprise
    created: new Date().toISOString(),
    requests: 0,
    lastUsed: null,
    active: true,
    limits: {
      free: { perMinute: 10, perDay: 100, maxFileSizeMB: 5 },
      pro: { perMinute: 60, perDay: 5000, maxFileSizeMB: 25 },
      enterprise: { perMinute: 300, perDay: 50000, maxFileSizeMB: 50 },
    }[tier],
  };
  apiKeys.set(key, record);
  return record;
}

// Create a demo key on startup
const demoKey = createApiKey('Demo Key', 'free');
console.log(`\n  Demo API key: ${demoKey.key}\n`);

// ─── Middleware ────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
});

// Rate limiter
const rateLimiter = new RateLimiterMemory({
  points: RATE_LIMIT,
  duration: 60,
});

// Auth middleware
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  const apiKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing API key. Pass via Authorization: Bearer <key> or X-Api-Key header.' });
  }

  // Admin key bypass
  if (apiKey === ADMIN_KEY) {
    req.apiKeyRecord = { key: apiKey, name: 'admin', tier: 'enterprise', active: true, limits: { perMinute: 9999, perDay: 999999, maxFileSizeMB: 50 } };
    return next();
  }

  const record = apiKeys.get(apiKey);
  if (!record || !record.active) {
    return res.status(403).json({ error: 'Invalid or inactive API key.' });
  }

  req.apiKeyRecord = record;
  next();
}

// Rate limit middleware
async function rateLimit(req, res, next) {
  try {
    const key = req.apiKeyRecord?.key || req.ip;
    await rateLimiter.consume(key);
    next();
  } catch (e) {
    res.status(429).json({ error: 'Rate limit exceeded. Try again in a moment.' });
  }
}

// Usage tracking
function trackUsage(req, result) {
  const record = req.apiKeyRecord;
  if (record && record.key !== ADMIN_KEY) {
    record.requests++;
    record.lastUsed = new Date().toISOString();
  }
  usageLog.push({
    id: uuidv4(),
    key: record?.name || 'unknown',
    endpoint: req.path,
    docType: req.body?.type || 'general',
    provider: result?.provider,
    model: result?.model,
    latencyMs: result?.latencyMs,
    inputTokens: result?.usage?.input,
    outputTokens: result?.usage?.output,
    timestamp: new Date().toISOString(),
  });
  // Keep last 10k entries
  if (usageLog.length > 10000) usageLog.splice(0, usageLog.length - 10000);
}

// ─── API Routes ───────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  const providers = Object.entries(PROVIDERS)
    .filter(([, p]) => p.key())
    .map(([id]) => id);
  res.json({ status: 'ok', version: '1.0.0', providers, uptime: process.uptime() });
});

// ═══ CORE: Parse document ═══
app.post('/v1/parse', authenticate, rateLimit, upload.single('file'), async (req, res) => {
  const requestId = uuidv4();
  const startTime = Date.now();

  try {
    // Determine document type
    const docType = req.body?.type || 'general';
    const prompt = EXTRACTION_PROMPTS[docType] || EXTRACTION_PROMPTS.general;

    // Determine provider
    const preferredProvider = req.body?.provider || DEFAULT_PROVIDER;
    const quality = req.body?.quality || 'fast'; // fast | best
    const provider = getAvailableProvider(preferredProvider);
    if (!provider) {
      return res.status(503).json({ error: 'No LLM provider configured. Set at least one API key.' });
    }
    const model = PROVIDERS[provider].models[quality] || PROVIDERS[provider].models.fast;

    let result;

    // File upload (image/PDF)
    if (req.file) {
      const mime = req.file.mimetype;
      const base64 = req.file.buffer.toString('base64');
      const userPrompt = (req.body?.instructions || prompt.user) + (req.body?.context ? '\n\nAdditional context: ' + req.body.context : '');

      result = await callLLM(provider, model, prompt.system, userPrompt, {
        imageBase64: base64,
        imageMime: mime,
        maxTokens: parseInt(req.body?.max_tokens) || 4096,
      });
    }
    // Text/JSON body
    else if (req.body?.text || req.body?.content) {
      const inputText = req.body.text || req.body.content;
      const userPrompt = prompt.user + '\n\nDocument content:\n' + inputText + (req.body?.context ? '\n\nAdditional context: ' + req.body.context : '');

      result = await callLLM(provider, model, prompt.system, userPrompt, {
        maxTokens: parseInt(req.body?.max_tokens) || 4096,
      });
    }
    // Base64 image in body
    else if (req.body?.image_base64) {
      const mime = req.body.image_mime || 'image/jpeg';
      const userPrompt = (req.body?.instructions || prompt.user) + (req.body?.context ? '\n\nAdditional context: ' + req.body.context : '');

      result = await callLLM(provider, model, prompt.system, userPrompt, {
        imageBase64: req.body.image_base64,
        imageMime: mime,
        maxTokens: parseInt(req.body?.max_tokens) || 4096,
      });
    }
    else {
      return res.status(400).json({
        error: 'No document provided. Send a file upload, text/content in body, or image_base64.',
        usage: {
          file_upload: 'POST /v1/parse with multipart/form-data, field "file"',
          text: 'POST /v1/parse with JSON body { "text": "...", "type": "receipt" }',
          base64: 'POST /v1/parse with JSON body { "image_base64": "...", "image_mime": "image/jpeg", "type": "invoice" }',
        }
      });
    }

    // Parse the LLM response as JSON
    let parsed;
    try {
      // Extract JSON from response (handles markdown code blocks)
      let jsonStr = result.text.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      parsed = { raw_text: result.text, parse_error: 'LLM response was not valid JSON' };
    }

    trackUsage(req, result);

    res.json({
      id: requestId,
      type: docType,
      data: parsed,
      meta: {
        provider: result.provider,
        model: result.model,
        latency_ms: result.latencyMs,
        tokens: result.usage,
        processing_time_ms: Date.now() - startTime,
      },
    });

  } catch (err) {
    console.error(`[${requestId}] Error:`, err.message);
    res.status(500).json({ id: requestId, error: err.message });
  }
});

// ═══ Chat / Completion endpoint (multi-LLM gateway) ═══
app.post('/v1/chat', authenticate, rateLimit, async (req, res) => {
  const requestId = uuidv4();

  try {
    const { messages, system, provider: preferredProvider, model: preferredModel, quality, max_tokens } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required', example: { messages: [{ role: 'user', content: 'Hello' }] } });
    }

    const provider = getAvailableProvider(preferredProvider || DEFAULT_PROVIDER);
    if (!provider) return res.status(503).json({ error: 'No LLM provider configured.' });

    const q = quality || 'fast';
    const model = preferredModel || PROVIDERS[provider].models[q] || PROVIDERS[provider].models.fast;

    // Flatten messages to single user content for our abstraction
    const systemPrompt = system || 'You are a helpful assistant.';
    const userContent = messages.map(m => `${m.role}: ${m.content}`).join('\n');

    const result = await callLLM(provider, model, systemPrompt, userContent, {
      maxTokens: max_tokens || 4096,
    });

    trackUsage(req, result);

    res.json({
      id: requestId,
      response: result.text,
      meta: {
        provider: result.provider,
        model: result.model,
        latency_ms: result.latencyMs,
        tokens: result.usage,
      },
    });

  } catch (err) {
    console.error(`[${requestId}] Error:`, err.message);
    res.status(500).json({ id: requestId, error: err.message });
  }
});

// ═══ Batch parse (multiple documents) ═══
app.post('/v1/parse/batch', authenticate, rateLimit, upload.array('files', 20), async (req, res) => {
  const requestId = uuidv4();

  try {
    const docType = req.body?.type || 'general';
    const quality = req.body?.quality || 'fast';
    const provider = getAvailableProvider(req.body?.provider || DEFAULT_PROVIDER);
    if (!provider) return res.status(503).json({ error: 'No LLM provider configured.' });

    const model = PROVIDERS[provider].models[quality] || PROVIDERS[provider].models.fast;
    const prompt = EXTRACTION_PROMPTS[docType] || EXTRACTION_PROMPTS.general;

    const results = [];

    for (const file of (req.files || [])) {
      try {
        const result = await callLLM(provider, model, prompt.system, prompt.user, {
          imageBase64: file.buffer.toString('base64'),
          imageMime: file.mimetype,
          maxTokens: 4096,
        });

        let parsed;
        try {
          let jsonStr = result.text.trim();
          if (jsonStr.startsWith('```')) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
          parsed = JSON.parse(jsonStr);
        } catch { parsed = { raw_text: result.text }; }

        results.push({ filename: file.originalname, status: 'success', data: parsed, meta: { latency_ms: result.latencyMs, tokens: result.usage } });
        trackUsage(req, result);
      } catch (err) {
        results.push({ filename: file.originalname, status: 'error', error: err.message });
      }
    }

    res.json({ id: requestId, type: docType, results, count: results.length });

  } catch (err) {
    res.status(500).json({ id: requestId, error: err.message });
  }
});

// ═══ Admin: API key management ═══
app.post('/v1/keys', authenticate, (req, res) => {
  if (req.apiKeyRecord.key !== ADMIN_KEY) return res.status(403).json({ error: 'Admin only' });
  const { name, tier } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const record = createApiKey(name, tier || 'free');
  res.json({ key: record.key, name: record.name, tier: record.tier, limits: record.limits });
});

app.get('/v1/keys', authenticate, (req, res) => {
  if (req.apiKeyRecord.key !== ADMIN_KEY) return res.status(403).json({ error: 'Admin only' });
  const keys = [];
  for (const [, record] of apiKeys) {
    keys.push({ name: record.name, tier: record.tier, requests: record.requests, lastUsed: record.lastUsed, active: record.active, created: record.created });
  }
  res.json({ keys });
});

app.delete('/v1/keys/:name', authenticate, (req, res) => {
  if (req.apiKeyRecord.key !== ADMIN_KEY) return res.status(403).json({ error: 'Admin only' });
  for (const [key, record] of apiKeys) {
    if (record.name === req.params.name) { record.active = false; return res.json({ deactivated: record.name }); }
  }
  res.status(404).json({ error: 'Key not found' });
});

// ═══ Admin: Usage stats ═══
app.get('/v1/usage', authenticate, (req, res) => {
  if (req.apiKeyRecord.key !== ADMIN_KEY) return res.status(403).json({ error: 'Admin only' });

  const last24h = usageLog.filter(u => new Date(u.timestamp) > new Date(Date.now() - 86400000));
  const byEndpoint = {};
  const byProvider = {};
  let totalTokensIn = 0, totalTokensOut = 0, totalLatency = 0;

  for (const u of last24h) {
    byEndpoint[u.endpoint] = (byEndpoint[u.endpoint] || 0) + 1;
    byProvider[u.provider] = (byProvider[u.provider] || 0) + 1;
    totalTokensIn += u.inputTokens || 0;
    totalTokensOut += u.outputTokens || 0;
    totalLatency += u.latencyMs || 0;
  }

  res.json({
    period: '24h',
    total_requests: last24h.length,
    by_endpoint: byEndpoint,
    by_provider: byProvider,
    tokens: { input: totalTokensIn, output: totalTokensOut, total: totalTokensIn + totalTokensOut },
    avg_latency_ms: last24h.length ? Math.round(totalLatency / last24h.length) : 0,
    recent: usageLog.slice(-20).reverse(),
  });
});

// ═══ Supported types ═══
app.get('/v1/types', (req, res) => {
  res.json({
    types: Object.keys(EXTRACTION_PROMPTS).map(t => ({
      type: t,
      description: {
        receipt: 'Receipts — extract merchant, items, totals, VAT, category',
        invoice: 'Invoices — extract line items, vendor/client, payment terms, VAT',
        bank_statement: 'Bank statements — extract & categorize all transactions',
        contract: 'Contracts — extract key terms, obligations, risks, red flags',
        general: 'Any document — extract entities, key-value pairs, tables, summary',
      }[t],
    })),
    providers: Object.entries(PROVIDERS).filter(([, p]) => p.key()).map(([id, p]) => ({
      id,
      name: p.name,
      models: p.models,
    })),
  });
});

// Landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  const providers = Object.entries(PROVIDERS).filter(([, p]) => p.key()).map(([id]) => id);
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║  DocMind API v1.0.0                          ║
  ║  AI Document Intelligence                    ║
  ╠══════════════════════════════════════════════╣
  ║  http://localhost:${PORT}                       ║
  ║  Providers: ${providers.join(', ') || 'NONE — set API keys!'}
  ║  Admin key: ${ADMIN_KEY.slice(0, 12)}...              ║
  ╚══════════════════════════════════════════════╝
  `);
});
