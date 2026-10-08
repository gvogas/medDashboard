# Testing the iPhone, iPad and Mac app

Everything is built. What is left is creating accounts and keys with Apple and RevenueCat,
putting their ids in one file, and pressing Run. This guide goes in order; each step says
where to click and what to copy.

You need a Mac with Xcode 16 or later, an iPhone (for purchases and widgets; the simulator
covers the rest), and an Apple Developer Program membership ($99 a year).

## The short version

```sh
# 1. fill in app.config.json (the ids below)
npm install
npm run ios:configure      # copies the ids into Xcode, the entitlements, the Worker's settings
npm run ios:secrets        # puts the two secrets on the Worker (asks Wrangler)
npm run ios:doctor         # checks everything, says what is missing
npm run ios:sync           # builds the app's web part and copies it into Xcode
npm run ios:open           # opens Xcode: pick your iPhone, press Run
```

Commit and push `wrangler.jsonc` and `app.config.json` after `ios:configure`, so the live
Worker gets the same settings.

## app.config.json

The only file you edit. Nothing in it is secret: every value ends up inside the app or is
public anyway.

| Setting | What it is | Where to find it |
| --- | --- | --- |
| `bundleId` | The app's id. Must be unique to you. | You choose it, e.g. `net.vogas.term`. Register it in step 1. |
| `teamId` | Your developer team. | developer.apple.com → Account → Membership details → Team ID (10 characters). |
| `appGroup` | Shared storage between the app and its widgets. | You choose it: `group.` + the bundle id. Register it in step 1. |
| `build` | The build number. | Start at 1. Raise it by one for every upload to TestFlight. |
| `apiBase` | The Worker the app talks to. | The live site. Point it at a test Worker if you have one. |
| `revenueCatIosKey` | RevenueCat's public key for Apple. | RevenueCat → your project → API keys → the Apple key, starts with `appl_`. Step 4. |
| `signInWithApple` | Show Sign in with Apple. | `true` once step 1's Sign in with Apple is ticked. |
| `appleServicesId` | Sign in with Apple on the website. | The Services ID from step 2. Leave empty to have it in the app only. |
| `appleKeyId` | The key that lets Term revoke Apple sign-ins when an account is deleted. | The Key ID from step 3. |
| `paywall` | Limit the app's free plan. | `false` while testing other things; `true` to test the paywall. The website is never limited. |
| `sandboxPurchases` | Count test purchases. | `true` while testing with Xcode or TestFlight. `false` before the public launch. |

The version shown in the App Store is `"version"` in `package.json`; `ios:configure` copies
it into Xcode too.

## 1. Apple Developer: the app's id and its capabilities

developer.apple.com → Certificates, Identifiers & Profiles.

1. **Identifiers → + → App Groups.** Description "Term", identifier = your `appGroup`.
2. **Identifiers → + → App IDs → App.** Description "Term", Bundle ID (explicit) = your
   `bundleId`. Tick:
   - **App Groups** (then Configure → pick the group from 1),
   - **In-App Purchase** (usually on already),
   - **Sign in with Apple** (if you want it; "Enable as a primary App ID").
3. Make a second App ID for the widget: Bundle ID = your `bundleId` + `.widget`, with
   **App Groups** ticked and the same group.

Xcode can create these by itself when it signs ("Automatically manage signing"), but the App
Group and Sign in with Apple are more reliable made here first.

## 2. Sign in with Apple on the website (optional)

Identifiers → + → **Services IDs**. Identifier e.g. `net.vogas.term.web`. Tick Sign in with
Apple → Configure: primary App ID = the app's; Domains = `rounds.termanitor07.workers.dev`;
Return URLs = `https://rounds.termanitor07.workers.dev/`. Put the identifier in
`appleServicesId`.

## 3. The Sign in with Apple key (optional, needed before release)

Keys → + → name "Term Sign in with Apple", tick **Sign in with Apple** → Configure → the
app's App ID → Continue → Register → **Download** the `AuthKey_XXXXXXXXXX.p8` (only once).
Put the Key ID in `appleKeyId`, then:

```sh
npm run ios:secrets -- --skip-webhook --p8 ~/Downloads/AuthKey_XXXXXXXXXX.p8
```

## 4. App Store Connect and RevenueCat: Term Pro

**App Store Connect** (appstoreconnect.apple.com):

1. Apps → + → New App: iOS (and macOS for the Mac app), name "Term: Student Planner",
   bundle id from step 1, SKU anything.
2. The app → Monetization → **Subscriptions** → create a group "Term Pro", then two
   subscriptions in it:
   - `term_pro_monthly`, 1 month, $3.99,
   - `term_pro_yearly`, 1 year, $24.99 (optional: an introductory offer, a 1-week free trial).
   Each needs a display name and a description; the review screenshot can wait until you
   submit.
3. Users and Access → **Sandbox** → Test Accounts → +: a made-up email you control. This is
   the Apple account that "buys" in tests and is never charged.
4. Business → Agreements: accept the **Paid Apps** agreement (and fill in banking and tax).
   Until it is active, products do not load, even in the sandbox.

**RevenueCat** (app.revenuecat.com, free until $2,500 a month in revenue):

1. Create a project, then add an **App Store** app with your bundle id. It asks for an
   **In-App Purchase key** from App Store Connect (Users and Access → Integrations → In-App
   Purchase → +): upload the `.p8` it gives you, with its Key ID and your Issuer ID.
