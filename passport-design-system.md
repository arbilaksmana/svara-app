# Passport — tiket.design Design System

> Extracted from `https://tiket.design/system` on 2026-11-17.
> Source: the Framer site's `sitemap.xml` (27 pages under `/system`), its `searchIndex-*.json` (all published text), raw HTML where table order mattered, and the elevation diagram PNGs (shadow values are images, not text).
> Situs: **Passport — Design system from product design team in tiket.com**. Kontak: `design@tiket.com`. © Passport tiketdesign 2024.

**Tagline:** "Accelerating designers' and developers' workflow for a seamless and impactful user experience across all interfaces."

Struktur puncak `/system` membagi menjadi 3 bagian:

| Bagian | Isi | Status |
|---|---|---|
| **Components** | Building blocks: tiap komponen memenuhi satu kebutuhan interaksi/UI, dirancang untuk saling membentuk pola | Published (19 halaman) |
| **Foundations** | Elemen dasar: konsistensi, usability, efektivitas lintas platform | Published (7 halaman) |
| **Design Technique** | "The optimal approach for aligning on a visual direction and scaling it across the entire development team." | **Coming soon** |

---

# 1. Foundations (Design System Foundation)

Overview: *"Foundation elements provide the essential building blocks for creating cohesive and visually appealing design across platforms, ensuring consistency, usability, and efficiency."*

Empat pilar: **Color · Typography · Spacing · Elevation**.

## 1.1 Color

> *"We use colors purposefully to communicate how things function in the interface, how they relate to other elements, and their level of prominence."*
> *"Technically we have 81 color palettes for many purposes. But with regards to TDS component usages, we only use 14 palettes."*

Dua kategori: **Solid color** dan **Gradient color**.

### 1.1.1 Solid color — palet yang dipublikasikan

**Neutral**

| Token | HEX | RGB |
|---|---|---|
| N800 | `#303135` | 48, 49, 53 |
| N700 | `#4D4F56` | 77, 79, 86 |
| N600 | `#71747D` | 113, 116, 125 |
| N400 | `#AEB2BE` | 174, 178, 190 |
| N200 | `#D8DCE8` | 216, 220, 232 |
| N100 | `#F4F7FE` | 244, 247, 254 |
| N0 | `#FFFFFF` | 255, 255, 255 |

**Brand Blue** — *"Blue is primary Interactive color. You'll find blue in primary buttons, tabs, file uploader, and chips."*

| Token | HEX | RGB |
|---|---|---|
| B400 | `#007CFF` | 0, 124, 255 |
| B300 | `#5BAAFF` | 91, 170, 255 |
| B200 | `#A3CFFF` | 163, 207, 255 |
| B100 | `#E7F2FF` | 231, 242, 255 |

**Green**

| Token | HEX | RGB |
|---|---|---|
| G500 | `#0BAE54` | 11, 174, 84 |
| G100 | `#E2FBED` | 226, 251, 237 |

**Yellow**

| Token | HEX | RGB |
|---|---|---|
| Y100 | `#FEF8D0` | 254, 248, 208 |

**Red**

| Token | HEX | RGB |
|---|---|---|
| R400 | `#F15C59` | 241, 92, 89 |
| R100 | `#FFDFDF` | 255, 223, 223 |

Token solid lain yang **direferensikan di halaman komponen** (tidak ditampilkan sebagai swatch di halaman Color): `N50`, `N200`, `R200`, `R500`, `O400`, `O500`, `T500`.
> ⚠️ Nilai HEX untuk `O400` / `O500` / `T500` **tidak dipublikasikan sebagai teks** — hanya ada sebagai swatch gambar di tabel alias. Tidak ditebak di sini.

### 1.1.2 Icon color alias

