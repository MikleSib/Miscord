---
name: Miscord Developer Bot Settings
description: Dense, flat, dark settings UI for configuring Miscord bots without exposing protocol complexity.
colors:
  canvas: "#1e1f22"
  surface: "#2b2d31"
  surface-raised: "#313238"
  surface-deep: "#111214"
  border-subtle: "#303238"
  border-control: "#4e5058"
  brand: "#5865f2"
  brand-hover: "#4752c4"
  focus-link: "#00a8fc"
  text-strong: "#f2f3f5"
  text-body: "#dbdee1"
  text-muted: "#b5bac1"
  text-quiet: "#8e929b"
  success: "#23a55a"
  success-hover: "#1a8f4b"
  danger: "#f23f42"
  error-text: "#fa777c"
typography:
  page-title:
    fontFamily: "Segoe UI Variable Text, SF Pro Text, Segoe UI, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.25
  section-title:
    fontFamily: "Segoe UI Variable Text, SF Pro Text, Segoe UI, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "Segoe UI Variable Text, SF Pro Text, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: "Segoe UI Variable Text, SF Pro Text, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.25
  metadata:
    fontFamily: "Segoe UI Variable Text, SF Pro Text, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.25
rounded:
  checkbox: "4px"
  control: "5px"
  panel: "6px"
  media: "8px"
  navigation: "12px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  3xl: "32px"
  section: "28px"
  section-major: "56px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.text-strong}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "40px"
  button-save:
    backgroundColor: "{colors.success}"
    textColor: "{colors.text-strong}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "40px"
  input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text-body}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "44px"
  permissions-panel:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-body}"
    rounded: "{rounded.panel}"
    padding: "20px 24px"
---

# Design System: Miscord Developer Bot Settings

## Overview

**Creative North Star: "The Dark Control Surface"**

The Miscord developer settings are a compact operating surface, not a marketing page. They use a flat charcoal hierarchy, restrained borders, short labels, and one Miscord-blue action color so developers can scan configuration quickly and understand state without reading bit operations.

Use **Miscord** for the product, portal, API, applications, and bots. Do not introduce third-party brand names, borrowed terminology, or external identity cues.

**Key characteristics:**

- Dense but readable single-column settings with clear section rhythm.
- Flat tonal layering; borders and spacing do most of the separation work.
- Immediate, explicit control state and a persistent dirty-state save affordance.
- Technical values use monospace; human choices use plain-language labels.

## Colors

Charcoal surfaces carry nearly the whole UI. Miscord blue marks primary actions, selected controls, links, and focus; green is reserved for committing changes; red is reserved for errors and destructive actions.

**The One Accent Rule.** Do not add competing accent hues. A neutral control becomes blue only when it is selected, focused, linked, or primary.

**The Semantic Color Rule.** Never use green as a general brand color or red as decoration; their meaning must remain save/success and danger/error.

## Typography

The UI uses the native Miscord sans stack throughout. Keep weights mostly at 400 and 600; the hierarchy comes from modest scale changes and spacing, not oversized headings. Introductory copy may use 16px/24px; supporting copy stays at 14px/20px; media requirements and validation help use 12px/16px. Permission codes and application suffixes are monospace.

**The Tool, Not Poster Rule.** Keep headings short and compact. Do not introduce display faces, ultra-heavy weights, decorative tracking, or marketing-sized type.

## Layout

The portal has a sticky 56px top bar and a centered workspace capped at 1600px. Desktop uses 48px horizontal and 28px vertical workspace padding; the selected application lives in the header and the bot settings remain one continuous content column. Media rows become a 176px instruction column plus a flexible control column at 1024px and above.

Below 768px, use 16px page padding, move application selection into a full-width surface above the settings, and present applications in a horizontally scrollable row. Stack media instructions over their controls. Permission groups progress from one column to two at 768px and three at 1280px. Header utility actions hide when space is insufficient; core navigation and settings must remain available in the page.

Use the implemented spacing rhythm: 4–8px inside compact controls, 12–16px between related elements, 20–24px for panel padding, about 28px between normal sections, and 56px before major profile media. Reserve 112px of bottom space so the fixed save bar never covers the last setting.

