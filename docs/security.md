# Buildora Security

## API Key Management

- Gemini API key is stored in `.env.local` (already in `.gitignore`)
- Read server-side only via `process.env.GEMINI_API_KEY`
- Never exposed to the browser (no `NEXT_PUBLIC_` prefix)
- Never logged in any environment
- `.env.example` is committed but contains no real values

## Prompt Injection Resistance

- User prompts are treated as untrusted content
- Prompts are sanitized: null bytes and control characters are stripped
- Max prompt length: 4,000 characters
- Gemini receives a system instruction that blocks schema-change requests
- The system instruction tells Gemini to ignore requests to reveal internal instructions
- Gemini responses are validated with Zod against a strict schema
- Malformed JSON responses are caught and trigger fallback
- No executable code or HTML is ever returned from the AI

## API Route Security

- `POST /api/generate` validates all input
- Returns 400 for invalid or empty prompts
- Returns 405 for unsupported HTTP methods
- Returns 500 for internal errors (no stack traces leaked)
- Uses `AbortController` with 30-second timeout
- Retries at most once for transient failures

## Data Flow

- User data never leaves the browser except for the prompt sent to `/api/generate`
- Generated projects exist only in memory (no database persistence)
- Chat history is stored in Zustand (in-memory, lost on refresh)
- No authentication, no user accounts, no cookies
