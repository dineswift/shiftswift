# Marketing screenshots

High-fidelity product mockups live in `mockups.html`. Rasterise them with:

```bash
python3 scripts/generate_marketing_screenshots.py
```

Output (PNG + WebP, 1440×900):

- `admin-overview` — dashboard, module tiles, open actions
- `employees` — register and lifecycle stages
- `time-clock` — geofenced punch records and accountant hours
- `rota` — published weekly grid
- `compliance` — right-to-work checks and day-9 status

The captures use fictional hospitality sample data and are labelled **Sample data** in the chrome.

To replace with redacted live tenant captures later, drop WebP/PNG files with the same names and keep alt text accurate.

See `docs/go_to_market_credibility.md` for the credibility checklist.
