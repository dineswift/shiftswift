# Marketing screenshots

Drop redacted admin captures here (WebP or PNG preferred). Replace the SVG placeholders on the landing page when ready.

## Capture checklist

1. Log into your tenant admin on `app.shiftswifthr.co.uk`
2. Capture at **1440×900** (or 2× for retina)
3. Redact: names, emails, NI numbers, addresses, employer names if sensitive
4. Export as:
   - `admin-overview.webp` (+ `.png` fallback) — dashboard / home
   - `time-clock.webp` (+ `.png` fallback) — Time Clock + hours export
   - `compliance.webp` (+ `.png` fallback) — RTW or sponsor compliance workspace

Until real captures exist, run `python3 scripts/generate_screenshot_placeholders.py` to refresh the branded PNG/WebP placeholders (SVG sources remain for design reference).

## Update `frontend/index.html`

Replace `srcset` / `src` on `.product-showcase-card picture` elements and update `alt` text to mention redacted sample data.

See `docs/go_to_market_credibility.md` for the full credibility checklist.
