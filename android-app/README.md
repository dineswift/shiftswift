# ShiftSwift HR — Android app

Standalone Capacitor Android app. Sibling of `iphone-app/` (iOS). Both sync from `../frontend`.

**Version:** 1.3.8 (versionCode 22) · targetSdk 36  
**Package:** `co.uk.shiftswifthr.app`

## Setup

```bash
cd android-app
npm install
npm run sync:android
npm run brand:android
```

## Run

```bash
npm run android:open      # Android Studio
npm run android:device    # USB device / tablet
npm run android:deploy
```

## Google Play

See [docs/PLAY_STORE_RELEASE.md](./docs/PLAY_STORE_RELEASE.md).

```bash
npm run playstore:signing     # one-time (if needed)
npm run playstore:firebase -- /path/to/google-services.json
npm run playstore:archive     # signed AAB
```

AAB: `android/app/build/outputs/bundle/release/app-release.aab`

## Layouts

| Device | UI |
|--------|----|
| Phone | Bottom tabs |
| Tablet | Sidebar + content |

## After frontend changes

```bash
npm run sync:android
```