| Visual | Token | Value |
|---|---|---|
| High Emphasis Icon | `IconHighEmphasis` | `N700` |
| Low Emphasis Icon | `IconLowEmphasis` | `N400` |
| Disabled Icon | `IconDisabled` | `N200` |
| Activity Icon | `IconActivity` | `B400` |
| Alert Icon | `IconAlert` | `R400` |
| Analytic Icon | `IconAnalytic` | `O400` |
| Positive Icon | `IconPositive` | `G500` |
| Unique Selling Point Icon | `IconUniqueSellingPoint` | `T500` |
| Invert Icon | `IconInvert` | `N0` |

### 1.1.3 Text color alias

| Visual | Token | Value |
|---|---|---|
| High Emphasis Text | `TextHighEmphasis` | `N800` |
| Low Emphasis Text | `TextLowEmphasis` | `N600` |
| Disabled Text | `TextDisabled` | `N400` |
| Activity Text | `TextActivity` | `B400` |
| Alert Text | `TextAlert` | `R400` |
| Analytic Text | `TextAnalytic` | `O500` |
| Positive Text | `TextPositive` | `G500` |
| USP Text | `TextUniquesSellingPoint` | `T500` |
| Invert Text | `TextInvert` | `N0` |

### 1.1.4 Gradient color — Color palletes

Tiap gradient punya 2 stop (100 → 200).

| Gradient | Token 100 | HEX 100 | Token 200 | HEX 200 |
|---|---|---|---|---|
| Gradient Green | `GG100` | `#01CF6C` | `GG200` | `#02CD9C` |
| Gradient Violet | `GV100` | `#18DC9B` | `GV200` | `#6E54EF` |
| Gradient Orange | `GO100` | `#FF7A00` | `GO200` | `#FF3E65` |
| Gradient Red | `GR100` | `#FF4062` | `GR200` | `#FF00B8` |
| Gradient Tosca | `GT100` | `#00CC9B` | `GT200` | `#017CFF` |
| Gradient Blue | `GB100` | `#007BFF` | `B200` ⚠️ | `#00C1EB` |
| Gradient Purple | `GP100` | `#FA00B4` | `GP200` | `#7600D2` |
| Gradient Light Blue | `GL100` | `#E7F2FF` | `GL200` | `#D9EAFE` |

> ⚠️ Stop kedua Gradient Blue diberi label `B200` di sumber (bukan `GB200`) — kemungkinan typo; nilai `#00C1EB` tetap sesuai baris tersebut.

### 1.1.5 Gradient color — Tier gradient

| Gradient | Token 100 | HEX 100 | Token 200 | HEX 200 |
|---|---|---|---|---|
| Gradient Silver | `GTS100` | `#47506F` | `GTS200` | `#CBD6EC` |
| Gradient Gold | `GTGO100` | `#614500` | `GTGO200` | `#EBBF4F` |
| Gradient Platinum | `GTP100` | `#0F0F0F` | `GTP200` | `#838990` |
| Gradient Diamond | `GTD100` | `#000208` | `GTD200` | `#1258C9` |

---

## 1.2 Typography

> *"Typography can help create clear logical hierarchies, organize information to ensures that elements in the UI are clear and easily recognizable when scanning the page."*

**Allowed weight:** Regular `400` · SemiBold `600` · Bold `700`.

Ada dua skala: **Mobile typography** dan **Website typography**.

### 1.2.1 Mobile type scale

| Style | Size | Weight | Line height | Use for |
|---|---|---|---|---|
| Heading 1 | 32px | 700 | 38px | Oversized screen title, use only once per page |
| Heading 2 | 22px | 700 | 28px | Main titles, use only once per page |
| Heading 3 | 18px | 700 | 24px | Section Title / Heading up a group of list items |
| Body 1 | 16px | 700 / 400 | 22px | Large Button, Link, Sub heading |
| Body 2 | 14px | 700 / 400 | 20px | Small Button, Link, Body copy, textfield |
| Body 3 | 12px | 700 / 400 | 16px | Caption, Helper, label on textfield |
| Small | 10px | 600 | 14px | Label only |

