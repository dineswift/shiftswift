# ShiftSwift HR — Native iOS apps

Native **App Store** shells for the same Employee and HR Admin experiences as the PWAs.  
Built with [Capacitor](https://capacitorjs.com/): a full-screen iOS WebView loads `app.shiftswifthr.co.uk`, so UI, API calls, and features stay identical to the web/PWA apps.

## Apps

| App | Bundle ID | Capacitor variant | Start URL |
|-----|-----------|-------------------|-----------|
| **Employee** | `co.uk.shiftswifthr.employee` | `employee` | `employee-login.html?source=native` |
| **HR Admin** | `co.uk.shiftswifthr.hradmin` | `business` | `business-login.html?source=native` |

## Requirements

- macOS with **Xcode 15+**
- **Node.js 20+** (Capacitor 7; Capacitor 8 requires Node 22)
- **Apple Developer** account (for device testing and App Store)
- CocoaPods (`sudo gem install cocoapods`) — Xcode may prompt on first open

## First-time setup

```bash
cd mobile
npm install
npm run assets
npm run ios:setup
```

`ios:setup` creates `ios-employee/` and `ios-business/` Xcode projects and syncs Capacitor.

## Open in Xcode

```bash
# Employee app
npm run ios:employee:open

# HR Admin app
npm run ios:business:open
```

In Xcode:

1. Select your **Team** (Signing & Capabilities).
2. Choose a simulator or connected iPhone.
3. Press **Run** (⌘R).

## Local development (optional)

Point the native shell at your local frontend instead of production:

```bash
# Terminal 1 — frontend on :5173
bash scripts/start_local.sh

# Terminal 2 — sync Employee app to localhost
cd mobile
SSHR_SERVER_URL="http://localhost:5173/employee-login.html?source=native" npm run ios:employee:sync
npm run ios:employee:open
```

Use `business-login.html` for HR Admin.

## App icons & splash

Icons are copied from `frontend/assets/`:

```bash
npm run assets
```

To regenerate iOS asset catalogs after updating icons:

```bash
SSHR_APP=employee npx @capacitor/assets generate --ios
SSHR_APP=business npx @capacitor/assets generate --ios
```

(Run from `mobile/` with the matching `SSHR_APP` so the correct `ios-*` project is updated.)

## App Store submission (checklist)

1. **Apple Developer Program** — enroll at [developer.apple.com](https://developer.apple.com).
2. **App Store Connect** — create two apps (Employee + HR Admin).
3. **Privacy** — declare location and camera use (clock-in / QR); link to [privacy policy](https://app.shiftswifthr.co.uk/privacy-policy.html).
4. **Screenshots** — capture from iPhone simulator (6.7" and 6.1" required).
5. **Archive** — Xcode → Product → Archive → Distribute to App Store.
6. **Push notifications (optional v2)** — add APNs key in Apple Developer, enable Push capability in Xcode, extend API for native push tokens.

## How it matches the PWA

- Same HTML/CSS/JS from `app.shiftswifthr.co.uk`
- Same bottom tabs, clock-in, rotas, documents
- `native-app.js` hides “Add to Home Screen” prompts in the native shell
- Green splash + status bar (`#0f6e56`) like the PWA
- Camera + location permission strings for geofenced punch and QR scan

## Project layout

```
mobile/
  capacitor.config.ts    # employee | business via SSHR_APP
  www/employee/          # offline fallback shell
  www/business/
  ios-employee/          # Xcode project (generated)
  ios-business/
  assets/                # icons for Capacitor assets tool
  scripts/
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| White screen on launch | Check `app.shiftswifthr.co.uk` is reachable; verify Signing team in Xcode |
| `xcodebuild` / plug-in errors | Run `sudo xcodebuild -runFirstLaunch` once after installing or updating Xcode |
| Location/camera blocked | Settings → Privacy → enable for the app |
| Stale web UI | Production URL updates automatically; for bundled mode run `cap sync` |
| Pod install fails | `cd ios-employee/App && pod install` |

## Related docs

- PWA install pages: `frontend/install-employee.html`, `frontend/install-business.html`
- Frontend native detection: `frontend/native-app.js`
