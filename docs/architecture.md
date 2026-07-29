# Buildora Architecture

## Overview

Buildora is a visual website builder powered by a generic project model and a registry-based rendering system. The architecture is designed for extensibility — adding a new section type requires only a component and a registry entry.

## Data Flow

```
Project JSON (Zustand store)
  │
  ▼
Section Registry (type → React Component)
  │
  ▼
SectionRenderer (maps sections → components via registry)
  │
  ▼
SelectableSection (wraps each rendered section with selection UI)
  │
  ▼
Canvas (browser frame + viewport/zoom + theme CSS vars)
```

## Directory Layout

```
src/
├── app/                          # Next.js App Router
├── components/
│   ├── editor/                   # Editor shell components
│   │   ├── Canvas.tsx
│   │   ├── TopNav.tsx
│   │   ├── LeftSidebar.tsx
│   │   ├── RightSidebar.tsx
│   │   ├── StatusBar.tsx
│   │   └── EditorProvider.tsx
│   └── ui/                       # Reusable design-system primitives
├── features/editor/
│   ├── store/editor-store.ts     # Zustand store (project, selection, history)
│   ├── registry/
│   │   ├── section-registry.ts   # Section component registry
│   │   ├── inspector-registry.ts # Inspector component registry
│   │   ├── register-default-sections.ts
│   │   └── register-default-inspectors.ts
│   ├── sections/                 # Section renderers (7 built-in)
│   ├── inspectors/               # Section inspectors (7 built-in)
│   ├── renderer/
│   │   └── SectionRenderer.tsx   # Dynamic section renderer
│   ├── components/
│   │   └── SelectableSection.tsx # Selection outline wrapper
│   └── mock/
│       └── mock-project.ts       # Demo SaaS landing page
├── hooks/
│   └── useKeyboardShortcuts.ts   # Global keyboard shortcut handler
├── types/
│   ├── section.ts                # BaseSection + typed section props
│   ├── project.ts                # Project, Page, Viewport
│   └── theme.ts                  # Theme model
├── utils/cn.ts                   # Tailwind class merger
└── constants/index.ts            # App-wide constants
```
