# Native iOS apps (App Store)

ShiftSwift HR ships native iOS apps that use the **same UI and API** as the Employee and HR Admin PWAs. They are Capacitor shells around `app.shiftswifthr.co.uk` — not a separate codebase.

| App | Bundle ID | Open in Xcode |
|-----|-----------|----------------|
| **ShiftSwift HR** (unified, iPad) | `co.uk.shiftswifthr.app` | [mobile/README.md](../mobile/README.md) → `npm run ios:open` |
| Employee | `co.uk.shiftswifthr.employee` | `npm run ios:employee:open` |
| HR Admin | `co.uk.shiftswifthr.hradmin` | `npm run ios:business:open` |

## Why Capacitor (not a Swift rewrite)

- **Identical to PWA** — same screens, rotas, clock-in, compliance modules
- **One deploy** — fix the web app; native apps pick it up on next launch (remote URL mode)
- **Faster to App Store** — native splash, icons, permissions, and distribution without rebuilding every screen in SwiftUI

## Distribution options

| Channel | Best for |
|---------|----------|
| **PWA** (done) | Staff who can use Safari → Add to Home Screen |
| **Native iOS** (this) | App Store presence, MDM, users who expect “download from App Store” |
| **TestFlight** | Pilot customers before public listing |

## Next steps for production

1. Run `cd mobile && npm install && npm run ios:setup`
2. Configure signing in Xcode (Apple Developer team)
3. Submit **ShiftSwift HR** (`ios-app`) first for iPad; Employee next (highest staff iPhone usage)
4. Optional phase 2: **APNs** for native push (Web Push already works in PWA on iOS 16.4+)

The iPad HR app loads `app.shiftswifthr.co.uk`. Deploy the tablet layout and in-app PDF/QR UI with the web app, then reopen the native shell (build **11** / **1.0.3** clears a stale WebKit cache).

See [mobile/README.md](../mobile/README.md) for commands and local dev with `SSHR_SERVER_URL`.