### 1.2.2 Website type scale

| Style | Size | Weight | Line height | Use for |
|---|---|---|---|---|
| Heading 1 | 56px | 700 | 62px | Banner title |
| Heading 2 | 38px | 700 | 44px | Oversized screen title, use only once per page |
| Heading 3 | 28px | 700 | 34px | Main titles, use only once per page |
| Body 1 | 18px | 700 / 400 | 24px | Large Button, Link, Sub heading |
| Body 2 | 16px | 700 / 400 | 22px | Small Button, Link, Body copy, textfield |
| Body 3 | 14px | 700 / 400 | 20px | Caption, Helper, label on textfield |
| Small | 12px | 600 | 16px | Label only |
| Extra Small | 10px | 700 / 400 | 14px | Paragraph |

### 1.2.3 Responsive breakpoint (Website)

> *"These breakpoints describe column and width specifications for different screen size."*
> Kolom: **Screen size · Margin · Container · Column · Gutter**.

| Group | Name | Range | Margin | Container | Column | Gutter |
|---|---|---|---|---|---|---|
| **Mobile (320–839)** | XSmall | 320–399 | 20 | Fluid | 12 | 8 |
| | Small | 400–599 | 20 | Fluid | 12 | 12 |
| | Medium | 600–839 | 40 | Fluid | 12 | 16 |
| **Desktop (840–1440+)** | Large | 840–959 | Fluid | 760 | 12 | 16 |
| | XLarge | 960–1279 | 100 | Fluid | 12 | 16 |
| | XXLarge | 1280–1439 | 120 | Fluid | 12 | 20 |
| | XXXLarge | 1440+ | Fluid | 1200 | 12 | 24 |

---

## 1.3 Spacing Layout

> *"Spacing help designers deliver effective and valuable layouts. Even more, it gives the page a harmonic look. It decides you want them to pay attention to what."*
> *"Layout scale is used for arranging components and other UI parts into a full page layout. It has larger increments that are used to control the density of a design."*

### 1.3.1 Layout scale

| Token | Name | px |
|---|---|---|
| Small | `x` | 8 |
| Medium | `1.5 x` | 12 |
| Large | `2 x` | 16 |
| X-Large | `3 x` | 24 |
| X-Large | `4 x` | 32 |
| X-Large | `6 x` | 48 |
| X-Large | `8 x` | 64 |
| X-Large | `12 x` | 96 |
| X-Large | `16 x` | 128 |

> Sumber mengulang label `X-Large` untuk `3x`–`16x` (sel merged / diwariskan). Basis `x = 8px`.

### 1.3.2 Implementation example

| Konteks | Spacing | Alasan |
|---|---|---|
| Product detail page (PDP) | **well spacing 16–20px** | user's intention is for exploration |
| Search result page (SRP) | **compact spacing 8–12px** | user's intention is to choose the product |
| Landing page | kombinasi compact 8–12px **+** well 16–20px | — |

---

## 1.4 Elevation

> *"Shadows help to define the various levels of elevation (z-index) in tiket.com product's environment."*

Tiga level: **00 / 01 / 02**. Sub-bab: **Layers · Overlaps · Stacks**.
Nilai shadow di bawah **di-decode dari diagram PNG resmi** (`#303135` = N800); CSS `box-shadow` di halaman mengonfirmasi level 01: `0 2px 8px 0 rgba(48,49,53,0.16)`.

| Level | Peran | Shadow color | X | Y | Blur | Alpha | CSS |
|---|---|---|---|---|---|---|---|
| **00** | Background (Background Level) | `#303135` | 0 | 0 | 0 | 100 | no shadow |
| **01** | Cards default | `#303135` | 0 | 2 | 8 | 16 | `0 2px 8px 0 rgba(48,49,53,0.16)` |
| **02** (iOS & Website) | Button & Card Raised (On Hover) | `#303135` | 0 | 4 | 12 | 20 | `0 4px 12px 0 rgba(48,49,53,0.20)` |
| **02** (Android) | Button & Card Raised (On Hover) | `#000000` | 0 | 4 | 12 | 18 | `0 4px 12px 0 rgba(0,0,0,0.18)` |

