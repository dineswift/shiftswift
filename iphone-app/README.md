# ShiftSwift HR — iPhone + iPad app

One universal Capacitor **iOS** app (iPhone and iPad). Android lives in `../android-app/`.

**Version:** 1.5 (build 17)  
**Bundle ID:** `co.uk.shiftswifthr.app`

There is no separate iPad app. This build is `TARGETED_DEVICE_FAMILY = 1,2`: iPhone uses bottom tabs; iPad uses a full-screen sidebar layout.

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
| iPhone | Bottom tabs, portrait + landscape |
| iPad | Sidebar + content, full screen (not Split View) |

## After frontend changes

```bash
npm run sync:ios
```

## Android

Use **`../android-app/`** for Play Store builds and Android devices.
