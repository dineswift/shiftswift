# Native iOS apps (App Store)

ShiftSwift HR ships two native iPhone apps that use the **same UI and API** as the Employee and HR Admin PWAs. They are Capacitor shells around `app.shiftswifthr.co.uk` — not a separate codebase.

| App | Setup |
|-----|--------|
| Employee | [mobile/README.md](../mobile/README.md) → `npm run ios:employee:open` |
| HR Admin | [mobile/README.md](../mobile/README.md) → `npm run ios:business:open` |

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
3. Submit Employee app first (highest staff usage)
4. Optional phase 2: **APNs** for native push (Web Push already works in PWA on iOS 16.4+)

See [mobile/README.md](../mobile/README.md) for commands and local dev with `SSHR_SERVER_URL`.
