# Buildora Roadmap

## ✅ Sprint 1 — Foundation
- Next.js 16 project scaffold with TypeScript and Tailwind v4
- Folder structure: components, features, hooks, lib, services, store, types, utils, constants
- Reusable Button, Card, Layout components
- Design tokens and dark palette

## ✅ Sprint 2A — Editor Interface
- 5-zone editor layout: TopNav, LeftSidebar, Canvas, RightSidebar, StatusBar
- Premium dark interface (#0B0F19 palette)
- Browser frame preview, traffic lights, template cards

## ✅ Sprint 2B — Visual Polish
- Mock chat bubbles, segmented controls, accordion animations
- Refined spacing, hover states, 200ms transitions
- Interactive template cards on canvas

## ✅ Sprint 3 — Website Engine
- Generic project model (Project → Page → Section)
- Section Registry for dynamic component resolution
- 7 section renderers: Header, Hero, Features, Pricing, FAQ, CTA, Footer
- Zustand editor store with undo/redo history
- Demo SaaS landing page renders in preview

## ✅ Sprint 4 — Interactive Editor
- Section selection with hover/active outlines
- Inspector Registry mirroring Section Registry
- 7 section inspectors with live-editing controls
- Viewport switching (Desktop/Tablet/Mobile)
- Zoom controls (50%–125%)
- Undo/Redo connected to UI + keyboard shortcuts
- Delete/Duplicate sections
- Preview isolation with theme CSS variables
- Architecture documentation

## ✅ Sprint 5 — Rule-Based Generation Engine
- Prompt analyzer (keyword-based type/theme/brand extraction)
- 5 website templates: SaaS, Portfolio, Agency, Restaurant, E-commerce
- Theme resolver (6 themes with full design tokens)
- Content generator (deterministic placeholder content)
- Project generator (plan → valid Project JSON)
- Loading simulation with animated stages
- Generate button connected to full pipeline
- Inline error handling with chat bubble feedback

## 🔜 Sprint 6 — Upcoming
- AI provider integration (optional)
- Drag-and-drop section reordering
- Theme editor in RightSidebar
- Add/remove pages
- Export functionality
- Responsive preview improvements
