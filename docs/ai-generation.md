# AI Generation with Gemini

## Overview

Buildora integrates with Google Gemini for AI-powered website generation. The integration follows a strict provider abstraction — Gemini outputs structured JSON (a GenerationPlan), which is then converted into Project JSON via the existing project generator.

## Architecture

```
User prompt
  → Client: POST /api/generate
  → Server: Gemini provider → Zod validation → Project generator
  → Server: Fallback to rule-based provider if Gemini fails
  → Client: Editor store → Section registry renderer
```

## Provider Abstraction

All providers implement the `GenerationProvider` interface:

```typescript
interface GenerationProvider {
  readonly id: string;
  generatePlan(input: GenerationProviderInput): Promise<GenerationProviderResult>;
}
```

Two providers exist:

| Provider | Source | Description |
|----------|--------|-------------|
| `geminiProvider` | `gemini` | Real AI via Google Gemini API |
| `ruleBasedProvider` | `rule-based` | Deterministic keyword-based pipeline (synchronous) |

## API Route: `POST /api/generate`

**Input:**
```json
{
  "prompt": "Build a dark SaaS website for Huddle",
  "mode": "create"
}
```

**Success response:**
```json
{
  "success": true,
  "source": "gemini",
  "project": { ... },
  "warnings": []
}
```

**Failure response:**
```json
{
  "success": false,
  "error": { "code": "...", "message": "..." }
}
```

## Fallback Behavior

If Gemini fails (missing key, timeout, rate limit, invalid JSON, blocked content), the rule-based provider is used automatically. The response includes `"source": "rule-based"` so the UI can indicate local generation.

## Environment Setup

1. Get a Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. Copy `.env.example` to `.env.local`
3. Set `GEMINI_API_KEY=your_key_here`
4. Restart the development server

## Security

- The API key is never sent to the browser
- Prompts are sanitized (null byte stripping, length limit)
- Gemini responses are validated with Zod — malformed outputs are rejected
- User prompts are treated as untrusted content (prompt-injection resistance)
- Gemini receives a system instruction that prevents it from outputting code
- No executable code or HTML is ever returned from the AI
- Stack traces are never returned to the client