> *"*this is an exception because of Android native limitation"* — level 02 Android memakai `#000000` alpha 18, bukan `#303135` alpha 20.

**Usage per level**

- **00 — Usage:** Background.
- **01 — Usage:** Card · App menu bar (scrolled state) · Navigation menu bar y+ to y- · Snackbar · Notification Badge · Sticky button.
- **02 — Usage:** Dropdown menu · Button raised (on hover) · Card raised (on hold) · Pop Over · Floating action button (FAB) · Drawer · Bottom sheet · Modals · Dialogs.

**Layers / Overlaps / Stacks** (diagram konseptual): 00 = Background Level, 01 = Cards default, 02 = Button & Card Raised (On Hover); stack/overlap menunjukkan urutan z-index menaik 00 → 01 → 02.

> Token `elevation-01` dipakai komponen Bottomsheet, Banner Info & Notification (info), dan Navigation Bar Bottom.

---

# 2. Components

> *"Components are the reusable building blocks of our design system. Each component meets a specific interaction or UI need, and has been specifically created to work together to create patterns and intuitive user experiences."*

## 2.1 Daftar komponen (Overview)

| # | Komponen | Deskripsi |
|---|---|---|
| 1 | Accordion | Allows content to expand and collapse, optimizing space and enhancing navigation efficiency. |
| 2 | Badge | A visual cue to alerts users to new or updated items with numeric, alphabetic, or dots. |
| 3 | Button | Used as triggers for actions. Used in forms, toolbars, dialog footers and as stand-alone action triggers. |
| 4 | Bottom Sheet | Surfaces containing supplementary content anchored to the screen's bottom. |
| 5 | Banner - Gradients | Banners with gradual transition of colors to create depth and visual interest. |
| 6 | Banner - Info & Notif | Convey important info or notifications at the top of the page to ensure visibility. |
| 7 | Checkbox | Allows a user to select zero, one, or more options from a set of choices. |
| 8 | Coachmark | Temporary messages that educate users through new or unfamiliar product experiences. |
| 9 | Countdown | A visual cue indicating the duration of time. |
| 10 | Chips | Allow users to make single & multiple selections, filter content, or trigger actions. |
| 11 | Label | Used to inform users of the status of an object or of an action that's been taken. |
| 12 | Navigation bottom | Allow movement between primary destinations in an app. |
| 13 | Tabs | For navigate between different, but related content. Commonly used on tool landing pages and on item detail pages. |
| 14 | Textfields | Enable user to interact with and input content and data. Long and short form entries. |
| 15 | Tooltip | Small in-app messages attached to a specific element or alert about new updates during app usage. |

*"more components coming up, stay tuned!"* — nav masih menyisipkan placeholder.

> Halaman detail juga memuat varian yang tidak masuk nav: **Banner Gradient** = `smallsingle` / `bigrounded` / `bigrectangle`; **Banner Info & Notification** = `info` / `notification`. Total 18 halaman detail + 1 overview.

## 2.2 Spesifikasi per komponen

Format tiap halaman: **Variants/States · Anatomy · Properties (Container / Icon / Text / dll.) · Dimension · Tap area / Content area / Behavior / Implementation**.

### Accordion
- **Card:** color `N0`, width `full-width`, height `hug`, radius `8px`.
- **Dynamic Header:** unremovable. **Right Icon:** unchangeable, `icon HE`, `tds_ic_chevron`, source TDS Asset / URL.
- **Dynamic content:** *"can put any component"* (exposed).

