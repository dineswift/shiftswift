# Google Play release checklist — ShiftSwift HR Android

Package: `co.uk.shiftswifthr.app`  
Current target version: **1.3.8** (versionCode **22**, targetSdk **36**). iOS marketing version is **1.5** (build 16).

## One-time setup

1. **Play Console app**
   - Create app “ShiftSwift HR” with package `co.uk.shiftswifthr.app`
   - Complete store listing, content rating, Data safety, target audience

2. **Upload signing key**
   ```bash
   cd android-app
   npm run playstore:signing
   ```
   Back up `android/keystore/shiftswifthr-upload.jks` and `android/key.properties` securely.  
   Prefer **Play App Signing** (Google holds the app signing key; you keep the upload key).

3. **Firebase (remote push / FCM)**
   - Firebase Console → add Android app with package `co.uk.shiftswifthr.app`
   - Download `google-services.json`
   ```bash
   npm run playstore:firebase -- /path/to/google-services.json
   ```
   - On the API server set `FIREBASE_SERVICE_ACCOUNT_JSON=/path/to/service-account.json`
   - Run DB migration `migrations/093_native_push_devices.sql` if not already applied

## Build & upload

```bash
cd android-app
npm run sync:www
npm run brand:android
npm run playstore:archive    # builds signed AAB
npm run playstore:upload     # optional API upload — or upload AAB in Play Console
```

AAB path: `android/app/build/outputs/bundle/release/app-release.aab`

## Play Console checklist

- [ ] Store listing (title, short/full description, screenshots phone + 7" / 10" tablet)
- [ ] App icon 512×512 — `android-app/store-assets/play-icon-512.png`
- [ ] Feature graphic 1024×500 — `android-app/store-assets/play-feature-graphic-1024x500.png`
- [ ] Privacy policy URL
- [ ] Data safety form (login, location for clock-in, notifications)
- [ ] Content rating questionnaire
- [ ] Target API / policy declarations
- [ ] Internal testing track first, then closed/open/production
- [ ] Countries / pricing (free)

## Feature parity with iOS (this build)

| Area | Status |
|------|--------|
| Bundled login + employee/admin portals | Same `www` bundle |
| Phone layout (bottom tabs) | Yes |
| Tablet layout (sidebar) | Yes — Android tablets + iPad |
| Geolocation / clock-in | Yes (admin + employee boots) |
| Local shift alerts | Yes |
| Remote push (FCM / APNs) | Client wired; server needs `FIREBASE_SERVICE_ACCOUNT_JSON` + APNs |
| Version | Android **1.3.8 / 22** · iOS **1.5 / 16** |

## Notes

- Debug installs: `npm run android:device`
- Do **not** commit `key.properties`, `*.jks`, or real `google-services.json`
- Examples live at `android/key.properties.example` and `android/app/google-services.json.example`
