# ShiftSwift HR — Frontend install (CloudPanel Static HTML site)

Upload **shiftswifthr-frontend.zip** to **both** site roots (same zip contents).

## app.shiftswifthr.co.uk (HR app)

Login, admin, employee portal, signup, time clock, platform OPS.

1. Create **Static HTML Site** in CloudPanel for `app.shiftswifthr.co.uk`
2. Extract zip into site root (`index.html`, `business-login.html`, `admin.html`, …)
3. Enable SSL
4. **Sign in:** `https://app.shiftswifthr.co.uk/` (portal picker) or `https://app.shiftswifthr.co.uk/business-login.html`
5. **Platform OPS:** `https://app.shiftswifthr.co.uk/ops-9x7k2.html`

## www.shiftswifthr.co.uk (marketing only)

Homepage, pricing, legal pages (`privacy-policy.html`, `eula.html`, …).

1. Site root should **not** contain `business-login.html`, `admin.html`, or other HR app pages.
2. `pull-production.sh` syncs **marketing files only** to www; the full app goes to **app.** only.
3. Marketing CTAs link to **`https://app.shiftswifthr.co.uk/…`** for sign-in and trial signup.
4. Legacy bookmarks to `www…/business-login.html` should 404 on www or redirect via nginx to **app.**

Do **not** send customers to `www.shiftswifthr.co.uk/business-login.html` — use **app.** only.

## API

Production API: `https://api.shiftswifthr.co.uk` (set in `brand-config.js` / `CORS_ALLOW_ORIGINS`).

Ensure the API site is live before testing login.

## nginx

Use `deploy/nginx-shiftswift.conf` — www redirects app paths to `app.shiftswifthr.co.uk`.