### Badges
- **Container:** color `R500` / `G500` / `GR100` / `GG100` / `N400` (predefined by variants & states); width `hug`; height `fixed 18px`; radius `999px`.
- **Outline:** `N0`, solid color → `2px outline`; gradient color → **no outline**.
- **Animation shimmer:** ON/OFF (dapat di-set oleh vertical).
- **Badge text:** typography `small` (contoh: *New, Baru, Hot*), `text invert`, align-center, truncation none, no max line (*"capped to use short text by copywriters, code-wise show all text"*).

### Button
- **Container:** color `B400` / `B300` / `B200` / `B100` / `R200` / `R100` / `N200` / `N0` / `transparent` (predefined by variants); width `full-width` / `hug`; radius `8px` & `6px`.
- **Icon:** removable, changeable; `icon invert` / `icon activity` / `icon alert` / `icon HE`; size *follow variants*; source TDS asset.
- **Button Text:** `text invert` / `text activity` / `text alert` / `text HE` / `text disabled`; typography `body 1 - bold` / `body 2 - bold` / `body 3 - bold`; truncation `end`; align-center.

### Bottomsheet
- **Container:** color `N0`, width `full-width`, radius `16px` top (top right & left) / `0px` bottom, `elevation-01`.
- **Title:** removable/changeable. Initial state typography `heading 2`, `text HE`, no truncation, no max line. **Scrolling State** `heading 3`, truncation `end`, `max 1 line`.
- **Close Action:** `icon HE`, source TDS assets. **Handle**, **Link Action** (`body 1 - bold`, `text activity`). **Icon action (1 & 2):** `16x16`, `tds_ic_share_android`. **Image:** TDS Image (exposed).
- **Behavior / Visibility Control:** muncul saat dipicu aksi user (tap button/icon). Dismiss dengan: tapping a button within the bottom sheet · tapping the blanket · swiping the header down · close affordance di top bar.

### Banner Gradient — Small single
- **Container:** color `gradient violet` (default) / all solid color token / all gradient color token (predefined by variants); radius `8px` top (top right & left) / `0px` bottom; width `full-width` (dynamic, follow screen size); height `fixed 48px`.
- **Delay time:** `4 sec` (exposed; vertical dapat menyesuaikan untuk semua banner dengan delay sama).
- **Left icon:** changeable, `icon invert` (default) / all icon color token; size `24x24` (default) / `20x20` / `16x16`; source app / URL.
- **Text:** `body 3 - regular` / `body 3 - bold`, `text invert` (default) / `text HE` / `text LE` / `text disabled` / `text activity` / `text alert` / `text positive`; align-left; truncation `end`; `max 2 lines`.
- **Timer:** `data type: time`; *"callback function is exposed, so when the timer hit certain time (e.g. 00:00), Vertical can do anything."* Text align-right.
- **Right icon:** unchangeable, `icon HE`, `tds_ic_chevron_right`.

### Banner Gradient — Big rounded single
- **Container:** `gradient violet` default / all solid + gradient tokens; radius `16px` top / `0px` bottom; width `full-width`; height `hug`; **top padding 12px, bottom padding 28px**.
- **Left icon:** `32x32` (default) / `20x20` / `16x16`, `icon invert` default, TDS asset / URL.
- **Text:** `body 3 - regular/bold`, `text invert` default / all text color token, truncation none, no max line (*"capped at 2 lines by Copywriters; code wise no max lines"*).
- **Right icon:** removable, `icon invert`, `tds_ic_chevron_right`. **Page control:** `white` (default) / `blue` — *"Vertical designer will use 1 of this variant and can't combine in between."*

### Banner Gradient — Big rectangle single
- **Container:** `gradient violet` default / all solid + gradient tokens (exposed); width `full-width`; height `hug`; radius `0px`.
- **Left icon:** `32x32` (default) / `24x24` / `20x20`, **support tint ON/OFF**, `icon invert` default.
- **Text:** `body 3 - regular/bold`, `text invert` default / all text color token, truncation none, no max line.
- **Right icon:** removable, `icon HE`, `16x16`, `tds_ic_chevron_right`. **Page control:** `white` (default) / `blue`.

