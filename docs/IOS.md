# Term for iPhone, iPad and Mac

**To set it up and test it, follow [IOS-TESTING.md](IOS-TESTING.md)**: fill in
`app.config.json`, run `npm run ios:configure`, `ios:secrets` and `ios:doctor`.
This page explains how the app works.

The app is the same React front end, wrapped by [Capacitor](https://capacitorjs.com).
One Xcode project in `ios/` builds the iPhone and iPad app, and the Mac app through Mac
Catalyst. It talks to the live Worker, so accounts, data and Pro are shared with the
website.

## Catching up with the website (20 October 2026)

This branch was written on 8 October, from main after collaboration Stage 4. Since then main
has gained 115 commits (collaboration Stages 5–10, maintenance mode, the timetable-grid
reader) and the `student-upgrades` branch adds more (listed below). Nothing here has been
merged into this branch yet. This section is the plan for doing it, and what each new
website feature means for the app.

### Bringing the branch up to date

Merge `main`, then `student-upgrades` once it is on main, into this branch (a merge, not a
rebase: the branch is pushed). Expect conflicts in `worker/api.js`, `worker/admin.js`,
`worker/db.js`, `worker/validate.js`, `src/core/types.ts`, `src/core/api.ts`,
`src/data/session.ts`, `settings-sheet.tsx`, `sign-in.tsx`, `wrangler.jsonc` and the docs.

1. **Renumber this branch's migrations.** Main and `student-upgrades` already use the numbers
   this branch took:

   | Number | On main / student-upgrades | This branch, today | This branch, renamed |
   | --- | --- | --- | --- |
   | 0005 | `0005_activity.sql` (live) | `0005_plans.sql` | `0008_plans.sql` |
   | 0006 | `0006_push.sql` | `0006_apple.sql` | `0009_apple.sql` |
   | 0007 | `0007_grades.sql` | `0007_look.sql` | `0010_look.sql` |

   Rename with `git mv`, set `LATEST_MIGRATION` in `worker/admin.js` to `0010_look.sql`, and
   update `scripts/lib/move-db.js` and the migrations table in DEPLOYING.md. None of the
   three has run on the live database, so renaming is safe. `0008_plans.sql` rebuilds
   `admin_log` to add `comp` and `uncomp`; main has added no audit actions since, so its
   CHECK list is still right. `0010_look.sql` must keep `users.grading` (from
   `0007_grades.sql`): it only adds a column, so it does.
2. **One account-deletion path.** This branch's `DELETE /api/me` must go through main's
   `worker/accounts.js`, which since Stage 5 hands a person's classes and team projects on,
   takes them off project tasks and keeps the members' copies. Add `apple_accounts`, `plans`
   and `push_subscriptions` to what it removes (the first two cascade from `users`; check),
   and revoke Apple's grant before the rows go.
3. **Token sign-in on the new routes.** Every route added since uses `requireUser`, so the
   app's `Authorization: Bearer` token works on them as long as `worker/app.js` keeps
   hooking in there. Check the inbox (`/api/inbox`), the spaces and projects routes, the
   push routes and `GET /api/digest` with a token in the tests.
4. **Sync.** The app uses the same `src/core/sync.ts`, so it gets sync v3 (spaces, the
   inbox count, revoked scopes) with the merge. Old TestFlight builds on v2 keep working
   (`v=2` is still served), but they never see classes or projects: set `MIN_APP_VERSION`
   to the first build made after the merge.
5. **Themes.** Notebook (`look = 'note'`) must be added to everything that lists the six
   since: the first-run setup's theme step (`src/components/views/setup.tsx`), the term
   recap and Up next styling, the crunch warn colours in `tokens.css`, and the sidebar
   pictures.
6. **Security policy.** `scripts/build-ios.mjs` writes the app's CSP. Nothing new loads
   from another host, but re-run it and the website's `npm run csp:update` after the merge.
7. **Tests.** Run `npm run check` and this branch's native tests. Then go through
   IOS-TESTING.md §6 again, with the new rows in it.

### What is new on the website, and what it means for the app

| Website feature (where) | In the app |
| --- | --- |
| **Shared classes** for everyone: invites by username, join codes, roles, your own layer, leaving keeps a copy, removed items (Stages 3–6) | Works as is. A person who signs up with Sign in with Apple needs a **username** others can invite: make one on sign-up and let them change it. Join links (`/join/...`) should open the app: add a universal link (later). |
| **Inbox and activity**: the bell, invites with Accept/Decline, a class's Activity tab (Stage 7) | Works as is. Later: a push or local notification for a new invite (see Reminders below). |
| **Team projects**: tasks, assignees, progress rings, in the Week, Month, feed and inbox (Stages 8–10) | Works as is. The **Today** widget should list today's project tasks given to you (they are in `effectiveItems` once merged). |
| **Maintenance mode**: admins switch a feature off with a message | Works as is; the app reads it from `GET /api/me`. Never switch off sync. |
| **Up next** and **crunch warnings** (`src/core/next.ts`, `src/core/workload.ts`) | The **Today** widget should show the top three Up next rows instead of "what is due in the next week": same ranking, one source of truth. A crunch week can be the medium widget's headline. |
| **Calendar feed alerts** (`studyPrefs.alarms`) and the **morning digest** by Web Push (`worker/push.js`, `GET /api/digest`) | The app already has local reminders (`src/data/reminders.ts`). Keep them, and **don't subscribe to Web Push in the app**: hide the "Morning digest" toggle when `NATIVE`. Add a local 07:30 digest built from the same rules as `/api/digest` (move them into `src/core` so both use one copy). Respect `studyPrefs.alarms` as the master switch for both. |
| **Grade categories, credits, letter grades and GPA**, your own scale and pass marks (`0007_grades.sql`) | Works as is. A **GPA widget** (small) is a natural Pro addition. |
| **Lecture reviews synced** across devices (`studyPrefs.reviews`) | Turning reviews on in the app now turns them on on the website too, and the other way; before, the app's web view kept its own setting. |
| **Download my data** (JSON, CSV) | In the app, use the share sheet (`@capacitor/share` or a file write + share), since a Blob download does nothing in a web view. App Review likes it next to Delete account. |
| **Undo** on every delete, **timer presets** | Works as is. |
| **First-run setup** (theme, timetable, outline, reviews and goal) | This is MONETIZATION.md's Phase 2 "onboarding that sells the app", mostly built. For the app: add Notebook to its theme step, ask for notification permission in its last step (not on first launch), and show it after Sign in with Apple creates an account. |
| **Agenda** layout under 700px and 44px touch targets | Most of Phase 1's "fix what feels wrong on a phone". The app should start in the Agenda on iPhone; iPad keeps the Week. Still to check on a device: the keyboard over sheets and the safe areas. |
| **Term recap** (Study → History) | A good share moment at the end of a term ("share my recap" as an image) and a candidate for Pro "study stats". |
| **Import with AI**: every failed read logged with its code, a timetable's grid read from the picture or PDF itself, existing courses matched by a close name, and classes editable in the preview (`student-f-ai`) | The app's biggest selling point gets more reliable. Screenshots from the Photos picker can be HEIC: convert to JPEG on the native side (or ask iOS for JPEG) before `shrinkImage`, which cannot open HEIC in the web view. |
| **Study Garden** (planned: decks, spaced repetition, a plant and coins) | Not started. Decide before launch whether its cosmetics or AI decks are Pro (MONETIZATION.md). |

## What is different in the app

| | Website | App |
| --- | --- | --- |
| Front end served from | the Worker (`dist/client`) | the app's bundle (`dist-ios`, `capacitor://localhost`) |
| Signed in with | the `rounds_session` cookie | a token, sent as `Authorization: Bearer` (`worker/app.js`) |
| Offline | service worker + IndexedDB | IndexedDB only (the files are in the bundle) |
| Security policy | `public/_headers` | a `<meta>` written by `scripts/build-ios.mjs` |
| Spotify | connect, control, and play in the tab | control only; connecting opens the website |
| Reminders | calendar feed alerts, and a morning digest by Web Push (on `student-upgrades`) | local notifications (Settings → Study → Reminders); no Web Push |
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
- **Join links and invites** do not open the app yet: a universal link for `/join/...`
  and a notification for a new invite are later steps.
- **Push from the server** (an invite, a team task given to you) would need APNs. The
  local reminders and the local digest cover deadlines without it.
- **Not merged with main yet**: see "Catching up with the website" above.
- **The widget extension is not compiled here**: these files were written without Xcode.
  If Xcode reports an error in them, it will be small; fix it there or send it back.
