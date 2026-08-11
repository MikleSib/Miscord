# Miscord mobile design system

`src/app/styles/mobile-system.css` is the final authority for shared mobile geometry. Feature-specific mobile files may adapt content, but must not redefine these contracts.

## Layout rules

- Phone breakpoint: `max-width: 767px`; compact/tablet layout: `max-width: 1023px`.
- The visual viewport is `--app-visual-height` with a `100dvh` fallback.
- Every edge-attached surface must include `--safe-area-*`.
- Headers use `--mobile-header-height`; controls and touch targets use `--mobile-control-height` and `--mobile-touch-target`.
- Page content uses `--mobile-page-gutter`; dense toolbars use `--mobile-page-gutter-compact`.
- A pane owns one vertical scroll container. Nested horizontal filters may scroll without visible scrollbars.
- Phone dialogs are full-screen. Tablet details may retain constrained content width.

## Interaction rules

- Important controls have at least a 44 by 44 pixel hit target.
- Inputs are 16 pixels on phones to prevent browser zoom.
- Hover is never the only way to reveal an action; touch uses persistent controls and `:active` feedback.
- Back, title, and actions always occupy the same header geometry.
- Bottom composers, voice panels, and docks include the bottom safe area and never cover their scroll content.

## Semantic hooks

Use existing system hooks before adding viewport-specific selectors:

- `.miscord-responsive-modal` / `.miscord-responsive-modal-card`
- `.miscord-settings-*`
- `.forum-channel-*`
- `.thread-panel__*`
- `.notification-inbox__*`
- `.mobile-public-page` / `.mobile-public-card`
- `.developer-portal` / `.developer-portal__header`

New feature surfaces should add a stable semantic root and reuse system tokens. Do not target generated Tailwind class strings or introduce new fixed viewport arithmetic.
