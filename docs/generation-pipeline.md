# Generation Pipeline

## Overview

The generation pipeline converts a user's text prompt into a fully structured Project JSON without using any AI provider. It uses deterministic rule-based parsing and pre-defined templates.

## Flow

```
User Prompt
    │
    ▼
Prompt Analyzer    — Extract website type, brand name, theme
    │
    ▼
Generation Plan    — { websiteType, brandName, theme, sections[] }
    │
    ▼
Project Generator  — Convert plan → valid Project JSON
    │
    ▼
Content Generator  — Fill in missing props with sensible defaults
    │
    ▼
Editor Store       — initProject() loads it into the renderer
    │
    ▼
Renderer           — Sections render in the preview canvas
```

## Prompt Analyzer

`src/features/generation/analyzers/prompt-analyzer.ts`

Uses keyword matching to extract:

| Property | How it's extracted |
|----------|-------------------|
| `websiteType` | Keywords like "saas", "portfolio", "restaurant" |
| `theme` | Keywords like "dark", "minimal", "modern", "luxury" |
| `brandName` | Capitalized word after "for"/"called"/"named" |

Fallbacks: `saas` type, `modern` theme.

## Templates

`src/features/generation/templates/templates.ts`

Five website types with complete section definitions:

| Type | Sections |
|------|----------|
| SaaS | Header, Hero, Features, Pricing, FAQ, CTA, Footer |
| Portfolio | Header, Hero, Projects, CTA, Footer |
| Agency | Header, Hero, Services, FAQ, CTA, Footer |
| Restaurant | Header, Hero, Menu, CTA, Footer |
| E-commerce | Header, Hero, Features, Pricing, CTA, Footer |

Each template provides realistic placeholder copy (no lorem ipsum).

## Theme Resolver

`src/features/generation/analyzers/theme-resolver.ts`

Six theme styles with predefined design tokens:

| Theme | Feel |
|-------|------|
| Modern | Light, purple accent |
| Minimal | Light, neutral, spacious |
| Dark | Dark bg, light text, purple accent |
| Light | Bright, blue-ish, friendly |
| Luxury | Gold/premium |
| Startup | Vibrant, teal/indigo |

## Loading Experience

When Generate is pressed, the UI shows animated stages:

1. Analyzing prompt... (400ms)
2. Planning website... (500ms)
3. Generating sections... (600ms)
4. Building project... (400ms)
5. Done.

Each stage simulates a short delay to create the feeling of AI processing.

## Error Handling

- Empty prompt: send button is disabled, inline validation shown
- Unknown website type: falls back to SaaS
- Unknown theme: falls back to Modern
- Generation errors: shown as a chat bubble message
- Never crashes
