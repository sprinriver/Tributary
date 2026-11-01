# 0014 — Align the web UI with the Celeste design system
Date: 2026-11-01 · Status: accepted
## Context
ARCHITECTURE §14 (ADR-014) said to align with Celeste's conventions when its repository became available. Number
0014 was reserved for this record. Phase 0 had no Celeste repository, so the web app shipped with minimal
GitHub-like styles. The owner then pointed to the MFGAIStudio repository (sprinriver), whose frontend carries the
"Celeste — design foundation". It was read read-only, and its styles were studied, not linked.
## Decision
Adopt Celeste's visual system in `apps/web`, keeping our own stack (React 19, TanStack Router, typed TS
components). Celeste uses React 18, react-router and JSX with inline styles.
- **Tokens** (`apps/web/src/styles.css`): brand blues, slate neutrals on a grey canvas, semantic colours,
  radius scale, layered soft shadows, focus ring, and the light and dark themes (`[data-theme]`). The old
  variable names (`--fg`, `--accent`, `--surface-alt`…) remain as aliases, so existing components follow the
  theme.
- **Shell** (`shell.css`, `shell/`):
  - dark gradient sidebar with brand, a ⌘K search trigger, grouped navigation (Workspace, Analysis, Admin),
    collapse (remembered), and a user card;
  - light top bar with the page title, theme toggle, run notifications and account menu;
  - on screens under 900 px the sidebar becomes a drawer.
- **Components:** cards, buttons, inputs, tabs (tab panels are cards), tables with uppercase headers and row
  hover, pill status badges with a dot, and modal dialogs. Line icons in the same 24 px stroke style.
- **Deliberate differences from Celeste:**
  - No Google Fonts download. Installs run in customers' accounts, often without outbound internet, so Inter
    is used when installed and the system font otherwise.
  - Accessibility wins over exact colours. Muted text is #526077 instead of #64748b, and badge text uses darker
    tones (`--success-text` and others), so the axe check (REG-07, WCAG AA) passes on every page.
  - No backdrop blur behind dialogs. It is costly in software rendering (it slowed the e2e suite by ~45% and
    made a dialog test time out); a plain dim is used.
  - All accessible names the product and its tests rely on are unchanged: navigation link names, the
    "Runs" and account buttons in the banner, and "Sign in".
- Charts (Plotly) and grids (AG Grid) keep their light rendering inside cards in dark mode, for now.
## Alternatives considered
- Tailwind + shadcn/ui (ARCHITECTURE §3 fallback): a new dependency set and a rewrite of every screen, for the
  same look.
- Copying Celeste's components: they are JSX with inline styles and react-router; porting the tokens and shell
  gives the same look with our typed components.
## Consequences
The product looks and behaves like the owner's other product. Every page follows light and dark themes through
tokens. New UI must use tokens, not hex colours; the old aliases can be removed once no component uses them.
## Revisit when
A shared design-system package exists across products (then depend on it), or customers ask for themed charts
and grids in dark mode.