2. **Products** → import or add `term_pro_monthly` and `term_pro_yearly`.
3. **Entitlements** → + → identifier **`pro`** (exactly this; the Worker looks for it). Attach
   both products.
4. **Offerings** → the `default` offering → add two packages: **Monthly** →
   `term_pro_monthly`, **Annual** → `term_pro_yearly`. Make it the current offering.
5. **API keys** → copy the Apple public key (`appl_…`) into `revenueCatIosKey`.
6. Run `npm run ios:secrets`. It makes the webhook secret, stores it on the Worker, and prints
   the URL and header to paste into RevenueCat → **Integrations → Webhooks → Add**
   (environment: both).

## 5. Put it together

```sh
npm run ios:configure
npm run db:remote           # the database changes this work needs (once)
git add -A && git commit -m "Configure the app" && git push   # the Worker picks up wrangler.jsonc
npm run ios:doctor          # every line should be ✓ or ·
npm run ios:sync
npm run ios:open
```

In Xcode, check **Signing & Capabilities** on both targets (App and TermWidget): your team,
App Groups ticked with your group, and on App: Sign in with Apple and In-App Purchase. Then
pick your iPhone (plugged in, Developer Mode on: Settings → Privacy & Security) and Run.

## 6. What to test

Sign in with your Term username first. Then:

| Feature | How to test | Works in the simulator? |
| --- | --- | --- |
| Sync with the website | Add an item on the phone; it shows on the website within a few seconds (and the other way). | Yes |
| Offline | Airplane mode, add an item, turn it off: it syncs. | Yes |
| Reminders | Settings → Study → Reminders → On, allow. Add an assignment due tomorrow: a "Due tomorrow" notification is scheduled for 18:00 today. To see one quickly, set its date to tomorrow and change the phone's clock. | Yes |
| Widgets | Needs Pro (or the paywall off). Home screen → long-press → + → Term → Next exam / Today. Lock Screen → customise → add Next exam. | Yes (home screen) |
| Sign in with Apple, linking | Settings → Account → Connect Apple ID. Sign out, then Sign in with Apple. | Yes, with an Apple ID signed in to the simulator |
| Sign in with Apple, new account | Set `SIGNUPS` to `"open"` in `wrangler.jsonc` and push; sign in with an Apple ID that has no Term account. | Yes |
| The paywall | `paywall: true`, `ios:configure`, push. On an account without Pro: only Notebook among the themes, 3 AI reads a day, widgets say "Term Pro". The website stays fully open. | Yes |
| Buying Pro | `sandboxPurchases: true` (pushed). Settings → Account → See Term Pro → a price → sign in with the **sandbox** account when asked. Within seconds the sheet says "Welcome to Term Pro", and Admin → Accounts shows "pro". Sandbox subscriptions renew every few minutes and stop after a few renewals. | Purchases need a real device |
| Restore | Delete the app, reinstall, sign in, Term Pro → Restore purchases. | Real device |
| Deleting the account | Settings → Account → Delete account (use a test account). | Yes |
| Old builds | Set `MIN_APP_VERSION` above the app's version: the app is told to update. | Yes |

To give yourself or a tester Pro without buying, use the website's Admin → Accounts → Give
Pro.

## 7. TestFlight

1. Raise `build` in `app.config.json` (and `"version"` in `package.json` for a new
   version), `npm run ios:configure`, `npm run ios:sync`.
2. Xcode → pick "Any iOS Device" → Product → Archive → Distribute App → App Store Connect →
   Upload.
3. App Store Connect → TestFlight: add yourself as an internal tester. TestFlight purchases
   use the sandbox, so keep `sandboxPurchases: true`.

## When something does not work

| What you see | Why, and the fix |
| --- | --- |
| The widget target is missing (Xcode shows only App) | Only if the `ios/` folder was made again: `gem install xcodeproj`, then `npm run ios:widget`. |
| Xcode: "No account for team" / signing errors | `teamId` empty or wrong, or you are not signed in to Xcode (Settings → Accounts). |
| Xcode: "Provisioning profile doesn't include the App Groups entitlement" | The App ID (step 1) does not have App Groups with your group ticked. |
| The Term Pro sheet says "Loading prices…" forever, or "could not be reached" | The Paid Apps agreement is not active, the products are not "Ready to Submit", the offering has no packages, or `revenueCatIosKey` is wrong. RevenueCat's debug log in Xcode's console names which. |
| Bought, but the app never shows Pro | The webhook did not land: `sandboxPurchases` not pushed, the webhook URL or header wrong, or the entitlement is not called `pro`. RevenueCat → Integrations → Webhooks shows each delivery and the Worker's answer. |
| "No Term account uses this Apple ID yet" | Expected while `SIGNUPS` is closed: link the Apple ID from Settings first. |
| Sign in with Apple fails at once | `signInWithApple` not on, or the App ID does not have Sign in with Apple, or the Worker's `APPLE_CLIENT_IDS` is not pushed (`ios:doctor` checks). |
| Widgets say "Open Term and sign in" | The App Group is not ticked on both targets, or differs between them. |
| Widgets say "Widgets come with Term Pro" | The paywall is on and the account has no Pro. Give Pro from Admin, or set `paywall: false`. |
| The app shows the sign-in screen with "Your session has ended" | The token expired or "Sign out everywhere" was used: sign in again. |
| Anything else | `npm run ios:doctor`, and Xcode's console (the app logs there). |