## Elevation & Depth

The system is flat by default. Separate canvas, surfaces, and the permission panel with tonal contrast and 1px borders. Shadows are exceptional: the bot avatar may use a soft media shadow, and viewport overlays may use a dark scrim or subtle blur. Do not turn settings sections into floating cards.

**The Flat-by-Default Rule.** If spacing, a divider, or a tonal step can express hierarchy, do not add a shadow.

## Shapes

Controls are compact and only gently rounded: 4px checkboxes, 5px fields and action buttons, 6px settings panels, and 8px media wells. Navigation items may reach 12px; switches and status chips use pill geometry. Dashed borders belong only to upload and empty-state drop zones.

## Components

### Upload controls

- **Avatar:** a 144px square button with an 8px radius and blue placeholder. Clicking opens the file picker; an existing image receives a dark hover overlay, and its separate delete action uses danger color on hover.
- **Banner:** a responsive well capped at 420×150px with a 2px dashed border and deep-charcoal background. It accepts click, drag/drop, Enter, and Space. Existing media remains visible behind a dark readable action label; deletion stays in the top-right corner and must not reopen the picker.
- Both controls accept PNG, JPEG, GIF, and WEBP. Show the implemented 10 MiB limit and recommended dimensions beside the control, and expose upload progress with text plus a spinner.

### Switches

Each setting is a full row with title and explanation on the left and a 44×24px switch aligned right. Off is neutral gray; on is Miscord blue; the white 18px thumb supplies position feedback. Rows use subtle bottom dividers. Switches must keep `role="switch"`, `aria-checked`, an accessible label, keyboard activation, visible focus, disabled styling, and reduced-motion behavior.

### Permission calculator

Permissions are grouped by task and expressed as semantic 20px checkboxes, never as a raw bit list. Every choice immediately updates the decimal code and invite link state. The decimal field accepts digits only, treats blank as `0`, rejects values above the supported 53-bit mask, rejects unknown bits, marks errors with `aria-invalid`, and shows concise inline error text. Copy actions replace their icon/text with clear temporary confirmation.

**Administrator invariant:** Administrator is bit 3, decimal value `8`. Enabling it replaces the complete mask with `8`; disabling it replaces the mask with `0`. While it is enabled, every other permission is disabled and visually subdued. Pasting any valid value containing Administrator also normalizes the stored/displayed value to `8`. Never preserve or display redundant permissions alongside Administrator.

### Save bar

The save bar is fixed to the viewport bottom and appears only while bot settings are dirty. It uses a translucent canvas surface, top border, subtle backdrop blur, unsaved-change copy on the left, and a green 40px save action on the right. Saving replaces the icon with a spinner; saving and an empty bot name disable the action. Once state is clean, slide the bar completely out of view.

### Accessibility and feedback

Interactive targets should be at least 40px high, with primary form fields at 44px. Use the global 2px Miscord-blue focus outline, native labels, semantic roles, and `role="alert"` for page-level failures. Color may reinforce state but must not be its only indicator: include checked position/icons, disabled affordance, progress text, and validation copy. Honor `prefers-reduced-motion` by removing decorative transitions and animation.

## Do's and Don'ts

### Do:

- **Do** call every product-facing surface, bot, application, API, and portal Miscord.
- **Do** keep configuration copy direct and explain consequences before risky or privileged settings.
- **Do** keep the permission mask synchronized, exact, decimal, and understandable without manual calculation.
- **Do** preserve visible hover, focus, disabled, loading, error, copied, dirty, and saved states.
- **Do** collapse grids and navigation deliberately on mobile while preserving all core actions.

### Don't:

- **Don't** introduce third-party brands, logos, terminology, or look-alike identity details.
- **Don't** add gradients, glossy glass, decorative glows, oversized radii, or card-per-setting layouts to this surface.
- **Don't** use blue, green, or red interchangeably; each color has a stable functional meaning.
- **Don't** leave non-Administrator permissions interactive or encoded alongside Administrator.
- **Don't** hide upload, permission, validation, or save state behind hover alone.
