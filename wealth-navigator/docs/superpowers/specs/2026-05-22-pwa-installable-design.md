# PWA Installable — Wealth Studio

**Date:** 2026-05-22  
**Scope:** Add "Add to Home Screen" installability to the existing TanStack Start app.  
**Out of scope:** Offline caching, push notifications, background sync.

## Goal

Allow users to install Wealth Studio as a standalone app on iOS and Android from the browser, without address bar, matching the native app feel.

## Architecture

No new dependencies. Three new static files in `public/` + minor edits to `src/routes/__root.tsx`.

```
public/
  manifest.json        ← Web App Manifest (name, icons, display: standalone)
  sw.js                ← Minimal service worker (required by browsers for install prompt)
  icons/
    icon.svg           ← Single SVG icon: dark square + "W" monogram
```

## Files

### `public/manifest.json`
- `name`: "Wealth Studio"
- `short_name`: "WealthOS"
- `display`: "standalone"
- `start_url`: "/"
- `theme_color`: "#0f172a"
- `background_color`: "#0f172a"
- `icons`: references `icon.svg` at sizes 192 and 512

### `public/sw.js`
Minimal — just `skipWaiting` + `clients.claim()`. No fetch handler, no caching.

### `public/icons/icon.svg`
Dark rounded square (`#0f172a`) with white "W" letter, clean sans-serif. Single file used for all sizes (SVG scales perfectly).

### `src/routes/__root.tsx` changes
In `Route.head()`:
- `links`: add `manifest.json`, `apple-touch-icon`
- `meta`: add `theme-color`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`

In `RootShell`: add inline `<script>` that registers `/sw.js` via `navigator.serviceWorker.register`.

## Compatibility

- Chrome (Android): install banner shown after manifest + SW detected
- Safari (iOS): "Add to Home Screen" works via `apple-mobile-web-app-capable` + `apple-touch-icon`
- Firefox: supported via manifest

## Non-goals

- No workbox, no precaching, no offline fallback page
- No splash screens (iOS generates from icon automatically)
- No push notifications
