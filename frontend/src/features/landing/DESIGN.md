---
name: Miscord Public Landing
description: A full-bleed Russian evening that makes text, voice, and screen sharing feel like one shared room.
colors:
  community-cobalt: "#5865f2"
  community-cobalt-hover: "#6975f5"
  night-ink: "#090d25"
  evening-field: "#12183d"
  product-panel: "#171b30"
  off-white: "#f7f8ff"
  cobalt-mist: "#c8cdf5"
  focus-lavender: "#aeb5ff"
typography:
  hero-display:
    fontFamily: "Manrope, sans-serif"
    fontSize: "clamp(58px, 6.7vw, 96px)"
    fontWeight: 800
    lineHeight: 0.92
    letterSpacing: "-0.04em"
  section-display:
    fontFamily: "Manrope, sans-serif"
    fontSize: "clamp(54px, 6.2vw, 88px)"
    fontWeight: 800
    lineHeight: 0.92
    letterSpacing: "-0.04em"
  lead:
    fontFamily: "Manrope, sans-serif"
    fontSize: "clamp(17px, 1.4vw, 20px)"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Manrope, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Manrope, sans-serif"
    fontSize: "14px"
    fontWeight: 800
    lineHeight: 1.2
  micro-label:
    fontFamily: "Manrope, sans-serif"
    fontSize: "10px"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "0.11em"
rounded:
  channel: "7px"
  compact: "9px"
  control: "10px"
  soft: "12px"
  stage: "16px"
  pill: "999px"
  avatar: "50%"
spacing:
  tight: "8px"
  compact: "12px"
  content: "18px"
  block: "24px"
  footer: "28px"
  gutter-mobile: "18px"
  gutter-desktop: "36px"
  section-intro: "42px"
  section-major: "64px"
components:
  button-primary:
    backgroundColor: "{colors.community-cobalt}"
    textColor: "{colors.off-white}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 25px"
    height: "52px"
  button-primary-hover:
    backgroundColor: "{colors.community-cobalt-hover}"
    textColor: "{colors.off-white}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 25px"
    height: "52px"
  button-light:
    backgroundColor: "{colors.off-white}"
    textColor: "{colors.night-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "44px"
  voice-room-proof:
    backgroundColor: "rgba(10, 15, 40, 0.82)"
    textColor: "{colors.off-white}"
    rounded: "{rounded.stage}"
    padding: "19px"
    width: "352px"
  living-desktop:
    backgroundColor: "{colors.product-panel}"
    textColor: "{colors.off-white}"
    rounded: "{rounded.stage}"
    height: "clamp(500px, 58vw, 610px)"
---

# Design System: Miscord Public Landing

## Overview

**Creative North Star: "The Shared Evening"**

The public landing is a Persuade surface built as an inhabited evening, not a software catalogue. A full-bleed photograph supplies the first emotional fact: people are already together. Large off-white Russian type states the promise on the left, while a compact translucent voice room on the right proves that the scene belongs to Miscord.

The second act moves from photography into a deep cobalt field and a dense, dark product stage. It shows text, voice, presence, and screen sharing in one composed desktop rather than splitting them into generic feature cards. The product surfaces are synthetic demonstrations and must remain clearly labeled as demos; the design makes no customer, scale, or performance claims.

**Key Characteristics:**

- Full-bleed night photography with directional darkening for readable type.
- Oversized, tightly led Manrope display copy paired with compact product typography.
- One cobalt action color against off-white type and near-black navy fields.
- A floating live-room proof followed by a wide, layered desktop proof.
- Pill actions, softly rounded dark surfaces, and physical but restrained motion.

## Colors

The palette moves from photographic midnight to a cobalt-lit product world. Community Cobalt is the only brand/action accent; Off-white carries the promise, while Night Ink, Evening Field, and Product Panel build depth without leaving the blue family.

### Primary

- **Community Cobalt** (`community-cobalt`): the primary account action, brand marks, selected server, and concentrated screen-sharing proof.
- **Community Cobalt Hover** (`community-cobalt-hover`): the sole brighter interactive variant of the cobalt action.

### Neutral

