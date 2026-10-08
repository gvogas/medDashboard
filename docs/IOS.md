# Term for iPhone, iPad and Mac

**To set it up and test it, follow [IOS-TESTING.md](IOS-TESTING.md)**: fill in
`app.config.json`, run `npm run ios:configure`, `ios:secrets` and `ios:doctor`.
This page explains how the app works.

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
| Sign in with Apple | Apple's popup, once a Services ID is set | Apple's own sheet |
| Widgets | none | next exam (home and Lock Screen), today (classes and what is due) |
| Term Pro | everything open, no paywall | the paywall, and Pro sold through the App Store (RevenueCat) |

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

`ios/App/App/App.entitlements` already asks for Sign in with Apple and the App Group
`group.net.vogas.term`. In Xcode → the App target → Signing & Capabilities, check they
show, and add:

- **In-App Purchase** (for Term Pro).
- **Push Notifications** is not needed: reminders are local.

## Sign in with Apple

It works in the app and on the website, and both end up in the same Term account.

1. In the Apple Developer portal → Identifiers, open the app's id (`net.vogas.term`) and
   tick **Sign in with Apple**.
2. For the website, make a **Services ID** (for example `net.vogas.term.web`), tick Sign in
   with Apple, and add the domain `rounds.termanitor07.workers.dev` with the return URL
   `https://rounds.termanitor07.workers.dev/`.
3. Make a **key** with Sign in with Apple ticked and download the `.p8`. This lets Term
   revoke Apple's grant when someone deletes their account, as Apple asks.
4. On the Worker, in `wrangler.jsonc` vars: `APPLE_CLIENT_IDS` = `net.vogas.term,net.vogas.term.web`,
   `APPLE_TEAM_ID` = your team id, `APPLE_KEY_ID` = the key's id. Then
   `npx wrangler secret put APPLE_PRIVATE_KEY` and paste the whole `.p8` file.
5. For the website's button, build with the Services ID: set `VITE_APPLE_WEB_CLIENT_ID` in
   Cloudflare's build settings (Settings → Build → Variables) to `net.vogas.term.web`.

How it behaves (`worker/apple.js`):
- Someone signed in connects their Apple ID in Settings → Account; after that either signs in.
- An Apple ID with no Term account is refused while `SIGNUPS` is `"closed"` (the default).
  With `"open"`, it makes a new account with no password; its owner deletes it by signing
  in with Apple again.

## Widgets

Two widgets, Pro only (they say so without Pro): **Next exam** (small, and the Lock Screen's
rectangular, circular and inline spots) and **Today** (medium and large: today's classes
and what is due in the next week). The app works out what they show
(`src/data/widgets.ts`) after every change, on opening and at midnight, and hands it to them
through a small plugin of its own (`native/term-widgets`), which `cap sync` installs.

The widget extension is its own Xcode target, `TermWidget`, already in the project and embedded
in the app (it was added by `scripts/add-widget-target.rb`). It needs iOS 17; the app itself
runs from iOS 15. Its bundle id is the app's plus `.widget`, and `npm run ios:configure` keeps
it, the team and the App Group in step. If the `ios/` folder is ever made again, add the
target back with `gem install xcodeproj` and `npm run ios:widget`.

If the widgets say "Open Term and sign in" after signing in, the App Group is not ticked on
both targets.

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
   first (Admin → Accounts → Give Pro). It limits the app only; the website stays open.

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
- [ ] Account deletion in the app: Settings → Account → Delete account (`DELETE /api/me`),
      which also revokes Sign in with Apple.
- [ ] The paywall shows the price, the period, that it renews, Restore, and links to the
      terms and the privacy policy (`src/components/sheet/pro-sheet.tsx`).
- [ ] Screenshots for 6.9" iPhone, 13" iPad and Mac.
- [ ] Export compliance: `ITSAppUsesNonExemptEncryption` is `false` in `Info.plist`.

## Known gaps

- **Connecting Spotify** opens the website, which needs you signed in there too. A
  native connect flow (a redirect back into the app) is a later step.
- **Sign-up**: with `SIGNUPS` closed, accounts are still made by an admin. Opening it lets
  new people in with Sign in with Apple; a username-and-password sign-up page is still to
  come (MONETIZATION.md, phase 2).
- **Token storage** is the web view's `localStorage`, inside the app's sandbox. Moving it
  to the Keychain is a small later step.
- **Live Activities** (the study timer on the Lock Screen) are on the roadmap, not here.
- **The widget extension is not compiled here**: these files were written without Xcode.
  If Xcode reports an error in them, it will be small; fix it there or send it back.
