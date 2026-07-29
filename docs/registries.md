# Registries

Buildora uses two registries to decouple section types from the core engine.

## Section Registry

Maps a section type string → a React component that renders the section.

```typescript
// src/features/editor/registry/section-registry.ts
sectionRegistry.register("hero", HeroSection);
sectionRegistry.register("pricing", PricingSection);

// Renderer uses it dynamically:
const Component = sectionRegistry.get(section.type);
```

### Adding a new section renderer

1. Create `src/features/editor/sections/MySection.tsx`
2. Add props to `SectionPropsMap` in `src/types/section.ts`
3. Register in `src/features/editor/registry/register-default-sections.ts`

## Inspector Registry

Maps a section type string → a React component that provides editing controls.

```typescript
// src/features/editor/registry/inspector-registry.ts
inspectorRegistry.register("hero", HeroInspector);
inspectorRegistry.register("pricing", PricingInspector);

// RightSidebar uses it dynamically:
const Inspector = inspectorRegistry.get(section.type);
```

### Adding a new inspector

1. Create `src/features/editor/inspectors/MyInspector.tsx`
2. Register in `src/features/editor/registry/register-default-inspectors.ts`

### Inspector component signature

```typescript
type InspectorComponent = ComponentType<{
  section: BaseSection;
  onUpdateProps: (props: Record<string, unknown>) => void;
  onUpdateStyles: (styles: Record<string, unknown>) => void;
}>;
```

Use the `SharedSectionControls` component at the bottom of each inspector for visibility, padding, alignment, duplicate, and delete controls.