- **Night Ink** (`night-ink`): the landing canvas and dark text on light actions.
- **Evening Field** (`evening-field`): the full second-section ground behind the product demonstration.
- **Product Panel** (`product-panel`): the compact desktop shell and shared-room surfaces.
- **Off-white** (`off-white`): display type, primary readable content, and light inverse actions.
- **Cobalt Mist** (`cobalt-mist`): supporting copy on the cobalt field.
- **Focus Lavender** (`focus-lavender`): the high-contrast three-pixel keyboard focus outline.

**The One Cobalt Rule.** Cobalt marks brand, primary action, or an active product state; do not introduce a second decorative accent.

**The Night Stays Blue Rule.** Dark surfaces remain navy and cobalt-derived. Neutral black or gray may appear inside the compact product demo, but must not replace the landing's blue atmosphere.

## Typography

**Display Font:** Manrope (sans-serif fallback)
**Body Font:** Manrope (sans-serif fallback)
**Label Font:** Manrope (sans-serif fallback)

**Character:** One family carries both the emotional promise and the product proof. Weight, scale, tracking, and density create the contrast: broad, forceful display lines outside; compact, highly legible labels inside the simulated product.

### Hierarchy

- **Hero Display** (800, `clamp(58px, 6.7vw, 96px)`, 0.92 line-height, `-0.04em` tracking): the two-line first-viewport promise. It becomes 42px at the narrowest breakpoint.
- **Section Display** (800, `clamp(54px, 6.2vw, 88px)`, 0.92 line-height, `-0.04em` tracking): the two-line transition into product proof. It becomes 46px below 520px.
- **Lead** (400, `clamp(17px, 1.4vw, 20px)`, 1.55 line-height): the hero explanation, capped at 570px.
- **Body** (400, 18px, 1.55 line-height): the second-section explanation, capped at 540px; it becomes 16px on mobile.
- **Label** (800, 14px): navigation and pill actions.
- **Micro Label** (800, 10px, `0.11em` tracking, uppercase): explicit demo provenance and compact product grouping.

**The Two-Line Promise Rule.** Keep the hero and section statements short enough to preserve their authored two-line composition; do not turn the landing into a stack of marketing paragraphs.

## Layout

The desktop frame is a centered 1368px maximum container with 36px side gutters. The header uses three columns so the brand, centered navigation, and login action hold independent alignment. The hero is at least the viewport height and never shorter than 720px; its copy begins after a fluid 84–138px vertical pause beneath the header. The live-room proof is anchored to the lower-right edge of the same container.

The product section begins after a fluid 96–158px top interval. Its introduction is a two-sided row—display statement left, explanation and action right—followed by a full-width Living Desktop stage capped at 610px high. The desktop proof uses a 62px server rail, a 224px channel rail, a flexible chat, and a 232px activity rail.

At 1060px the activity rail disappears. At 820px navigation and the floating voice proof disappear, the hero photograph shifts to protect the people, the copy moves into the lower photographic gradient, and all page gutters become 18px. The product introduction stacks, the secondary product action hides, and the desktop proof becomes a deliberately clipped two-column window into channel plus chat. At 520px the primary account action becomes full width and the desktop stage tightens again without removing its product evidence.

The recurring spacing rhythm is 8–12px inside compact UI, 18–24px within content groups, 36px desktop page gutters, 42px between section introduction and proof, and 64px before the footer.

**The Scene Before Chrome Rule.** In the first viewport, protect the people, the promise, and the primary action before preserving secondary navigation or duplicate product controls.

## Elevation & Depth

Depth comes from three sources: photographic overlays, translucent product material, and a small, deliberate shadow vocabulary. The hero uses layered linear gradients to keep type readable without flattening the photograph. The voice room floats with backdrop blur and a deep ambient shadow; the Living Desktop uses a wider, darker stage shadow. The second section adds one blurred cobalt field behind the stage rather than distributing glows across individual elements.

### Shadow Vocabulary

- **Primary Action Lift** (`0 14px 34px rgba(25, 34, 143, 0.3)`): reserved for the cobalt account action; hover expands it to `0 18px 38px rgba(25, 34, 143, 0.36)`.
- **Voice Proof Float** (`0 20px 54px rgba(0, 0, 0, 0.34)`): separates the live room from the photograph.
- **Desktop Stage** (`0 38px 90px rgba(1, 4, 22, 0.38)`): gives the wide product demonstration a single grounded silhouette.

