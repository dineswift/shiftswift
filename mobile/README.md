# Native iOS — retired split apps

ShiftSwift HR uses **one** universal iOS app for iPhone and iPad:

**[`../iphone-app/`](../iphone-app/README.md)** · bundle ID `co.uk.shiftswifthr.app`

Do not build or submit the old Employee (`ios-employee`) or HR Admin (`ios-business`) variants. They are leftovers from an earlier split and are not the App Store app.

```bash
cd ../iphone-app
npm install
npm run sync:ios
npm run ios:open
```
