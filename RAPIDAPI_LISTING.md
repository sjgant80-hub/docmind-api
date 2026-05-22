# DocMind API — RapidAPI Listing Copy

## Short Description (140 chars)
AI Document Parser — receipts, invoices, contracts to structured JSON. Multi-LLM. 50 free parses/month.

## Long Description
Parse any document into clean, structured JSON with one API call. Upload a receipt photo and get back merchant, items, totals, VAT. Upload an invoice and get line items, payment terms, vendor details. Upload a contract and get key terms, obligations, red flags.

**Supported document types:**
- Receipts — merchant, items, totals, VAT, category
- Invoices — line items, vendor/client, payment terms
- Bank Statements — all transactions extracted and categorized
- Contracts — key terms, obligations, risks, red flags
- General — any document: entities, tables, key-value pairs, summary

**Why DocMind:**
- Multi-LLM: Choose Claude, GPT, or Gemini per request
- Fast + Best quality modes
- Batch parsing (up to 20 docs at once)
- File upload, base64, or raw text input
- Structured JSON output — no post-processing needed

## Category
Data > Text Processing

## Tags/Keywords
receipt OCR, invoice parser, document extraction, OCR API, receipt scanner API,
invoice OCR, document parser, PDF extraction, contract analysis, bank statement parser,
AI document processing, structured data extraction, receipt to JSON, invoice to JSON

## Code Examples

### Python
```python
import requests

url = "https://docmind-api1.p.rapidapi.com/v1/parse"

# File upload
files = {"file": open("receipt.jpg", "rb")}
data = {"type": "receipt", "quality": "fast"}
headers = {
    "X-RapidAPI-Key": "YOUR_KEY",
    "X-RapidAPI-Host": "docmind-api1.p.rapidapi.com"
}

response = requests.post(url, files=files, data=data, headers=headers)
result = response.json()

print(result["data"]["merchant"])    # "Tesco"
print(result["data"]["total"])       # "£47.82"
print(result["data"]["items"])       # [{name, qty, price}, ...]
```

### JavaScript
```javascript
const form = new FormData();
form.append('file', fileBlob, 'receipt.jpg');
form.append('type', 'receipt');
form.append('quality', 'fast');

const response = await fetch('https://docmind-api1.p.rapidapi.com/v1/parse', {
  method: 'POST',
  headers: {
    'X-RapidAPI-Key': 'YOUR_KEY',
    'X-RapidAPI-Host': 'docmind-api1.p.rapidapi.com'
  },
  body: form
});

const { data, meta } = await response.json();
console.log(data.merchant);    // "Tesco"
console.log(data.total);       // "£47.82"
console.log(meta.latency_ms);  // 1240
```

### cURL
```bash
curl -X POST "https://docmind-api1.p.rapidapi.com/v1/parse" \
  -H "X-RapidAPI-Key: YOUR_KEY" \
  -H "X-RapidAPI-Host: docmind-api1.p.rapidapi.com" \
  -F "file=@receipt.jpg" \
  -F "type=receipt" \
  -F "quality=fast"
```

### Text input (no file)
```bash
curl -X POST "https://docmind-api1.p.rapidapi.com/v1/parse" \
  -H "X-RapidAPI-Key: YOUR_KEY" \
  -H "X-RapidAPI-Host: docmind-api1.p.rapidapi.com" \
  -H "Content-Type: application/json" \
  -d '{"text": "Invoice #1234\nDate: 2026-05-22\nItem: Widget x10 @ £5.00\nTotal: £50.00", "type": "invoice"}'
```

## Pricing Tiers (RapidAPI names)

| RapidAPI Tier | Name     | Price    | Parses/month | Per day | Per minute |
|---------------|----------|----------|--------------|---------|------------|
| BASIC         | Free     | $0       | 50           | 10      | 5          |
| PRO           | Pro      | $29/mo   | 1,000        | 50      | 20         |
| ULTRA         | Business | $99/mo   | 10,000       | 500     | 60         |
| MEGA          | Enterprise| Custom  | Unlimited    | Unlimited| 300       |

## Test Endpoint (free tier)
POST /v1/parse with body:
```json
{"text": "Receipt\nTesco Express\n2x Milk £2.40\n1x Bread £1.50\nTotal: £3.90\nVAT: £0.65", "type": "receipt"}
```