**The One Stage Shadow Rule.** Elevate the whole proof, not every panel inside it. Internal product hierarchy is tonal and bordered.

## Shapes

The marketing actions and status pills use fully rounded geometry, while product surfaces use compact soft corners. The main proof surfaces use a 16px radius; small wells and controls use 9–12px; channel selections use 7px. Avatars are circular and overlap with a dark three-pixel ring in the voice-room proof. Borders are quiet and structural, never ornamental: they divide product rails, frame the scroll cue, and separate avatar stacks.

**The Soft Outside, Compact Inside Rule.** Keep the landing's calls to action pill-shaped and its main proof surfaces softly rounded; reduce radii as the interface becomes denser.

## Components

### Brand Lockup

- **Shape:** a 38px cobalt mark with a 12px radius beside a tightly tracked 22px wordmark. Mobile scales this to 34px/10px; the footer scales it to 32px/10px.
- **Behavior:** the entire lockup is a home link with the mark image decorative and the link carrying the accessible name.

### Primary Account Action

- **Shape:** a 52px-high pill with 25px horizontal padding and a 10px label-to-arrow gap.
- **Color:** Community Cobalt with Off-white type and the Primary Action Lift shadow.
- **Hover / Focus / Active:** fine pointers raise it 2px and use Community Cobalt Hover; activation scales to 0.97; keyboard focus uses the shared Focus Lavender outline. It becomes full width below 520px.

### Light Actions

- **Shape:** the header login is a 44px-high pill with 22px horizontal padding; the product action is 48px high with 21px padding.
- **Color:** Off-white fill with Night Ink text. Hover raises the action 2px and softens the white; activation scales to 0.97.

### Voice Room Proof

- **Material:** an 82%-opaque blue-black panel with 18px blur and 1.2 saturation, a 16px corner radius, 19px padding, and the Voice Proof Float shadow. Reduced-transparency mode replaces it with an opaque navy surface.
- **Content:** an explicit Demo label, live room name and state, four overlapping participant avatars, count copy, and a single microphone/control row.
- **Responsive:** present on desktop as lower-right proof; removed below 820px where the photograph and Living Desktop carry the story.

### Living Desktop

- **Shape:** a wide 16px-radius stage with a 48px top bar and dense internal rails. Its outer height is fluid from 500px to 610px on desktop.
- **Hierarchy:** selected server and streaming preview use cobalt; active channels use a lighter charcoal; presence and connected voice states use green only as product status.
- **Provenance:** the top bar always displays “Демо интерфейса”; synthetic product content must not masquerade as production activity.
- **Responsive:** remove the activity rail at 1060px, remove the server rail at 820px, and preserve a clipped channel-plus-chat view down to 352px.

### Motion

- **Entrance:** the photograph settles over 1400ms; copy enters over 760ms after an 80ms delay; the voice proof follows over 800ms after 170ms. All use the landing's expressive `cubic-bezier(0.16, 1, 0.3, 1)` ease.
- **Scroll reveal:** supporting browsers reveal the Living Desktop with a view-timeline animation from entry 8% to cover 35%.
- **Accessibility:** reduced-motion mode removes all entrance, reveal, and scroll-cue animation and collapses interaction transitions to 0.01ms.

## Do's and Don'ts

### Do:

- **Do** lead with a localized evening photograph, a two-line Russian promise, and one unambiguous account action.
- **Do** prove text, voice, presence, and screen sharing inside the same Living Desktop composition.
- **Do** label every synthetic voice-room or interface representation as a demo.
- **Do** preserve the 3px Focus Lavender outline, semantic landmarks, skip link, and reduced-motion and reduced-transparency behavior.
- **Do** remove secondary chrome at narrow widths while keeping the emotional scene, core message, and registration path intact.

### Don't:

- **Don't** replace the first viewport with a generic SaaS split hero, feature-card grid, metric strip, or invented customer proof.
- **Don't** detach the product UI into multiple floating cards; the compact desktop is one continuous room.
- **Don't** add decorative accent colors outside cobalt; green is reserved for live presence and connected voice state inside product proof.
- **Don't** make every dark surface translucent or shadowed; blur belongs to the live-room overlay and elevation belongs to the two proof silhouettes.
- **Don't** expose synthetic product content without its Demo label or present it as a production-authenticated capture.