### Banner Info & Notification — Info
- **Container:** color `N0` (default) / all solid color token (exposed); radius `8px`; width `full-width`; height `hug`; **min height 96px (with title) / 72px (without title)**; `elevation-01`; Ripple ON/OFF (*On: has link action; Off: view only*).
- **Title:** removable/changeable, `body 1 - bold`, `text HE` (default) / `text invert`, align-left, no max line. **Close icon:** `icon HE` (default) / `icon invert`, `16x16`, `tds_ic_cross_big`, TDS asset / URL.
- **Super graphic:** position top right, `96x93px`. **Body text:** `body 3 - regular/bold` (combinable). **Text link:** `activity text`. **Illustration:** center.

### Banner Info & Notification — Notification
- **Container:** `B100` (General) / `R100` (Alert) / `Y100` (Warning) / `G100` (Success) — predefined by variants; width `full-width`; height `hug`; radius `8px` (Sectional) / `0px` (Full); Ripple ON/OFF.
- **Title:** removable/changeable, `body 1 - bold`, `text HE` (default) / `text invert`, no max line. **Body text:** `body 3 - regular/bold`, truncation `end`, `max 2 lines` (opsi alternatif: no max line, no truncation). **Action link:** `text activity`, `max 1 line`.
- **Left icon:** `24x24` — `tds_ic_information` / `tds_ic_alert_high` / `tds_ic_warning` / `tds_ic_oval_check` (predefined by variants), `icon activity/alert/warning/positive`. **Close icon:** `16x16`, `tds_ic_cross_big`, `icon HE`, TDS asset / URL.

### Checkbox
- **States:** Unselected · Unselected read-only · Selected · Selected read-only · Error · Indeterminate · Indeterminate read-only.
- **Container color:** `N0` (Unselected, Error) · `N100` (Unselected read-only, Selected read-only, Indeterminate read-only) · `B400` (Selected, Indeterminate).
- **Outline color:** `N400` (Unselected, read-only) · `B400` (Selected) · `R400` (Error) · `B400` (Indeterminate); read-only Indeterminate → `N400`.
- **Outline strokes:** `inside`, `1px`.

### Coachmark (Coach Mark)
- **Container:** color `N0`, width `dynamic`, **max width 280px**, radius `8px`.
- **Illustration:** removable/changeable, source TDS asset / URL, size fixed. **Pointer**.
- **Title text:** `heading 3`, `text HE`, align-left, truncation none, `max 2 lines`, text width fill.
- **Body text:** `body - regular` / `body - bold`, `no max line`.
- **6a. Button:** `primary button - small` · **6b. Text link:** `body 3 - bold`, `B400`.

### Countdown
- **Container:** color `icon alert` (exposed), width `hug`, height `fixed 20px`, radius `4px`.
- **2. Separator:** unchangeable, `body 3 - bold`, `text alert`, align-left, no truncation, no max line.
- **3. Text number:** small, `text invert` (default) / all text color token, align-center, **maximum 2 digit for hour and minute**.
- **4. Text milisecond:** removable.

### Chips
- **Variants:** `general` · `active indicator` (*"All other specs will follow Badge specs"*). **States:** Inactivated · Activated · Disabled · Error, plus **Invert** variants.
- **1. Container:** color `N0` (Inactivated/Error), `B100` (Activated), `N100` (Disabled); Invert: `N0` (Inactivated/Error), `N0 alpha 40%` (Activated). Width `hug`, height `fixed 32px`, radius `4px`.
- **Outline:** `N200` (Inactivated), `B400` (Activated), none (Disabled), `R400` (Error); Invert: none (Inactivated/Error/Disabled), `N200` (Activated).
- **2. Left icon:** removable; `icon LE` (default) / `icon activity` / `icon disabled` / `icon invert`; source TDS asset / URL.
- **Chip text:** `body 2 - regular` / `body 2 - bold` (kombinasi regular+bold diizinkan); `text HE` / `text activity` / `text disabled` / `text invert`; align-left; truncation `none` (default) / `end`; `max 1 line` — *"capped max 20 char by Copywriters, code-wise use no max lines"*.
- **4. Right icon:** mengikuti state yang sama dengan left icon.

