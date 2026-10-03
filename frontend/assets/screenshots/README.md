# Marketing screenshots

Live captures from the local admin console (demo tenant). SVG wireframes remain for design reference.

## Files

- `admin-overview.webp` (+ `.png`) — dashboard / home
- `time-clock.webp` (+ `.png`) — Time Clock + geofence site
- `compliance.webp` (+ `.png`) — sponsor compliance workspace

## Recapture

Local frontend on `:5173` and API on `:3000`, then:

```bash
cd e2e && npm install && npx playwright install chromium
node ../scripts/capture_marketing_screenshots.mjs
```

Captures at **1440×900** (2× retina). Demo data only — not a customer account.

Do not run `python3 scripts/generate_screenshot_placeholders.py` unless you pass `--force`; that restores the old wireframe placeholders.
