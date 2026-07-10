# ShiftSwift HR — mobile app (iOS + Android)

Self-contained Capacitor app for **iOS and Android**. Everything runs from the bundle (`App://localhost` on iOS, `https://localhost` on Android) — no production website, no script hijacking.

## Architecture

| Page | Bundled URL | Source |
|------|-------------|--------|
| Sign in | `index.html` | `frontend/sign-in.html` |
| Employee portal | `employee.html` | `frontend/employee.html` + `portal-boot.js` |

## Setup

```bash
cd iphone-app
npm install
npm run sync:all
npm run brand:all
```

## iOS

```bash
npm run ios:deploy        # simulator
npm run ios:device        # USB device
npm run ios:repair-pods   # fix broken CocoaPods / geolocation pod
npm run appstore:archive  # App Store IPA
npm run appstore:upload   # App Store Connect
```

Enable **Push Notifications** capability in Xcode (Signing & Capabilities) if not already present.

**Remote push (APNs):** set on the API server:

- `APNS_KEY_PATH` — `.p8` key from Apple Developer
- `APNS_KEY_ID`, `APNS_TEAM_ID`
- `APNS_BUNDLE_ID=co.uk.shiftswifthr.app`
- `APNS_USE_SANDBOX=true` for debug builds

## Android

Requires **JDK 21+** and **Android SDK**.

```bash
npm run android:deploy    # emulator/device
npm run android:device    # build debug APK + USB install
npm run playstore:archive # signed Play Store AAB
npm run playstore:upload  # Play Console (or upload AAB manually)
```

**Release signing (one-time):**

```bash
npm run playstore:signing
```

**Firebase remote push (FCM):**

1. Create a Firebase project → add Android app `co.uk.shiftswifthr.app`
2. Download `google-services.json`
3. `npm run playstore:firebase -- /path/to/google-services.json`
4. On the API server set `FIREBASE_SERVICE_ACCOUNT_JSON=/path/to/service-account.json`

Run migration `093_native_push_devices.sql` before native push tokens work.

## After frontend changes

```bash
npm run sync:all
```