### Label
- **Container:** color `N0` (default) / all solid + gradient color token (exposed); `N100` untuk disabled state; width `hug`; radius `4px`.
- **Animation shimmer:** ON/OFF — default OFF, disabled OFF, **product label ON**.
- **Icon:** removable/changeable, all icon color token, `tds_ic_cross_big`; `12x12` (small variants) / `16x16` (medium variants); disabled → icon alpha 30%; source TDS asset / URL.
- **Body text:** `body 3 - regular` (Medium) / `small` (Small), all text color token, disabled → `text disabled`, align-left, no max line (*capped 2 lines by Copywriters*).
- **Variants (countdown):** text `text invert` (default); *"Vertical can choose the countdown to use mili second or without mili second"*; *"Countdown shall not be truncated."*

### Navigation Bar Bottom
- **Container:** color `N0`, width `full`, height `fixed 64px`, radius `0px`, `elevation-01`, Ripple `ON`.
- **Tab text:** changeable, `body 3 - regular`, `text activity` / `text invert`, align-center, truncation none, no max line (*"Will be set to fit the container from UX Writer"*).
- **Icon:** removable, `icon activity` / `icon LE`, size `24x24`, source TDS asset / URL.

### Tabs
- **Variants & states:** Light Mode / Dark Mode; Inactivated / Activated. **Color variants:** red / green (*"All other spec follow badge specs"*).
- **Container:** `none (transparent)`, width `full`, height `fixed 52px`, radius `0px`.
- **Icon:** removable/changeable, `icon LE` / `icon activity` / `icon invert`; Light: Inactivated `LE Icon`, Activated `Activity Icon`; Dark: Inactivated `Invert Icon alpha 40%`, Activated `Invert Icon`. `tds_ic_umbrella`, `20x20`, TDS asset.
- **Tab text:** `body 2 - bold`, `text LE` / `text activity` / `text invert`; Light: `LE Text` → `Activity Text`; Dark: `Invert Text alpha 40%` → `Invert Text`; align-left, truncation `end`, `max 1 line`.
- **Horizontal divider:** `light divider`, `fixed 1px`. **Active indicator:** `B400` (Light) / `N0` (Dark), `fixed 3px` (Top & Right: 3px).

### Textfield
- **States:** Unfilled · Filled · Unfilled Error · Filled Error · Focused · Typing · Unfilled Read-only · Filled Read-only.
- **Container:** color `N0` (Unfilled/Filled/Error/Focused/Typing) / `N50` (Read-only); width `full`; height `52px (fixed)`; radius `8px`.
- **Outline:** `N200` (Unfilled/Filled/Read-only) · `R400` (Unfilled/Filled Error) · `B400` (Focused/Typing).
- **Placeholder text:** removable/changeable, `body 3 - regular`, `text LE`, align-left, truncation none, `max 1 line`.
- **Input text:** `body 2 - regular`, `text HE` / `text alert`, predefined by states, *"If the text is too long will be cut off"*.
- **Helper text:** `body 3`, `no max line` (*"capped at 2 lines by Copywriters; code wise no max lines to ensure no issue with smaller devices"*).
- **Icon:** `icon HE`, `tds_ic_oval_cross`, `20x20`, TDS asset.

### Tooltip
- **Container:** color `N800`, width `dynamic`, **max width 280px**, height `hug`, radius `8px`.
- **Body text:** changeable, `body 3 - regular` / `body 3 - bold`, `text invert`, align-left, truncation none, no max line.
- **TDS pointer:** variant `dark`; direction `left` / `right` / `up` / `down`; position `top-center` (default); *"vertical are free to define (x,y) position as long as it complies to the Pointer placement guideline"*.

