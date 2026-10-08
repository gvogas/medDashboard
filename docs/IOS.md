# Term for iPhone, iPad and Mac

The app is the same React front end, wrapped by [Capacitor](https://capacitorjs.com).
One Xcode project in `ios/` builds the iPhone and iPad app, and the Mac app through Mac
Catalyst. It talks to the live Worker, so accounts, data and Pro are shared with the
website.

## What is different in the app

| | Website | App |
| --- | --- | --- |
| Front end served from | the Worker (`dist/client`) | the app's bundle (`dist-ios`, `capacitor://localhost`) |
| Signed in with | the `rounds_session` cookie | a token, sent as `Authorization: Bearer` (`worker/app.js`) |
| Offline | service worker + IndexedDB | IndexedDB only (the files are in the bundle) |
| Security policy | `public/_headers` | a `<meta>` written by `scripts/build-ios.mjs` |
| Spotify | connect, control, and play in the tab | control only; connecting opens the website |
| Reminders | none | local notifications (Settings → Study → Reminders) |
| Term Pro | shown, not sold | sold through the App Store (RevenueCat) |

`src/core/native.ts` holds the switch (`NATIVE`, set by `vite build --mode ios`), the API
address and the token. Everything else is shared code.

## What you need

- A Mac with Xcode 16 or later.
- An Apple Developer Program membership ($99 a year).
- A bundle id registered under your account. `capacitor.config.ts` and the Xcode project
  use `net.vogas.term`; change both if you want another.

## Build and run

```sh
npm install
npm run ios:sync      # builds dist-ios and copies it into ios/
npm run ios:open      # opens Xcode
```

In Xcode: pick your team under Signing & Capabilities, pick a simulator or your phone,
and Run. For the Mac, pick "My Mac (Mac Catalyst)".

After any front-end change, run `npm run ios:sync` again. Native settings (icons,
`Info.plist`, capabilities) live in `ios/App` and are committed.

To point a build at another Worker (a preview, or `wrangler dev` on your Mac):

```sh
VITE_API_BASE=http://192.168.1.20:8787 npm run ios:sync
```

## Capabilities to turn on in Xcode

- **In-App Purchase** (for Term Pro).
- **Push Notifications** is not needed: reminders are local.

## In-app purchases (Term Pro)

1. In App Store Connect, create the app, then a subscription group "Term Pro" with two
   auto-renewing products, for example `term_pro_monthly` and `term_pro_yearly`. Prices are
   in [MONETIZATION.md](MONETIZATION.md).
2. In [RevenueCat](https://www.revenuecat.com) (free up to $2,500 a month in revenue): add
   the iOS app, the two products, an entitlement with the id **`pro`**, and an offering
   holding both as packages (Monthly and Annual).
3. Copy RevenueCat's public iOS SDK key into the build:
   `VITE_REVENUECAT_IOS_KEY=appl_xxx npm run ios:sync`. It is meant to ship in the app.
4. In RevenueCat → Integrations → Webhooks, set the URL to
   `https://rounds.termanitor07.workers.dev/api/billing/revenuecat` and the authorization
   header to `Bearer <a long random value>`. Store the same value on the Worker:
   `npx wrangler secret put REVENUECAT_WEBHOOK_SECRET`.
5. For TestFlight, set `BILLING_SANDBOX` to `"on"` in `wrangler.jsonc` so sandbox purchases
   count. Turn it off before the public launch.
6. Turn on `PAYWALL` only when the store is live, and give Pro to the existing accounts
   first (Admin → Accounts → Give Pro).

The app never decides Pro itself: it buys through RevenueCat, then asks the Worker
(`GET /api/plan`) until the webhook has landed (`src/data/plan.ts`).

## Shipping to TestFlight

1. Raise the version: `"version"` in `package.json` (the app sends it as `x-rounds-app`)
   and Marketing Version in Xcode, to the same number. Raise the Build number each upload.
2. `npm run ios:sync`, then in Xcode: Product → Archive → Distribute App → App Store Connect.
3. In App Store Connect → TestFlight, add testers. Internal testers (up to 100 people with
   access to your App Store Connect team) need no review; external testers need a short
   beta review. Builds expire after 90 days.

When a new Worker change would break old builds, set `MIN_APP_VERSION` in
`wrangler.jsonc`: older builds are told to update instead of failing.

## App Store review checklist

- [ ] Privacy policy URL: `/privacy.html` (a draft is in `public/privacy.html`; fill in the
      contact address and review it).
- [ ] App Privacy answers: account info (username), user content, purchases; no tracking.
- [ ] A demo account for the reviewer (there is no sign-up page yet, see MONETIZATION.md).
- [ ] Account deletion in the app: Settings → Account → Delete account (`DELETE /api/me`).
- [ ] The paywall shows the price, the period, that it renews, Restore, and links to the
      terms and the privacy policy (`src/components/sheet/pro-sheet.tsx`).
- [ ] Screenshots for 6.9" iPhone, 13" iPad and Mac.
- [ ] Export compliance: `ITSAppUsesNonExemptEncryption` is `false` in `Info.plist`.

## Known gaps

- **Connecting Spotify** opens the website, which needs you signed in there too. A
  native connect flow (a redirect back into the app) is a later step.
- **Sign-up**: accounts are still made by an admin. Selling Pro to strangers needs a
  sign-up page first (MONETIZATION.md, phase 2).
- **Token storage** is the web view's `localStorage`, inside the app's sandbox. Moving it
  to the Keychain is a small later step.
- **Widgets and Live Activities** need Swift code; they are on the roadmap, not here.
