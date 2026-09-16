# ShiftSwift HR — Native iOS apps

Native **App Store** shells for the same Employee and HR Admin experiences as the PWAs.  
Built with [Capacitor](https://capacitorjs.com/): a full-screen iOS WebView loads `app.shiftswifthr.co.uk`, so UI, API calls, and features stay identical to the web/PWA apps.

## Apps

| App | Bundle ID | Capacitor variant | Xcode project | Start URL |
|-----|-----------|-------------------|---------------|-----------|
| **ShiftSwift HR** (unified) | `co.uk.shiftswifthr.app` | `app` | `ios-app/` | Bundled login, then `app.shiftswifthr.co.uk` |
| **Employee** | `co.uk.shiftswifthr.employee` | `employee` | `ios-employee/` | `employee-login.html?source=native` |
| **HR Admin** | `co.uk.shiftswifthr.hradmin` | `business` | `ios-business/` | `business-login.html?source=native` |

The iPad Himalayan Inn app is **ShiftSwift HR** (`ios-app`). After a web deploy it loads the live PWA; this native update adds camera/location permission strings and bumps the build so WebKit drops a stale cache.

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

## Open in Xcode (Mac only)

Quit **Xcode** first (Cmd+Q). Easiest: double-click `Open-ShiftSwift-in-Xcode.command` in the repo folder. Or run these commands **inside the git repo**, not from `~`. On this Mac that is usually `/Users/gskharel/Desktop/shiftswifthr`.

```bash
cd /Users/gskharel/Desktop/shiftswifthr
git fetch origin
git checkout -f -B cursor/ios-ipad-updates-b650 origin/cursor/ios-ipad-updates-b650
cd mobile
npm install
npm run ios:sync
cd ios-app/App
pod install
open App.xcworkspace
```

`checkout -f -B` throws away local `ios:sync` / Podfile.lock edits and switches onto the iPad branch. A normal `checkout` fails while those files are dirty, and `pull --ff-only` then runs on the **old** branch.

In Xcode:

1. Scheme **App** (not Pods / Capacitor). Destination **Gobinda's iPAD** (or any connected iPhone/iPad) — not My Mac.
2. App target → **Signing & Capabilities** → your Team.
3. Product → **Clean Build Folder**, then **Run** (⌘R).

To upload to **Transporter / TestFlight** instead of running locally:

```bash
cd /Users/gskharel/Desktop/shiftswifthr/mobile
npm run ios:ipa
```

The ShiftSwift HR app is a universal iPhone + iPad build (`TARGETED_DEVICE_FAMILY = 1,2`). On iPad it uses the full screen (no Split View) so the HR admin layout, rota PDFs, and premises QR scanner stay usable.

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
4. **Screenshots** — iPhone 6.7" and 6.1", plus iPad 13" (landscape) and 12.9" for the universal ShiftSwift HR app.
5. **IPA for Transporter / TestFlight** (Mac only) — from `mobile/`:

```bash
npm run ios:ipa
```

That writes `~/Desktop/ShiftSwiftHR-1.0.3-12.ipa`. Open **Transporter** from the Mac App Store, drag the IPA in, and click **Deliver**. App Store Connect then processes it for TestFlight.

Or in Xcode: Product → Archive → Distribute App → App Store Connect → Export, then drop the IPA on Transporter.

6. **Push notifications (optional v2)** — add APNs key in Apple Developer, enable Push capability in Xcode, extend API for native push tokens.

## How it matches the PWA

- Same HTML/CSS/JS from `app.shiftswifthr.co.uk`
- Same bottom tabs, clock-in, rotas, documents
- `native-app.js` hides “Add to Home Screen” prompts in the native shell
- Green splash + status bar (`#0f6e56`) like the PWA
- Camera + location + photo-library permission strings for geofenced punch and QR scan
- Universal iPhone + iPad (`TARGETED_DEVICE_FAMILY = 1,2`), full-screen on iPad

## Project layout

```
mobile/
  capacitor.config.ts    # app | employee | business via SSHR_APP
  www/app/               # unified ShiftSwift HR login (iPad)
  www/employee/
  www/business/
  ios-app/               # Xcode project — ShiftSwift HR (iPhone + iPad)
  ios-employee/
  ios-business/
  assets/                # icons for Capacitor assets tool
  scripts/
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| **Build Failed** (red banner, ~11 errors, navigator on Pods → Capacitor) | Quit Xcode. Open **`App.xcworkspace`**, scheme **App** (not the Capacitor pod), destination the **iPad**. Then `cd ios-app/App && pod install`, Product → Clean Build Folder, Run. |
| Wrong git branch | Must be `cursor/ios-ipad-updates-b650`, not `release/unified-signin-push-epos-migrations` |
| App icon / asset catalog errors | The 1024×1024 App Store icon must have **no alpha**. Re-run `npm run brand:ios` from `mobile/` |
| `unknown argument: '-Owholemodule'` | Pull this branch (Release uses `-O` + whole-module compilation) |
| White screen on launch | Check `app.shiftswifthr.co.uk` is reachable; verify Signing team in Xcode |
| `xcodebuild` / plug-in errors | Run `sudo xcodebuild -runFirstLaunch` once after installing or updating Xcode |
| Location/camera blocked | Settings → Privacy → enable for the app |
| Stale web UI | Production URL updates automatically; for bundled mode run `cap sync` |
| Pod install fails | `cd ios-app/App && pod install` |

## Related docs

- PWA install pages: `frontend/install-employee.html`, `frontend/install-business.html`
- Frontend native detection: `frontend/native-app.js`