---

# 3. Konvensi lintas komponen

- **"Vertical Exposure"** = kolom pada tabel Properties yang menandakan properti boleh diubah oleh tim vertical/product (nilai `exposed`, `changeable`, `removable`, `unremovable`, `unchangeable`, `none`).
- **Source gambar:** `TDS asset` / `URL` / `app` — vertical bebas memilih sumber.
- **Aturan overflow umum:** copywriter membatasi jumlah baris, tetapi **code-wise tidak boleh ada max line** agar aman di perangkat kecil (disebut eksplisit di Textfield, Tooltip, Banner Info/Notif, Label, Banner Gradient, Badges, Bottomsheet, Chips).
- **Ikon TDS yang dipakai:** `tds_ic_chevron`, `tds_ic_chevron_right`, `tds_ic_cross_big`, `tds_ic_oval_cross`, `tds_ic_oval_check`, `tds_ic_information`, `tds_ic_alert_high`, `tds_ic_warning`, `tds_ic_share_android`, `tds_ic_umbrella`.
- **Radius umum:** `4px` (Chips, Label, Countdown), `8px` (Button, Textfield, Accordion, Tooltip, Coachmark, Banner Info), `16px` (Bottomsheet, Banner big-rounded), `999px` (Badge), `0px` (Navigation bottom, Tabs, Banner big-rectangle).
- **Tinggi tetap umum:** `18px` Badge · `20px` Countdown · `32px` Chips · `48px` Banner small · `52px` Tabs & Textfield · `64px` Navigation bottom.

---

# 4. Sumber (per-claim)

| Bagian | URL |
|---|---|
| Landing | `https://tiket.design/system` |
| Sitemap (daftar 27 halaman) | `https://tiket.design/sitemap.xml` |
| Index teks Framer | `https://framerusercontent.com/sites/34PDvybw1RI9ka5kNYRAqB/searchIndex-8F4LrrKNIBQT.json` |
| Foundations overview | `https://tiket.design/system/foundation/overview` |
| Color — solid | `https://tiket.design/system/foundation/color-solid` |
| Color — gradient | `https://tiket.design/system/foundation/color-gradient` |
| Typography — mobile | `https://tiket.design/system/foundation/typography-mobile` |
| Typography — website | `https://tiket.design/system/foundation/typography-website` |
| Spacing | `https://tiket.design/system/foundation/spacing` |
| Elevation (+ diagram PNG) | `https://tiket.design/system/foundation/elevation` |
| Components overview | `https://tiket.design/system/component/overview` |
| Detail komponen | `https://tiket.design/system/component/<slug>` — `accordion`, `badges`, `button`, `bottomsheet`, `bannergradient-smallsingle`, `bannergradient-bigrounded`, `bannergradient-bigrectangle`, `bannerinfo&notif-info`, `bannerinfo&notif-notification`, `checkbox`, `coachmark`, `countdown`, `chips`, `label`, `navigationbar-bottom`, `tabs`, `textfield`, `tooltip` |

## Keterbatasan ekstraksi (tidak ada di sumber sebagai teks)

1. **Nilai HEX `O400`, `O500`, `T500`** (alias Analytic / USP) hanya berupa swatch gambar → tidak diekstrak, sengaja tidak ditebak.
2. **Spesifikasi Elevation** (X/Y/Blur/Alpha, daftar usage, diagram Layers/Overlaps/Stacks) hanya berupa gambar PNG → nilai di atas di-decode manual dari diagram resmi, bukan dari teks HTML.
3. **Visual preview tiap komponen/varian** (screenshot Figma) berupa gambar; yang diekstrak adalah teks spesifikasi, bukan aset visualnya.
4. **Design Technique** masih `Coming soon` — belum ada konten.
