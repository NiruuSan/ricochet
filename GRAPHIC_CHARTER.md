# Bounce — Graphic Charter

Visual identity reference for the Bounce website and game. Dark, arcade, high-contrast, with a single lime accent.

Source of truth in code: theme tokens in `app/globals.css` (`:root`), game colors in `app/arena/board-canvas.ts`, logos in `public/brand/`.

---

## 1. Brand

| Element | Spec |
|---|---|
| Name | **Bounce** (wordmark written lowercase: *bounce.*) |
| Tagline | *Same board. Your angle.* |
| UI language | English |

### Logo files (`public/brand/`)

| File | Content | Use on |
|---|---|---|
| `bounce-white.svg` | Lime icon + white wordmark (562×138) | Dark backgrounds — **default on the site** (top bar, profile watermark) |
| `bounce-dark.svg` | Lime icon + `#0C1018` wordmark | Light backgrounds |
| `bounce-black.svg` | Lime icon + black wordmark | Light backgrounds, print |
| `bounce-icon.svg` | Lime icon alone (138×138) | Favicon (`app/icon.svg`), avatars, app icons |
| `bounce-icon-rotated.svg` | Lime icon tilted ≈ -9.5° (159×159) | Playful accents (sign-in card) |
| `bounce-icon-512.png` | Lime icon, white glyph (512×512) | Android / install icon (web manifest) |
| `app/apple-icon.png` | Lime icon, white glyph (180×180) | iPhone home screen |
| `app/opengraph-image.png`, `app/twitter-image.png` | Tilted dark icon + dark wordmark on lime (1200×600) | Link previews (Discord, X, iMessage…) |

**Icon:** `#C6F564` rounded square (radius 30/138) with a cut-out bouncing trajectory and ball, so the background shows through.

**Rules**
- Keep the wordmark ratio (≈ 4.07:1); never stretch or recolor the icon.
- Top bar size: 147px wide (126px on phones).
- Minimum clear space around the logo: half the icon height.

---

## 2. Typography

**Font family:** `Arial, Helvetica, sans-serif` (system font, no web font loaded).

| Style | Size | Weight | Letter-spacing | Line-height |
|---|---|---|---|---|
| H1 | `clamp(32px, 4vw, 48px)` | 850 | -1.8px | 1.12 |
| H2 | 23px | 750 | -0.65px | — |
| H3 | 17px | 700 | — | — |
| Body | 16px | 400 | — | 1.6 (paragraphs) |
| Button | 14px | 750 | — | 1.4 |
| Navigation | 14px | — | — | — |
| Tag / label (`.tag`) | 12px, UPPERCASE | 800 | 1.8px | — |
| Fine print (`.fine`) | 12px, color `#93a0b8` | — | — | 1.6 |
| Micro labels (chips, badges, stat captions) | 8–11px, UPPERCASE | 700–900 | 0.5–1.4px | — |

**Rules**
- Big headings: heavy weights (750–900) and negative letter-spacing.
- Small labels: uppercase, bold, positive letter-spacing (e.g. `PRIZE POOL`, `NET PROFIT`).
- Most used sizes: 12, 14, 11, 13, 10, 15px.
- Numbers (scores, amounts) formatted with `toLocaleString("en")`.

---

## 3. Colors

### 3.1 Theme tokens (`:root` in `app/globals.css`)

| Token | Hex | Usage |
|---|---|---|
| `--background` | `#0c1018` | Page background |
| `--foreground` | `#f6f8fd` | Main text |
| `--card` | `#141a25` | Cards, panels |
| `--popover` | `#1b2230` | Menus, popovers |
| `--primary` | **`#c6f564`** | Brand accent, primary buttons, links, focus |
| `--primary-foreground` | `#12170b` | Text on lime |
| `--secondary` | `#222b3b` | Secondary surfaces |
| `--muted` | `#1b2331` | Muted zones |
| `--muted-foreground` | `#a5b0c5` | Secondary text |
| `--accent` | `#283446` | Highlighted surfaces |
| `--destructive` | `#ff8091` | Errors, dangerous actions |
| `--border` | `#293345` | Borders |
| `--input` | `#313d51` | Input fields |
| `--ring` | `#c6f564` | Focus ring |
| `--radius` | `1rem` | Base radius |

### 3.2 Primary — Lime

| Shade | Hex | Usage |
|---|---|---|
| Base | `#c6f564` | Accent, primary button, active states |
| Hover | `#d5ff87` | Primary button hover |
| Light | `#ddffab`, `#eaffc0`, `#dff5b3` | Glows, highlights, ball trail |
| Button shadow | `#718e35` | `box-shadow: 0 4px 0` under primary button |
| Dark | `#809e3e`, `#6f8a3d`, `#4b5d2a`, `#2f4312` | Brick shade, borders |
| Text on lime | `#151e09`, `#12170b`, `#101a05` | |
| Transparent tints | `#c6f56408` → `#c6f564aa` | Backgrounds, halos, borders (e.g. `.you` badge: bg `#c6f56415`, border `#c6f56426`) |

### 3.3 Neutrals (blue-grey)

