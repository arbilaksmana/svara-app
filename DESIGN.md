# Svara — Style Reference

> Neutral product surface with a single blue action accent.

**Theme:** light (dark surface tokens tersedia)

Diadaptasi dari [Passport — tiket.design](https://tiket.design/system) pada 2026-11-17, mengikuti format **Refero DESIGN.md / Style Reference** ([contoh: Figma](https://styles.refero.design/style/5fd3b3b4-02ab-456a-87aa-e4395636b671)).
Nilai yang diberi tanda **↻** adalah hasil adaptasi, bukan nilai sumber. Lihat §"Delta dari sumber" di akhir.

Svara memakai kanvas putih bersih dengan teks netral gelap dan satu biru aksi. Warna muncul secara fungsional (CTA, state aktif, status), bukan dekoratif. Hierarki dibangun dari skala, weight, dan ruang — bukan dari warna atau bayangan berlapis. Elevation hanya tiga level. Ritmusnya padat di area pilihan (kartu, list) dan longgar di area baca (halaman detail).

## Quick Color Reference

```
background:        #ffffff
surface:           #f4f7fe
text:              #303135
muted text:        #71747d
border:            #d8dce8
accent:            #0064d2   (fill CTA + teks link)
accent on light:   #0064d2   (teks, ≥4.5:1)
on accent:         #ffffff
danger:            #c4382f
success:           #0a7a3b
```

## Guidelines

### Do

- Pakai biru `#0064D2` untuk **satu aksi utama per area**; aksi sekunder cukup outline/ghost dengan border `N200`.
- **Pisahkan warna fill dan warna teks.** `B400` sumber (`#007CFF`, 3.94:1) tidak lolos AA untuk teks maupun untuk teks putih di atasnya. Gunakan `--color-action` `#0064D2` untuk keduanya (5.59:1), atau token teks terpisah.
- Teks isi minimum **16px**; `12px`/`14px` hanya untuk caption/helper/label, bukan paragraf.
- Semua interaktif wajib punya `:focus-visible` (`outline: 3px solid var(--color-action)` + `outline-offset: 2px`). State "Focused" pada Textfield sumber adalah state form, **bukan** focus ring keyboard.
- Konversi line-height ke **unitless ratio** (`1.38`, `1.43`, …), jangan `px` seperti sumber, agar aman saat zoom/root font-size berubah.
- Radius mengikuti empat tier: `4 / 8 / 16 / 999px`. Jangan mencampur tier di satu elemen.
- Bayangan hanya dari tiga token `--shadow-0/1/2`; jangan menulis `box-shadow` lepas.
- Hormati `prefers-reduced-motion`: matikan shimmer, rotasi banner, dan transisi.
- Biarkan copywriter yang membatasi jumlah baris; **jangan** set `max-line`/`line-clamp` di kode untuk teks pendek (risiko terpotong di layar kecil).

### Don't

- Jangan pakai `Tiket Odyssey Text`, ikon `tds_ic_*`, gradient tier (Silver/Gold/Platinum/Diamond), atau nama "Passport"/"TDS" — aset proprietary tiket.com.
- Jangan samakan `IconLowEmphasis`/`TextDisabled` (`#AEB2BE`, 2.12:1) dengan teks biasa — hanya untuk state disabled (dikecualikan WCAG) dan dekorasi.
- Jangan pakai `#0BAE54` sebagai teks/icon status di atas putih (2.92:1). Pakai `#0A7A3B` untuk teks; `#0BAE54` hanya fill.
- Jangan pakai 10px/`Extra Small` untuk teks yang dibaca; itu label annotation saja.
- Jangan hardcode breakpoint 840px dari sumber tanpa rekonsiliasi (lihat §Layout) — kolom `Fluid` di tabel sumber bergeser.
- Jangan mengisi secondary button dengan warna; jangan menambah warna kromatik baru ke UI.

---

## Tokens — Colors

### Neutrals (nilai sumber, dipertahankan)

| Name | Value | Token | Role |
|---|---|---|---|
| N0 / Paper | `#ffffff` | `--color-n0` | Page canvas, surface kartu, teks invert |
| N50 ↻ | `#fbfcff` | `--color-n50` | Read-only input surface (sumber: token dipakai, HEX tidak dipublikasikan) |
| N100 | `#f4f7fe` | `--color-n100` | Disabled surface, read-only, soft panel |
| N200 | `#d8dce8` | `--color-n200` | Border, divider |
| Control border | `#8d919c` | `--color-control-border` | Border input/select; 3.15:1 terhadap N0 (WCAG 1.4.11) |
| N400 | `#aeb2be` | `--color-n400` | Disabled text/icon, icon low-emphasis — **dekoratif saja, bukan teks** |
| N600 | `#71747d` | `--color-n600` | Muted / low-emphasis text (4.67:1) |
| N700 | `#4d4f56` | `--color-n700` | High-emphasis icon (8.18:1) |
| N800 / Ink | `#303135` | `--color-n800` | Primary text, heading, border kontras (12.99:1) |
| Dark ↻ | `#171918` | `--color-dark` | Surface gelap (Tooltip, dark mode) — diambil dari token CSS situs sumber |

### Brand & status

| Name | Value | Token | Role |
|---|---|---|---|
| Action / Brand | `#0064d2` ↻ | `--color-action` | Fill CTA, active indicator, link teks. **5.59:1** thd putih & utk teks putih di atasnya |
| Action Hover ↻ | `#0534c1` | `--color-action-hover` | Hover/pressed (9.26:1) |
| Action Soft | `#e7f2ff` | `--color-action-soft` | Banner info, selected chip, focus tint |
| Action Subtle | `#a3cfff` | `--color-action-subtle` | Disabled brand fill, dekorasi |
| Action Light | `#5baaff` | `--color-action-light` | Dekorasi saja (2.43:1) |
| Danger text | `#c4382f` ↻ | `--color-danger-text` | Teks error/alert (5.31:1) |
| Danger fill | `#f15c59` | `--color-danger-fill` | Fill icon/outline error (3.27:1 — ikon OK, teks tidak) |
| Danger soft | `#ffdfdf` | `--color-danger-soft` | Banner alert |
| Success text | `#0a7a3b` ↻ | `--color-success-text` | Teks positif (5.44:1) |
| Success fill | `#0bae54` | `--color-success-fill` | Fill icon positif — **bukan teks** (2.92:1) |
| Success soft | `#e2fbed` | `--color-success-soft` | Banner success |
| Warning soft | `#fef8d0` | `--color-warning-soft` | Banner warning |
| Analytic text | `#8a4f00` ↻ | `--color-analytic-text` | Teks analytic (6.56:1); menggantikan `O500` yang kosong |
| Analytic icon | `#a85c00` ↻ | `--color-analytic-icon` | Ikon analytic (5.00:1); menggantikan `O400` yang kosong |
| USP text | `#0b7a6b` ↻ | `--color-usp-text` | Teks/icon unique-selling-point (5.24:1); menggantikan `T500` yang kosong |

### Semantic alias

| Token | Maps to | Kontras thd `#fff` |
|---|---|---|
| `--text-high` | `--color-n800` | 12.99:1 |
| `--text-low` | `--color-n600` | 4.67:1 |
| `--text-disabled` | `--color-n400` | 2.12:1 (disabled only) |
| `--text-activity` | `--color-action` | 5.59:1 |
| `--text-alert` | `--color-danger-text` | 5.31:1 |
| `--text-positive` | `--color-success-text` | 5.44:1 |
| `--text-analytic` | `--color-analytic-text` | 6.56:1 |
| `--text-usp` | `--color-usp-text` | 5.24:1 |
| `--text-invert` | `--color-n0` | on action 5.59:1 / on N800 12.99:1 / on dark 17.67:1 |
| `--icon-high` | `--color-n700` | 8.18:1 |
| `--icon-low` | `--color-n400` | 2.12:1 (disabled/decor only) |
| `--icon-activity` | `--color-action` | 5.59:1 |
| `--icon-alert` | `--color-danger-fill` | 3.27:1 (≥3 OK) |
| `--icon-positive` | `--color-success-fill` | 2.92:1 — fill/dekorasi, jangan untuk ikon bermakna |

### Gradient (dekoratif, opsional)

Dua stop per arah. Tambahkan sudut eksplisit — sumber hanya memberi HEX tanpa arah.

| Name | Stops | Token |
|---|---|---|
| Violet (default) | `#18dc9b` → `#6e54ef` | `--grad-violet` |
| Green | `#01cf6c` → `#02cd9c` | `--grad-green` |
| Orange | `#ff7a00` → `#ff3e65` | `--grad-orange` |
| Red | `#ff4062` → `#ff00b8` | `--grad-red` |
| Tosca | `#00cc9b` → `#017cff` | `--grad-tosca` |
| Blue | `#007bff` → `#00c1eb` | `--grad-blue` |
| Purple | `#fa00b4` → `#7600d2` | `--grad-purple` |
| Light Blue | `#e7f2ff` → `#d9eafe` | `--grad-light-blue` |

> Contoh CSS: `background: linear-gradient(135deg, var(--grad-violet-from), var(--grad-violet-to))`.
> ⚠️ Stop kedua Gradient Blue dilabeli `B200` di sumber (bukan `GB200`) — typo sumber; nilai `#00c1eb` tetap.
> **Tier gradient** (Silver/Gold/Platinum/Diamond) sengaja dihapus: itu aset loyalty program tiket.com, bukan token UI generik.

---

## Tokens — Typography

### Font families ↻

Sumber memakai **`Tiket Odyssey Text`** (TTF proprietary: Regular/SemiBold/Bold/Italic terpisah, bukan variable) — **tidak ada lisensi web-font**. Ganti dengan font berlisensi web.

| Role | Family | Fallback | Token |
|---|---|---|---|
| Primary | `Inter` (variable, SIL OFL) | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | `--font-sans` |
| Code / annotation | `JetBrains Mono` (SIL OFL) | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | `--font-mono` |

- **Weights:** 400 · 600 · 700 (sumber: 400/600/700).
- **OpenType:** `"kern"` aktif.
- **Letter spacing:** `-0.01em` pada heading ≥28px, `0` pada body, `+0.03em` pada mono annotation.

### Type scale (Website — skala Mobile dibuang)

Line-height adalah **rasio unitless** (konversi dari px sumber).

| Role | Size | Weight | Line height | Use for | Token |
|---|---|---|---|---|---|
| display | 56px | 700 | 1.11 (62/56) | Banner title | `--text-display` |
| heading-1 | 38px | 700 | 1.16 (44/38) | Oversized screen title, once per page | `--text-h1` |
| heading-2 | 28px | 700 | 1.21 (34/28) | Main titles, once per page | `--text-h2` |
| heading-3 | 18px | 700 / 400 | 1.33 (24/18) | Large button, link, sub heading | `--text-h3` |
| body-1 | 16px | 700 / 400 | 1.38 (22/16) | Small button, link, body copy, textfield | `--text-body` |
| body-2 | 14px | 700 / 400 | 1.43 (20/14) | Caption, helper, label textfield | `--text-body-sm` |
| body-3 | 12px | 600 | 1.33 (16/12) | Label only | `--text-caption` |
| annotation ↻ | 10px | 700 / 400 | 1.40 (14/10) | **Annotation only — jangan untuk paragraf** | `--text-annotation` |

> Skala sumber "Extra Small 10px / Paragraph" bertentangan dengan aturan web yang aman. Di sini 10px diturunkan perannya jadi annotation, dan body minimum dinaikkan ke 16px.
> Font-size sebaiknya `rem` di CSS: `1rem = 16px`.

---

## Tokens — Spacing & Shape

**Base unit:** 8px (sumber: `x = 8`, multiplier). Density: comfortable.

### Spacing scale

| Name | Value | Token |
|---|---|---|
| x | 8px | `--space-1` |
| 1.5x | 12px | `--space-2` |
| 2x | 16px | `--space-3` |
| 3x | 24px | `--space-4` |
| 4x | 32px | `--space-5` |
| 6x | 48px | `--space-6` |
| 8x | 64px | `--space-7` |
| 12x | 96px | `--space-8` |
| 16x | 128px | `--space-9` |

> Sumber mengulang label `X-Large` untuk 3x–16x; di sini dinamai berurutan.
> Tambahan ↻ untuk keperluan web: `--space-0: 4px` (icon gap), `--space-half: 2px`.

### Border radius

| Element | Value | Token |
|---|---|---|
| Chips, Label, Countdown | 4px | `--radius-sm` |
| Button (alt), Input, Tooltip, Coachmark, Accordion, Banner | 8px | `--radius-md` |
| Bottomsheet, Banner big-rounded | 16px | `--radius-lg` |
| Badge / chip bulat | 999px | `--radius-full` |
| Full-bleed (nav, tabs, big rectangle) | 0px | `--radius-none` |

> Sumber juga memakai `6px` pada Button — disatukan ke 8px agar tidak ada tier kelima.

### Elevation

Shadow color dasar `#303135` (N800). Level 02 varian Android dihapus (tidak relevan di web).

| Level | Name | Value | Token | Purpose |
|---|---|---|---|---|
| 00 | Canvas | `none` | `--shadow-0` | Background |
| 01 | Raised | `0 2px 8px 0 rgba(48,49,53,.16)` | `--shadow-1` | Card, sticky button, snackbar, notification badge, bottom nav |
| 02 | Overlay | `0 4px 12px 0 rgba(48,49,53,.20)` | `--shadow-2` | Dropdown, popover, drawer, modal, dialog, hover raise |

**Skala z-index ↻** (sumber menyebut "z-index" tapi tidak pernah memberi angka):

```
--z-base: 0; --z-raised: 10; --z-sticky: 20;
--z-nav: 30; --z-overlay: 40; --z-modal: 50; --z-toast: 60;
```

### Layout

- **Page max-width:** 1200px (sumber, konsisten dengan Refero).
- **Section gap:** 80–120px ↻ · **Card padding:** 16–24px · **Element gap:** 12–16px.
- **Breakpoints ↻** — tabel sumber direkonsiliasi (kolom `Fluid` bergeser; desktop mulainya 840px tidak lazim):

| Name | Range | Margin | Container | Columns | Gutter |
|---|---|---|---|---|---|
| xs | 320–399 | 20px | fluid | 12 | 8px |
| sm | 400–599 | 20px | fluid | 12 | 12px |
| md | 600–839 | 40px | fluid | 12 | 16px |
| lg | 840–959 | fluid | 760px | 12 | 16px |
| xl | 960–1279 | 100px | fluid | 12 | 16px |
| 2xl | 1280–1439 | 120px | fluid | 12 | 20px |
| 3xl | 1440+ | fluid | 1200px | 12 | 24px |

> Pertahankan rentang sumber agar tidak mengubah perilaku yang sudah ada; hanya perbaiki penempatan `Fluid` dan tambahkan `--breakpoint-*` eksplisit. Jika proyek Anda baru, lebih sederhana pakai `768 / 1024 / 1280`.

### Motion ↻

| Token | Value |
|---|---|
| `--duration-fast` | 120ms |
| `--duration-base` | 200ms |
| `--duration-slow` | 320ms |
| `--easing` | `cubic-bezier(.2,.8,.2,1)` |
| `--banner-delay` | 4s (dari Countdown/Banner Gradient sumber) |

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
```

---

## Components

Singkatan: **Container / Icon / Text / Dimension / State / Behavior**. Komponen native-app (Bottom Sheet, Navigation Bar Bottom, Coachmark, Countdown) ditandai ↻ dan disarankan **tidak** dipakai di web — gunakan Modal / Sidebar / Tooltip / Timer text.

### Button
Fill `--color-action` (primary) atau transparent + 1px `--color-n200` (secondary/ghost). Radius 8px, width `full | hug`, padding `10px 20px` ↻. Text `--text-body` weight 700, `--text-invert` / `--text-activity` / `--text-alert` / `--text-high` / `--text-disabled`. Icon opsional 20×20. States: default · hover (`--color-action-hover`) · active · focus-visible · disabled (`--color-n200` + `--text-disabled`) · loading. Truncation `end`, align-center.

### Textfield
Surface `--color-n0` (default) / `--color-n50` (read-only), border 1px `--color-control-border`, radius 8px, height 52px fixed. Outline per state: `--color-control-border` (unfilled/filled/read-only), `--color-danger-fill` (error), `--color-action` (focus/typing). Placeholder `--text-caption` `--text-low`; input `--text-body-sm` `--text-high`; helper `--text-caption` tanpa max-line. Icon 20×20. **Wajib** ada `<label>` terkait dan `aria-describedby` untuk helper/error, plus `aria-invalid` saat error ↻.

### Checkbox
Container 20×20 ↻, radius 4px, outline `1px inside`. States: unselected (`N0` + `N400`) · selected (`--color-action`) · error (`N0` + `--color-danger-fill`) · indeterminate (`--color-action`) · read-only (`--color-n100` + `N400`) · disabled. Gunakan input asli + `accent-color: var(--color-action)` ↻.

### Chips / Badge / Label / Tabs
- **Chips:** height 32px, radius 4px, `--text-body-sm`; container `N0 / --color-action-soft / --color-n100`; outline `N200 / --color-action / none / --color-danger-fill`. Max 1 baris di desain, **tanpa clamp di kode** ↻; ikon kiri/kanan opsional.
- **Badge:** height 18px, `--radius-full`, fill `--color-danger-text` / `--color-success-fill` / gradient; outline 2px `--color-n0` hanya untuk solid; shimmer opsional (mati saat reduced-motion).
- **Label:** height hug, radius 4px, `--text-caption` (medium) / `--text-annotation` (small) ↻, disabled → `--color-n100` + alpha 30%.
- **Tabs:** height 52px, container transparan, indicator 3px `--color-action` (light) / `--color-n0` (dark), divider 1px, `--text-body-sm` weight 700, truncation `end`. Tambah `role="tablist"` + keyboard arrow ↻.

### Banner / Tooltip / Accordion
- **Banner info:** surface `--color-n0`, radius 8px, `--shadow-1`, min-height 96px (ada title) / 72px (tanpa), super-graphic 96×93, close icon 16×16.
- **Banner notification:** full-width, `--color-action-soft` (general) / `--color-danger-soft` (alert) / `--color-warning-soft` (warning) / `--color-success-soft` (success), radius 8px (sectional) / 0 (full), body max 2 baris, ikon 24×24.
- **Banner gradient:** `linear-gradient(135deg, …)` dari token gradient, height 48px (small) atau hug + padding 12/28px (big rounded), teks `--text-invert`, delay 4s.
- **Tooltip:** surface `--color-n800`, max-width 280px, radius 8px, `--text-caption`, `--text-invert`, pointer 4 arah, default top-center.
- **Accordion:** card `--color-n0`, radius 8px, full-width, content bebas, chevron 20×20. Tambah `aria-expanded` ↻.

### Komponen yang dihapus / diganti ↻

| Sumber | Pengganti web |
|---|---|
| Bottom Sheet | Modal / Dialog / Drawer |
| Navigation Bar Bottom | Top nav / Sidebar |
| Coachmark | Tooltip + onboarding popover |
| Countdown | Timer text (tanpa UI native) |
| `tds_ic_*` | Set ikon berlisensi (Lucide / Phosphor) |
| Banner tier gradient | Dihapus (aset loyalty) |

---

## Surfaces

| Level | Name | Value | Purpose |
|---|---|---|---|
| 1 | Canvas | `#ffffff` | Page background |
| 2 | Card | `#ffffff` | Cards — dipisahkan oleh `--shadow-1` atau border `--color-n200` |
| 3 | Soft panel | `#f4f7fe` | Disabled / read-only / panel sekunder |
| 4 | Dark | `#171918` | Tooltip, dark mode surface |

## Accessibility ↻

- Semua pasangan teks/fill di §Semantic alias ≥ **4.5:1** (WCAG AA). Ikon bermakna ≥ **3:1**.
- Focus ring: `:focus-visible { outline: 3px solid var(--color-action); outline-offset: 2px }`.
- Target area minimum 44×44px untuk kontrol sentuh.
- Form: label terkait, `aria-invalid`, `aria-describedby`, pesan error dalam teks (bukan hanya warna outline).
- Modal/dialog: focus trap, `Escape` untuk tutup, `aria-modal="true"`.
- `prefers-reduced-motion` wajib.

---

## Agent Prompt Guide

```
Quick Color Reference:
- background: #ffffff        - text: #303135       - muted: #71747d
- border: #d8dce8            - accent: #0064d2     - on-accent: #ffffff
- danger: #c4382f            - success: #0a7a3b
```

**Example Component Prompts**

1. Buat hero section: background `#ffffff`, max-width 1200px, padding section 96px. Headline 56px weight 700 line-height 1.11 `#303135`, letter-spacing -0.01em. Subtext 18px weight 400 `#71747d`. Satu CTA biru `#0064d2` dengan teks putih, radius 8px, padding 10px 20px; secondary ghost outline `#d8dce8`.
2. Buat primary button: fill `#0064d2`, text `#ffffff`, 16px weight 700, radius 8px, padding 10px 20px. Hover `#0534c1`. Focus-visible outline 3px `#0064d2` offset 2px. Disabled: `#d8dce8` + `#aeb2be`.
3. Buat textfield: 52px height, radius 8px, border 1px `#d8dce8`, label di atas, placeholder 12px `#71747d`, input 14px `#303135`. State error: border `#f15c59` **dan** teks helper `#c4382f` + `aria-invalid="true"`.
4. Buat status banner: background `#e7f2ff` (info) / `#ffdfdf` (alert) / `#fef8d0` (warning) / `#e2fbed` (success), radius 8px, ikon 24×24 kiri, judul 18px weight 700, body 12px max 2 baris, action link `#0064d2`.
5. Buat card: `#ffffff`, radius 16px, padding 24px, shadow `0 2px 8px 0 rgba(48,49,53,.16)`. Jangan pakai shadow pada kartu di dalam grid — shadow hanya untuk kartu yang benar-benar melayang.
6. Buat chip: height 32px, radius 4px, background `#e7f2ff`, border 1px `#0064d2`, text 14px weight 700 `#0064d2`, ikon kiri 16×16. Tanpa `line-clamp`.

---

## Quick Start

### CSS Custom Properties

```css
:root {
  /* Neutrals */
  --color-n0: #ffffff;   --color-n50: #fbfcff;  --color-n100: #f4f7fe;
  --color-n200: #d8dce8; --color-n400: #aeb2be; --color-n600: #71747d;
  --color-n700: #4d4f56; --color-n800: #303135; --color-dark: #171918;

  /* Brand & status */
  --color-action: #0064d2;        --color-action-hover: #0534c1;
  --color-action-soft: #e7f2ff;   --color-action-subtle: #a3cfff;
  --color-action-light: #5baaff;
  --color-danger-text: #c4382f;   --color-danger-fill: #f15c59;
  --color-danger-soft: #ffdfdf;
  --color-success-text: #0a7a3b;  --color-success-fill: #0bae54;
  --color-success-soft: #e2fbed;  --color-warning-soft: #fef8d0;
  --color-analytic-text: #8a4f00; --color-analytic-icon: #a85c00;
  --color-usp-text: #0b7a6b;

  /* Semantic text/icon */
  --text-high: var(--color-n800);       --text-low: var(--color-n600);
  --text-disabled: var(--color-n400);   --text-activity: var(--color-action);
  --text-alert: var(--color-danger-text); --text-positive: var(--color-success-text);
  --text-analytic: var(--color-analytic-text); --text-usp: var(--color-usp-text);
  --text-invert: var(--color-n0);
  --icon-high: var(--color-n700);       --icon-low: var(--color-n400);
  --icon-activity: var(--color-action); --icon-alert: var(--color-danger-fill);
  --icon-positive: var(--color-success-fill);

  /* Fonts */
  --font-sans: 'Inter', ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --weight-regular: 400; --weight-semibold: 600; --weight-bold: 700;

  /* Type scale (unitless leading) */
  --text-display: 3.5rem;    --leading-display: 1.11;
  --text-h1: 2.375rem;       --leading-h1: 1.16;
  --text-h2: 1.75rem;        --leading-h2: 1.21;
  --text-h3: 1.125rem;       --leading-h3: 1.33;
  --text-body: 1rem;         --leading-body: 1.38;
  --text-body-sm: .875rem;   --leading-body-sm: 1.43;
  --text-caption: .75rem;    --leading-caption: 1.33;
  --text-annotation: .625rem;--leading-annotation: 1.40;
  --tracking-heading: -0.01em; --tracking-body: 0; --tracking-mono: 0.03em;

  /* Spacing (base 8) */
  --space-0: 4px;  --space-1: 8px;   --space-2: 12px;  --space-3: 16px;
  --space-4: 24px; --space-5: 32px;  --space-6: 48px;  --space-7: 64px;
  --space-8: 96px; --space-9: 128px;

  /* Radius */
  --radius-none: 0; --radius-sm: 4px; --radius-md: 8px;
  --radius-lg: 16px; --radius-full: 999px;

  /* Elevation + z-index */
  --shadow-0: none;
  --shadow-1: 0 2px 8px 0 rgba(48, 49, 53, .16);
  --shadow-2: 0 4px 12px 0 rgba(48, 49, 53, .20);
  --z-base: 0; --z-raised: 10; --z-sticky: 20; --z-nav: 30;
  --z-overlay: 40; --z-modal: 50; --z-toast: 60;

  /* Gradient stops (contoh: violet; pola sama untuk token gradient lain) */
  --grad-violet-from: #18dc9b;   --grad-violet-to: #6e54ef;
  --grad-green-from: #01cf6c;    --grad-green-to: #02cd9c;
  --grad-orange-from: #ff7a00;   --grad-orange-to: #ff3e65;
  --grad-blue-from: #007bff;     --grad-blue-to: #00c1eb;

  /* Layout */
  --page-max-width: 1200px;
  --section-gap: 96px; --card-padding: 24px; --element-gap: 16px;

  /* Motion */
  --duration-fast: 120ms; --duration-base: 200ms; --duration-slow: 320ms;
  --easing: cubic-bezier(.2, .8, .2, 1);
  --banner-delay: 4s;
}

:focus-visible { outline: 3px solid var(--color-action); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    transition-duration: .01ms !important;
    scroll-behavior: auto !important;
  }
}
```

### Tailwind v4

```css
@theme {
  --color-canvas: #ffffff;      --color-ink: #303135;
  --color-muted: #71747d;       --color-border: #d8dce8;
  --color-action: #0064d2;      --color-action-hover: #0534c1;
  --color-action-soft: #e7f2ff;
  --color-danger: #c4382f;      --color-danger-soft: #ffdfdf;
  --color-success: #0a7a3b;     --color-success-soft: #e2fbed;
  --color-warning-soft: #fef8d0;

  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;

  --text-display: 3.5rem;   --text-display--line-height: 1.11;
  --text-h1: 2.375rem;      --text-h1--line-height: 1.16;
  --text-h2: 1.75rem;       --text-h2--line-height: 1.21;
  --text-h3: 1.125rem;      --text-h3--line-height: 1.33;
  --text-body: 1rem;        --text-body--line-height: 1.38;
  --text-body-sm: .875rem;  --text-body-sm--line-height: 1.43;
  --text-caption: .75rem;   --text-caption--line-height: 1.33;

  --spacing-1: 8px;  --spacing-2: 12px; --spacing-3: 16px;
  --spacing-4: 24px; --spacing-5: 32px; --spacing-6: 48px;
  --spacing-7: 64px; --spacing-8: 96px; --spacing-9: 128px;

  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 16px; --radius-full: 999px;
  --shadow-raised: 0 2px 8px 0 rgba(48, 49, 53, .16);
  --shadow-overlay: 0 4px 12px 0 rgba(48, 49, 53, .20);
}
```

---

## Delta dari sumber

| # | Sumber (`tiket.design/system`) | `DESIGN.md` ini | Alasan |
|---|---|---|---|
| 1 | Font `Tiket Odyssey Text` (TTF proprietary) — tidak ada di file ekstraksi | `Inter` + `JetBrains Mono` (OFL) | Tidak ada lisensi web-font |
| 2 | Line-height `px` (38/32, 62/56, …) | Rasio unitless | Aman saat zoom / root font-size berubah |
| 3 | `B400 #007CFF` (3.94:1) untuk fill + teks | `#0064D2` (5.59:1) | WCAG AA, untuk teks link **dan** teks putih di CTA |
| 4 | `R400 #F15C59` teks (3.27:1), `G500 #0BAE54` teks (2.92:1) | Teks `#C4382F` / `#0A7A3B`; fill lama tetap | Pemisahan peran fill vs teks |
| 5 | `O400 / O500 / T500` tanpa HEX | `#A85C00 / #8A4F00 / #0B7A6B` | Token bolong; nilai baru didefinisikan & diuji kontras |
| 6 | `N50, R200, R500` dipakai komponen, tak didokumentasikan | `N50 #FBFCFF`, `R200 #F9A9A7`, `R500 #C4382F` | Implementasi tidak boleh undefined |
| 7 | 2 skala tipografi (Mobile + Website) | 1 skala (Website) | Web tidak butuh skala native app |
| 8 | `Extra Small 10px` = "Paragraph" | 10px = annotation only; body min 16px | Keterbacaan web |
| 9 | Elevation 02 punya varian Android `#000000` | Dihapus | Tidak relevan di web |
| 10 | "z-index" disebut, angka tidak ada | Skala `--z-*` | Implementable |
| 11 | Breakpoint desktop mulai 840px, `Fluid` bergeser | Direkonsiliasi + token `--breakpoint-*` | Tabel sumber ambigu |
| 12 | Radius lepas 4/6/8/16/999/0 per komponen | 5 tier bernama | Konsistensi; 6px disatukan ke 8px |
| 13 | Gradient: 2 HEX stop tanpa arah | `linear-gradient(135deg, …)` | Bisa langsung dipakai CSS |
| 14 | Tier gradient (loyalty) + `tds_ic_*` | Dihapus / diganti | Aset proprietary |
| 15 | Bottom Sheet, Nav Bottom, Coachmark, Countdown | Diganti Modal/Sidebar/Tooltip/Timer | Pola native app |
| 16 | State "Focused" hanya di Textfield | `:focus-visible` universal + a11y form/modal | Sumber tidak punya focus ring keyboard |
| 17 | Shimmer & rotasi banner 4s | + `prefers-reduced-motion` | Aksesibilitas |
| 18 | Aturan PDP/SRP, Vertical Exposure, "cap 20 char" | Dihapus | Keputusan produk internal tiket.com |

## Sumber

- Sistem asli: `https://tiket.design/system` (+ `sitemap.xml`, 27 halaman, `searchIndex-*.json`), diekstrak ke `passport-design-system.md`.
- Format: Refero Style Reference — `https://styles.refero.design/style/5fd3b3b4-02ab-456a-87aa-e4395636b671`.
- Semua rasio kontras di file ini dihitung dengan rumus luminansi relatif WCAG 2.x terhadap `#ffffff`; verifikasi terakhir: seluruh token teks ≥ 4.5:1.
