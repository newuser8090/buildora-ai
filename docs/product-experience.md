# Product Experience

## Generation Lifecycle

When a user submits a prompt, Buildora progresses through 7 stages:

1. **Understanding your request** — validating and sanitizing input
2. **Identifying your brand** — extracting brand name, website type
3. **Choosing a visual direction** — resolving theme, colors, typography
4. **Planning the page structure** — determining sections and order
5. **Writing website content** — generating copy for each section
6. **Building editable sections** — constructing the Project JSON
7. **Finalizing your website** — validating and loading into editor

### Progress Display

- A single pending assistant message shows all 7 stages as a checklist
- Completed stages show a ✓ checkmark in accent color
- The active stage pulses with a small dot indicator
- Pending stages are visually subdued (30% opacity)
- On completion, the progress checklist is replaced with the final summary

### Preview Overlay

- During generation, the existing preview remains visible but dimmed (50% opacity, 1px blur)
- A centered overlay inside the browser frame shows the stage checklist
- The overlay uses a subtle backdrop blur, not a full-screen modal
- On success, the new project fades in (350ms, slight translateY)
- On failure, the existing project remains unchanged

## Empty States

### AI Assistant (Left Sidebar)

- Shows a greeting message: "Hi! I'm Buildora..."
- 4 example prompt cards that populate the composer on click
- A hint: "Describe the brand, style, audience, and colors for better results."
- All elements disappear once the first conversation message is added

### Preview Canvas

- Shows a subtle wireframe illustration built with CSS and icons
- Headline: "Your website will appear here"
- Supporting text describing the AI workflow
- 4 template cards as visual inspiration (non-functional placeholders)
- Browser frame remains visible for layout consistency

## Motion System

### Durations

| Context | Duration |
|---------|----------|
| Quick interactions (hover, active) | 120–180ms |
| Panel transitions (accordion) | 180–240ms |
| Preview replacement (fade) | 250–400ms |
| Chat message appearance | 160–240ms |

### Guidelines

- All animations respect `prefers-reduced-motion`
- No animation on inspector keystrokes or live website text edits
- Preview transitions use opacity + translateY (no scale, no blur changes)
- Chat messages animate in only on first appearance, not every re-render
- Generation overlay uses motion.div with AnimatePresence for clean mount/unmount

## Accessibility

- All icon-only buttons have `aria-label`
- Generation progress stages are readable without relying on color alone (checkmarks + dots + labels)
- `aria-live="polite"` region announces completion (via status bar)
- Keyboard focus is visible via `:focus-visible` ring in accent color
- `type="button"` on all button elements to prevent form submission
- Disabled states use reduced opacity and `cursor-not-allowed`
- Text contrast: all text meets WCAG AA minimum in both light and dark modes
- Reduced motion: all animations and transitions respect the OS preference

## Error Messages

| Scenario | Message |
|----------|---------|
| Empty prompt | "Prompt cannot be empty" (inline validation, button disabled) |
| Prompt too long | "Your prompt is too long. Please keep it under 4,000 characters." |
| Generation timeout | "Generation took too long. Please try again." |
| API unavailable (fallback) | "Gemini was unavailable. Used local generation engine." |
| Complete failure | "Buildora couldn't generate a new website. Your current project is unchanged." |
| Unknown error | "I couldn't generate that website. Please try again." |

## Intentional Limitations

- No undo for chat messages (browser refresh resets chat)
- No export functionality (Save/Export buttons are visual placeholders)
- No drag-and-drop section reordering
- No multi-selection of sections
- No inline text editing inside the canvas preview
- No image uploads or AI image generation
- No authentication or project persistence
- No billing or token tracking
- No collaboration features
