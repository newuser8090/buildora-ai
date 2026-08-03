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

## AI Editing (modify mode)

Beyond whole-site generation (`mode: "create"`), Buildora supports **targeted AI editing** of a selected section's content from a natural-language instruction (`mode: "modify"`).

### Flow

```
Select a section in the preview
  → AI Assistant composer shows an edit chip ("Editing: Hero section")
  → User prompt: "make it more playful"
  → Client: POST /api/generate { mode: "modify", prompt, target: { kind, sectionId, type, props, context } }
  → Server: Gemini edit provider (or rule-based fallback) → revised section props
  → Server: per-type Zod validation (AnySectionSchema) — invalid edits fall back to original props
  → Client: updateSectionProps(sectionId, props) — one undoable history entry
```

### Providers

| Provider | Description |
|----------|-------------|
| `geminiEditProvider` | Real AI via Google Gemini — receives the section type, current props, and the instruction; returns revised props JSON |
| `ruleBasedEditProvider` | Deterministic fallback — tone/intent keyword detection with structure-preserving copy templates |

### Modify request

```json
{
  "prompt": "make it more playful",
  "mode": "modify",
  "target": {
    "kind": "section",
    "sectionId": "s-hero",
    "type": "hero",
    "props": { "headline": "..." },
    "context": { "brandName": "Acme" }
  }
}
```

### Modify response

```json
{
  "success": true,
  "source": "gemini",
  "edits": [{ "type": "hero", "props": { "headline": "...", "subheadline": "..." } }],
  "warnings": []
}
```

### Editing guarantees

- **Structure preserved** — hrefs, prices, plan names, and asset references survive edits (the rule-based editor preserves them by construction; Gemini is instructed to preserve them)
- **Validated** — every edit is validated against the per-type section schema; invalid output keeps the original content
- **Undoable** — an applied edit is a single history entry
- **Backward compatible** — `mode: "create"` is unchanged; `mode` defaults to `"create"` when omitted
- The Regenerate quick action sends a default rewrite instruction for the selected section

## Security

- The API key is never sent to the browser
- Prompts are sanitized (null byte stripping, length limit)
- Gemini responses are validated with Zod — malformed outputs are rejected
- User prompts are treated as untrusted content (prompt-injection resistance)
- Gemini receives a system instruction that prevents it from outputting code
- No executable code or HTML is ever returned from the AI
- Stack traces are never returned to the client
