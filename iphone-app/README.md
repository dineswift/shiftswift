# ShiftSwift HR — iPhone / iPad app

Standalone Capacitor **iOS** app. Android lives in the sibling folder `../android-app/`.

**Version:** 1.5 (build 16)  
**Bundle ID:** `co.uk.shiftswifthr.app`

Push entitlements use `aps-environment=production` (App Store / TestFlight). Associated Domains are set for Universal Links (`applinks:app.shiftswifthr.co.uk`, `applinks:www.shiftswifthr.co.uk`); AASA lives at `frontend/.well-known/apple-app-site-association`.

## Setup

```bash
cd iphone-app
npm install
npm run sync:ios
npm run brand:ios
```

## Run

```bash
npm run ios:open
npm run ios:device
npm run appstore:archive
```

## Layouts

| Device | UI |
|--------|----|
| iPhone | Bottom tabs |
| iPad | Sidebar + content |

## After frontend changes

```bash
npm run sync:ios
```

## Android

Use **`../android-app/`** for Play Store builds and Android devices.
