# Native iOS app (App Store)

ShiftSwift HR ships **one** universal iOS app for iPhone and iPad. Same UI and API as the PWAs — a Capacitor shell around the bundled frontend (and `app.shiftswifthr.co.uk` where needed).

| | |
|---|---|
| **App** | ShiftSwift HR |
| **Bundle ID** | `co.uk.shiftswifthr.app` |
| **Project** | [`iphone-app/`](../iphone-app/) |
| **Devices** | iPhone + iPad (`TARGETED_DEVICE_FAMILY = 1,2`) |

There is no separate Employee app, HR Admin app, or iPad-only app. Staff and managers sign in to the same build; iPhone uses bottom tabs, iPad uses a sidebar + content layout.

## Why Capacitor (not a Swift rewrite)

- **Identical to PWA** — same screens, rotas, clock-in, compliance modules
- **One deploy** — fix the web app, then `npm run sync:ios` in `iphone-app/`
- **App Store** — native splash, icons, Face ID, push, camera, and location

## Layouts

| Device | UI |
|--------|----|
| iPhone | Bottom tabs |
| iPad | Full-screen sidebar + content (no Split View) |

## Setup

```bash
cd iphone-app
npm install
npm run sync:ios
npm run brand:ios
npm run ios:open
```

See [iphone-app/README.md](../iphone-app/README.md) for device run and App Store archive commands.

The older `mobile/` Employee / HR Admin split is retired. Do not open those Xcode projects for new builds.
