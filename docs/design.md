# Notion — Style Reference
> warm paper notebook under afternoon sun

**Theme:** light

Notion reads like a well-loved paper notebook under afternoon light: a warm off-white canvas (#f6f5f4) that feels tactile rather than clinical, generous sans typography that gives editorial weight to product copy, and color used as sparse punctuation — peachy pills highlight verbs, a single blue anchors the primary action, and a rotating cast of accent hues (coral, amber, sky, midnight) paints the feature card backgrounds like sticky notes. Cards sit on the canvas with 1px hairline borders and 12px corners — no shadows, no chrome — like ruled sections in a Moleskine. Motion is playful and springy, with 200ms ease transitions and bouncy character-mark animations that make the interface feel alive without ever being decorative.

## Tokens — Colors

| Name | Value | Token | Role |
|------|-------|-------|------|
| Notion Blue | `#0075de` | `--color-notion-blue` | Primary CTA fill, active nav accent, filled action buttons — the single chromatic commitment in a near-monochrome system, saturated enough to read as a switch |
| Paper Warmth | `#f6f5f4` | `--color-paper-warmth` | Page canvas, hero background, section backgrounds — warm off-white gives the system its tactile analog feel |
| Pure White | `#ffffff` | `--color-pure-white` | Card surfaces, elevated panels, logo-wall background, contrast text on dark cards |
| Ink Black | `#000000` | `--color-ink-black` | Primary text, nav links, headings — deployed at varying alpha (100%, 95%, 90%, 60%, 40%, 20%) to build hierarchy without adding new colors |
| Charcoal | `#111111` | `--color-charcoal` | Dark text variant for specific UI moments where pure black would feel too harsh |
| Stone | `#757575` | `--color-stone` | Secondary nav text, muted helper text, deactivated button labels — the 60% alpha of ink |
| Graphite | `#615d59` | `--color-graphite` | Body text with warm cast — the brown-tinted gray that harmonizes with the warm canvas |
| Slate | `#696969` | `--color-slate` | Card body text, secondary content within cards — slightly lighter than Stone |
| Sky Tint | `#e6f3fe` | `--color-sky-tint` | Ghost CTA background, soft blue wash for secondary actions, tinted hover states |
| Marigold | `#ffb110` | `--color-marigold` | Hero pill highlights, Agent feature card background, warm accent for callouts — the first color the eye finds |
| Coral | `#f64932` | `--color-coral` | Decorative card backgrounds, hero pill alternates, warm-to-hot accent in the rotating cast |
| Saffron | `#e89d01` | `--color-saffron` | Body-section accent panels, secondary warm yellow for background washes |
| Vermillion | `#e32d14` | `--color-vermillion` | Deep coral for saturated body-section backgrounds, signal-warm accent |
| Mocha | `#b18164` | `--color-mocha` | Warm brown accent for body-section panels — the earthy member of the accent cast |
| Signal Blue | `#097fe8` | `--color-signal-blue` | Decorative card backgrounds, hero decorative highlights, secondary blue for visual variety |
| Sky Wash | `#62aef0` | `--color-sky-wash` | Lightest blue in the cast — decorative backgrounds, heading accent highlights, airy washes |
| Midnight Ink | `#02093a` | `--color-midnight-ink` | Violet wash for highlight backgrounds, decorative bands, and soft emphasis behind content. |

## Tokens — Typography

### NotionInter — Primary sans-serif
Geometric humanist with slight quirks, deployed at 400 for body, 500 for nav/UI, 600-700 for display headings. The type-scale uses aggressive negative letter-spacing at large sizes (-4.6px at 96px, -2px at 72px) that tightens the headline to feel confident and compact rather than airy. · `--font-notioninter`

- **Substitute:** Inter
- **Weights:** 400, 500, 600, 700
- **Sizes:** 12px, 14px, 16px, 20px, 22px, 24px, 40px, 42px, 48px, 54px, 72px, 96px
- **Line height:** 0.83, 1.00, 1.04, 1.14, 1.21, 1.27, 1.33, 1.40, 1.43, 1.50
- **Letter spacing:** -0.048em at 96px, -0.036em at 42px, -0.035em at 54px, -0.028em at 72px, -0.011em at 22px, +0.01em at 12px, normal at body sizes
- **OpenType features:** `"lnum", "locl" 0`

### Lyon Text — Editorial serif
Reserved for specific body-text moments and section intros — used sparingly (4 instances) to give voice a literary weight, like a pull-quote in a magazine layout. Functions as a system accent, not a parallel hierarchy. · `--font-lyon-text`

- **Substitute:** Source Serif Pro
- **Weights:** 400
- **Sizes:** 18px, 32px
- **Line height:** 1.25, 1.56

### Type Scale

| Role | Size | Line Height | Letter Spacing | Token |
|------|------|-------------|----------------|-------|
| caption | 12px | 1.33 | 0.12px | `--text-caption` |
| body-sm | 14px | 1.43 | — | `--text-body-sm` |
| body | 16px | 1.5 | — | `--text-body` |
| subheading | 20px | 1 | — | `--text-subheading` |
| heading-sm | 22px | 1.27 | -0.242px | `--text-heading-sm` |
| heading | 40px | 1.5 | — | `--text-heading` |
| heading-lg | 48px | 1.5 | — | `--text-heading-lg` |
| display-sm | 54px | 1.04 | -1.89px | `--text-display-sm` |
| display | 72px | 1.21 | -2.016px | `--text-display` |
| display-lg | 96px | 1.04 | -4.608px | `--text-display-lg` |

## Tokens — Spacing & Shapes

**Base unit:** 4px · **Density:** comfortable

### Spacing Scale

| Name | Value | Token |
|------|-------|-------|
| 4 | 4px | `--spacing-4` |
| 8 | 8px | `--spacing-8` |
| 12 | 12px | `--spacing-12` |
| 16 | 16px | `--spacing-16` |
| 20 | 20px | `--spacing-20` |
| 24 | 24px | `--spacing-24` |
| 28 | 28px | `--spacing-28` |
| 32 | 32px | `--spacing-32` |
| 36 | 36px | `--spacing-36` |
| 64 | 64px | `--spacing-64` |
| 80 | 80px | `--spacing-80` |

### Border Radius

| Element | Value |
|---------|-------|
| cards | 12px |
| pills | 9999px |
| small | 4px |
| buttons | 8px |

### Layout

- **Page max-width:** 1440px
- **Section gap:** 80px
- **Card padding:** 24px
- **Element gap:** 8px

## Components

### Primary CTA Button
**Role:** Filled blue action button for the main conversion goal

Background #0075de, text #ffffff at 14px NotionInter weight 500, border-radius 8px, padding 6px 15px. The only chromatic filled button in the system — every other action defers to ghost or text styles.

### Ghost CTA Button
**Role:** Secondary action with a subtle blue tint

Background #e6f3fe (sky tint), text #0075de at 14px weight 500, border-radius 8px, padding 6px 15px. Pairs beside the primary CTA as the lower-commitment alternative.

### Ghost Text Button
**Role:** Minimal action button with no fill or border

Background transparent, text #000000 at 95% alpha, border-radius 8px, padding 6px 15px. The default for tertiary actions in the hero and feature cards.

### Outlined Text Button
**Role:** Bordered button with no fill for mid-priority actions

Background transparent, text #000000 at 90% alpha, 1px border at same color, border-radius 4px, padding 5px 10px. Used for compact inline actions like view-all links.

### Muted Nav Link
**Role:** Low-emphasis navigation item

Background transparent, text #000000 at 54% alpha, border-radius 8px, padding 12px 16px. The default nav-item state — text darkens to full alpha on hover, never gets an underline.

### Pill Tag
**Role:** Category label or status indicator

Background colored fill (varies), text #000000 or #ffffff, border-radius 9999px, padding 4px 12px. Used for status labels like 'In progress', 'To do', 'Complete' in product mockups.

### White Feature Card
**Role:** Standard content card on warm canvas

Background #ffffff, border-radius 12px, padding 24px, 1px solid border at rgba(0,0,0,0.08), no shadow. The default card — sits on the warm canvas like a sticky note.

### Accent Feature Card
**Role:** Full-bleed colored card for feature blocks

Background one of the accent hues (#ffb110, #f64932, #62aef0, #e6f3fe, etc.), border-radius 12px, padding 24px, no border. Functions as a colored panel that paints the canvas — text inside uses #000000 or #ffffff depending on contrast.

### Dark Feature Card
**Role:** Inverted card for dark-on-light contrast moments

Background #02093a (midnight), text #ffffff, border-radius 12px, padding 24px. The system uses this sparingly as a 'dark mode island' on the light page — not as a full dark theme.

### Hero Highlight Pill
**Role:** Colored pill placed behind a verb in hero copy

Background accent color (peach #f6d5b8, yellow #ffb110, or coral #f64932), text #000000, border-radius 9999px, padding 8px 24px. The signature typographic device — wraps a single word in a sentence to draw the eye and give it weight.

### Section Header
**Role:** Large heading that opens a new content section

NotionInter weight 500-700, 48-54px, line-height 1.04-1.5, letter-spacing -1.89 to -2.016px. Color #000000. Followed by an optional Lyon Text subhead at 18px for editorial voice.

## Do's and Don'ts

### Do
- Use #f6f5f4 as the page canvas and #ffffff for card surfaces — never invert this hierarchy by putting a warm card on a white page
- Reserve #0075de for the single primary action per screen; all secondary actions should use ghost (#e6f3fe bg) or text styles
- Apply negative letter-spacing to all display sizes: -4.6px at 96px, -2px at 72px, -1.9px at 54px — body text stays at normal tracking
- Use 1px solid borders at rgba(0,0,0,0.08) instead of shadows to separate cards from the canvas
- Use 12px border-radius for cards and 8px for buttons; reserve 9999px for pills and hero highlight pills only
- Paint feature-block backgrounds with accent hues (#ffb110, #f64932, #62aef0, #02093a) rather than adding borders or shadows to create visual variety
- Keep motion at 200ms with ease timing for hovers and transitions; reserve spring/bounce animations for character marks and hero elements

### Don't
- Do not use pure #ffffff as the page background — the warm #f6f5f4 canvas is the system's signature warmth
- Do not add shadows to content cards — the system uses hairline borders only, shadows appear only on the product UI mockup and nav bar
- Do not use multiple chromatic button colors in the same view — #0075de is the only filled button; color variety belongs in card backgrounds
- Do not use #000000 at 100% for all text — build hierarchy through alpha (100%, 95%, 60%, 40%) on the same color
- Do not use Lyon Text for UI labels or navigation — it is reserved for editorial body copy moments at 18px
- Do not apply border-radius larger than 12px to rectangular content — pills (9999px) and cards (12px) are the two shapes
- Do not use gradients — the system is strictly flat fills; visual depth comes from the warm-to-white surface contrast and accent card backgrounds

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 0 | Page Canvas | `#f6f5f4` | Warm off-white base for the entire page — the analog-paper feel starts here |
| 1 | Card Surface | `#ffffff` | White cards on warm canvas — pure white is reserved for surfaces that need to read as 'on top of the page' |
| 2 | Accent Card Surface | `#ffb110` | Colored card backgrounds (yellow, coral, blue, midnight) — feature blocks paint the canvas with single-hue fills |
| 3 | Dark Card Surface | `#02093a` | Deep navy panels for dark-mode-style feature blocks — inverting the surface stack with white text on midnight |

## Elevation

- **Nav (sticky):** `0px 0.7px 1.462px 0px rgb(0% 0% 0%/0.015), 0px 3px 9px 0px rgb(0% 0% 0%/0.03)`
- **Product UI Mockup:** `0px 4px 12px rgba(0, 0, 0, 0.1)`

## Imagery

Illustration-first, photography-free. The visual language is built from flat illustrated character marks (round faces in 2px colored circles), abstract decorative elements (hand-drawn squiggles, sparkles, arrows, flower shapes), and product UI mockups. There are no lifestyle photos, no stock imagery, no abstract 3D renders.

## Layout

Centered, max-width contained at ~1440px. Sections alternate between white-card grids and full-bleed colored accent panels. Feature blocks use a 2-column layout (text left, colored panel right) that alternates left-right between sections. Section gaps are generous (~80px) creating a calm vertical rhythm. Navigation is a fixed top bar at 64px height.

## Quick Color Reference

- text: #000000 (build hierarchy through alpha: 100% / 95% / 60% / 40%)
- background: #f6f5f4 (warm off-white canvas)
- card surface: #ffffff
- border: rgba(0, 0, 0, 0.08)
- primary action: #0075de (filled action)
- accent: #ffb110, #f64932, #62aef0, #02093a (rotate through these for card backgrounds)

## Where this lives in the code

The full token set is declared once in `src/app/globals.css`:

- `@theme { … }` — the Notion tokens themselves, available as Tailwind utilities (`bg-marigold`, `text-graphite`, `text-heading-sm`).
- `:root { … }` — a semantic layer mapping those tokens onto the names shadcn/ui and Evil Charts expect (`--primary`, `--card`, `--border`, `--chart-1`…). Adding a shadcn or Evil Charts component therefore inherits the Notion look with no further work.

Component implementations of the specs above:

| Spec | File |
|---|---|
| Primary / ghost / text / outlined buttons | `apps/web/src/components/ui/button.tsx` |
| White card, accent card | `apps/web/src/components/ui/card.tsx` |
| Pill tag, hero highlight pill | `apps/web/src/components/ui/pill.tsx` |
| Muted nav link, 64px nav bar | `apps/web/src/components/shared/panel-nav.tsx` |