| Role | Hex |
|---|---|
| Deepest background | `#07090d`, `#0a0d12` |
| Page background | `#0c1018` |
| Top bar | `#0f141e` |
| Surfaces | `#121a26`, `#141a25`, `#151d2a`, `#1a2230`, `#1b2230` |
| Raised surfaces / button bg | `#222c3b`, `#242d3d`, `#263043`, `#2b3546` |
| Button hover | `#303e52` |
| Borders | `#293345`, `#303b4f`, `#3b485e` |
| Tertiary text | `#6c7a90`, `#8e9cb1` |
| Secondary text | `#93a1b8`, `#9dabc2`, `#a5b0c5` |
| Light text | `#b6c2d4`, `#cfd8e6`, `#d8e6fa` |
| Main text | `#f6f8fd`, `#fff` |
| Overlays / shadows | `#000a`, `#0009`, `#0007`, `#0005` |
| White veils | `#ffffff08`, `#ffffff14` |

### 3.4 Status & accent colors

| Meaning | Colors | Usage |
|---|---|---|
| Error / loss / danger | `#ff8091`, `#ff91a0`, `#ffb2bf`, `#f2394d` | Error boxes (bg `#ff647315`, border `#ff647355`, text `#ffb3bc`), negative amounts, Cancel/Delete buttons |
| Warning | `#ffb86b` | 2FA, alerts |
| Gold / 1st place | `#ffd17b` | Winners, tournament highlights |
| Silver / 2nd place | blue-grey neutrals | Podium |
| Bronze / 3rd place | `#d4ad83` | Podium 3rd place |
| Info / SOL devnet | `#7fd6ff` | SOL chips, info badges |
| Gems / secondary accent | `#b6a1fc`, `#8f76f0` | Gem chips, panel title icons |
| Success / positive | `#c6f564` | Gains, confirmations |

### 3.5 Game palette (`app/arena/board-canvas.ts`)

Bricks — each color has a light face and a dark shade:

| Brick | Light | Dark |
|---|---|---|
| Violet | `#bb8cff` | `#8260b7` |
| Teal | `#68d9d6` | `#368887` |
| Gold | `#ffd17b` | `#a58042` |
| Blue | `#9fccfc` | `#5b7fac` |
| Pink | `#fa98b4` | `#9b536c` |
| Lime | `#c6f564` | `#809e3e` |

| Board element | Color |
|---|---|
| Board background | `#0c1422` |
| Grid / surfaces | `#162238`, `#263247`, `#111d2d` |
| Outline | `#29374b` |
| Board text | `#8394af` |
| Ball | `#d8e6fa` |
| Launcher / glow | `#c6f564` (shadow), `#ddffab` |
| Aim trail | `rgba(198, 245, 100, α)` fading along the line |

The match intro particles (`match-intro.tsx`) reuse the six brick colors.

### 3.6 Third-party brand colors (sign-in buttons)

| Brand | Colors |
|---|---|
| Discord | `#5865f2` |
| Google | `#4285f4`, `#ea4335`, `#fbbc05`, `#34a853` |

---

## 4. Shapes & spacing

| Element | Radius |
|---|---|
| Buttons, inputs, alerts | 10px |
| Small chips / badges | 4–8px |
| Cards (medium) | 12–16px |
| Panels (`.panel`) | 18px |
| Large cards / hero | 20px |
| Pills | 999px |
| Avatars | 50% |

- Borders: always **1px solid**, neutral (`--border`) or tinted accent at low opacity.
- Panel padding: 24px; gap between stacked panels: 18px.
- Top bar: 86px high, 4% horizontal padding, bottom border `--border`.

---

## 5. Components

**Primary button (`.btn .btn-primary`)**
- bg `#c6f564`, text `#151e09`, border `#c6f564`
- 3D effect: `box-shadow: 0 4px 0 #718e35`
- Hover: bg `#d5ff87`, `translateY(-1px)`

**Secondary button (`.btn`)**
- bg `#222c3b`, text `#f6f8fd`, border `1px solid #3b485e`
- padding 13px 18px, radius 10px, 14px / 750, icon gap 9px
- Hover: bg `#303e52`, `translateY(-1px)`

**Danger button**
- Outline style: border `#ff8091`, text `#ffb2bf`

**Disabled**
- opacity 0.45, `cursor: not-allowed`

**Panel / card (`.panel`)**
- bg `--card`, border `1px solid --border`, radius 18px, padding 24px
- Title icon color `#b6a1fc`

**Error box (`.error`)**
- bg `#ff647315`, border `#ff647355`, text `#ffb3bc`, radius 10px

**Focus**
- `outline: 2px solid #c6f564; outline-offset: 5px` on buttons, links, inputs, canvas

**Podium (`app/arena/views/podium.tsx`)**
- 1st place in the middle, highlighted (gold/lime), 2nd neutral, 3rd bronze `#d4ad83`
- Big watermark rank number, uppercase title (`CHAMPION`, `LEADING THE PACK`…)

---

## 6. Icons

- Library: **Lucide** (`lucide-react`)
- Size in buttons and links: 19×19px (14–16px in compact places)
- Color: inherits text color (`currentColor`)

---

## 7. Motion

- Standard transitions: `background`, `transform`, `border-color` at **0.18s**
- Hover lift: `translateY(-1px)`
- Podium cards: `transform .2s, border-color .2s`
- `prefers-reduced-motion: reduce` is respected (animations disabled)

---

## 8. Responsive breakpoints

| Breakpoint | Usage |
|---|---|
| ≤ 1120 / 1050 / 1000px | Multi-column layouts collapse |
| ≤ 960px | Top bar wraps, navigation moves to a full-width row |
| ≤ 900 / 760 / 720px | Tablet → mobile layouts (podium stacks) |
| ≤ 600 / 520 / 480 / 400px | Small phones |
| ≥ 1500px | Wide screens |
