# ShiftSwift HR — iPhone app (clean restart)

Self-contained Capacitor iPhone app. **Everything runs from the bundle** (`App://localhost`) — no production website, no script hijacking, no BridgeViewController hacks.

The old multi-variant setup under `mobile/` (`ios-app`, `ios-employee`, `ios-business`) is unchanged; use **this folder** for the unified HR app going forward.

## Architecture

| Page | URL | Source |
|------|-----|--------|
| Sign in | `App://localhost/index.html` | `frontend/sign-in.html` |
| Employee portal | `App://localhost/employee.html` | `frontend/employee.html` shell + `portal-boot.js` |

`portal-boot.js` hydrates the session from Capacitor Preferences, fetches your profile, **then** loads employee scripts (so they never run before login state exists).

## Setup

```bash
cd iphone-app
npm install
npm run sync:ios
npm run brand:ios
```

## Run on device

```bash
npm run ios:deploy -- --target YOUR_DEVICE_UDID
# or
npx cap run ios --target 00008130-0019645C1A6A001C
```

## Open in Xcode

```bash
npm run ios:open
```

## After frontend changes

```bash
npm run sync:ios
```

Copies JS/CSS from `../frontend/` and regenerates `www/index.html` + `www/employee.html`.

## Folder layout

```
iphone-app/
  www/              # bundled web app (generated — run sync:www)
  ios/              # Xcode project
  scripts/
    sync-www.mjs    # copy frontend → www
    portal-boot.js  # employee portal loader
  capacitor.config.ts
  package.json
```
