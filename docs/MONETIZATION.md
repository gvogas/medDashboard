# Making money with Term

A plan for turning Term from a tool for a few friends into an app that pays for itself
and then some. It covers the model, what is free and what is paid, prices, what has to be
built first, the features that make people want it, and the order to do it in.

What is already built is marked **built**. Everything else is a proposal to decide on.

## The short version

- **Model:** free app with a subscription, **Term Pro**, sold in the iPhone/iPad/Mac app.
  No ads: ads in a study app cost trust and earn little.
- **Price:** $3.99 a month or $24.99 a year, with a 7-day free trial on the yearly plan.
- **Free keeps the core:** courses, the timetable, deadlines, the week and month, grades,
  the study timer, reminders. Pro sells what costs money to run (AI) and what people
  enjoy paying for (themes, deeper stats, widgets).
- **Before it can earn anything**, Term needs a public sign-up and an App Store listing.
- **The growth engine** is the first two minutes: drop in a syllabus, get the whole term
  filled in. Then shared classes, where one student invites the rest.

## Why someone would pay

Students already have free planners. Term is worth paying for when it saves real time
and feels like theirs:

1. **AI import:** a course outline or a timetable screenshot becomes every deadline,
   exam and class. Nobody else does this as well, and it is the feature to lead with.
2. **"What do I need on the final?":** the grade maths students do on napkins.
3. **Study timer, focus screen, streaks and achievements**, with music.
4. **A theme for their field** (Medicine, Law, Aviation…): small, but people like it.
5. **Shared classes:** one person sets up the class, everyone gets the dates.

## Free and Pro

| | Free | Pro |
| --- | --- | --- |
| Courses, timetable, items, week, month, all items | ✓ | ✓ |
| Grades and "what if" | ✓ | ✓ |
| Study timer, focus screen, streaks | ✓ | ✓ |
| Deadline and exam reminders (app) | ✓ **built** | ✓ |
| Calendar feed, Spotify controls | ✓ | ✓ |
| AI imports (outlines, timetables, school calendars) | 3 a day **built** | 10 a day **built** |
| Themes | Medicine, Computer Science **built** | all six **built** |
| Home-screen and Lock Screen widgets (next exam, today) | — | ✓ **built** |
| Study timer on the Lock Screen (Live Activity) | — | ✓ *to build* |
| Full study history, year heatmap, per-course stats | this month | ✓ *to build* |
| Custom reminder times | — | ✓ *to build* |
| Custom achievements with your own sticker | 3 | unlimited *to build* |
| Shared classes | join any, create 1 | create unlimited *to build* |

Rules of thumb:
- Never take something away that free users already rely on. Gates go on new features
  or on volume (AI reads), not on the basics.
- Keep **Spotify free**. Spotify's developer terms do not allow charging for their
  content, so Spotify must never be a reason to pay.
- Shared classes stay free to join: every class is a way in for new people.

## Prices

| Plan | Price | Notes |
| --- | --- | --- |
| Monthly | $3.99 | for the student who only wants it during exams |
| Yearly | $24.99 | the one to push: about half the monthly price; 7-day free trial |
| Lifetime (optional, later) | $49.99 | a launch offer or a one-off sale; caps revenue per person |

Apple sets local prices from the US price. Join Apple's **Small Business Program**
(15% commission instead of 30% under $1M a year). Try a lower price in one country
before changing it everywhere.

**Student discounts** are built in: the yearly price already is one. A back-to-school
offer (first year $14.99, September and January) is the strongest seasonal lever. Apple
supports introductory offers and offer codes for this.

## What it costs to run

| Item | Cost |
| --- | --- |
| Apple Developer Program | $99 a year |
| Cloudflare Workers, D1 | free now; Workers Paid is $5 a month once requests pass the free 100,000 a day (a few hundred daily users with sync) |
| Workers AI | the free 10,000 neurons a day cover a handful of imports per day for the whole account; past that it is paid per use. This is the real variable cost, and the reason AI is the Pro limit |
| RevenueCat | free up to $2,500 a month in revenue, then 1% |
| Apple's commission | 15% (Small Business Program) |

Each yearly subscriber brings in about **$21** after Apple. A few dozen subscribers cover
every fixed cost; after that it is profit apart from AI use.

## What one year could look like

Rough figures, to set expectations rather than predict:

| Monthly active users | Paying (3–5%) | Yearly revenue after Apple |
| --- | --- | --- |
| 500 | 15–25 | $300–550 |
| 5,000 | 150–250 | $3,000–5,500 |
| 50,000 | 1,500–2,500 | $30,000–55,000 |

Usage is the hard part, not the code. The plan below spends most of its effort there.

## What is built (this branch)

- **Pro on the server:** `plans` table, `PAYWALL` switch (off: everyone keeps
  everything), AI reads by plan, RevenueCat webhook, admin "Give Pro". `worker/plans.js`.
- **Pro in the app:** the Term Pro sheet with App Store prices, Buy, Restore, and the
  links Apple asks for; Pro shown on the themes and when the AI limit is reached.
- **App Store must-haves:** delete your own account, a draft privacy policy, the app
  version check, token sign-in for the app.
- **The iPhone/iPad/Mac app** itself (Capacitor), with deadline and exam reminders,
  home-screen and Lock Screen widgets, and Sign in with Apple in the app and on the
  website. See [IOS.md](IOS.md).

## The plan

### Phase 1: TestFlight with the people already using Term (2–3 weeks)

- Build the app (IOS.md), set up App Store Connect and RevenueCat, upload to TestFlight.
- Keep `PAYWALL` off. Give everyone using Term today Pro for life (Admin → Give Pro):
  they are the first fans, and they will be the first reviews.
- Fix what feels wrong on a phone: spacing, touch targets, the keyboard.
- Turn on `BILLING_SANDBOX` and do a real test purchase end to end.

### Phase 2: open sign-up (2–3 weeks)

Selling to strangers needs a way in. This is the biggest piece still to build:

- **Sign-up** in the app and on the website. Sign in with Apple is **built**: setting
  `SIGNUPS` to `"open"` already lets new people in with their Apple ID. Still to build: a
  username-and-password sign-up for people without an Apple device.
- **Abuse protection**: Cloudflare Turnstile (free) on web sign-up, rate limits per
  address (the existing `request_limits` table), and a cap on AI reads for new accounts.
- **Email** (optional) for password resets; until then, Sign in with Apple covers it.
- **Onboarding that sells the app**: pick your field (sets the theme), drop in a
  syllabus or a timetable screenshot, watch the term fill in. Show the first deadline
  reminder being set. The aim: under two minutes from download to "this is my term".

### Phase 3: launch Pro (1–2 weeks, timed for late August or early January)

- App Store listing: name **"Term: Student Planner"** (searchable), subtitle around
  "Syllabus to schedule with AI", screenshots of the AI import, the week, the grades
  and the focus screen.
- Turn `PAYWALL` on, `BILLING_SANDBOX` off. Launch with the yearly trial and a
  back-to-school intro price.
- Ask for a rating after a good moment (a finished study session, a 7-day streak), never
  on first launch. Apple's built-in prompt allows three a year.

### Phase 4: the features people pick Term for (ongoing)

In order of what moves downloads and conversions:

1. **Widgets** (**built**, needs the one-time Xcode target setup in IOS.md): next exam
   countdown, today's classes and what is due. Visible on the home screen every day.
2. **Live Activity for the study timer**: the timer on the Lock Screen and Dynamic
   Island. Pro.
3. **Study stats**: per course, per week, the year heatmap, "hours before each exam".
   Pro.
4. **Shared classes for everyone** (Stage 6 of the collaboration plan): one student
   imports the syllabus, the class joins with a code. This is the viral loop: every
   class shared brings in classmates.
5. **Apple Calendar**: show Term's items in Calendar (the feed works today; an EventKit
   import of school events is next).
6. **Referral**: give a friend a month of Pro, get a month (App Store offer codes).
7. **Apple Watch**: next class and the study timer, later.

### Phase 5: grow

- **TikTok and Instagram**: short videos of "syllabus → whole term in 10 seconds". This
  one clip is the ad.
- **Campus ambassadors**: a free year of Pro for a student who sets up shared classes
  for their year.
- **Reddit and Discord** communities by field (premed, law school, engineering), where
  the themes already speak their language.
- **App Store search**: "student planner", "syllabus", "class schedule", "grade
  calculator", "study timer".

## Numbers to watch

| Measure | Healthy |
| --- | --- |
| Finished onboarding with an import | over 50% of sign-ups |
| Still active after 7 days | over 30% |
| Trial started | 10–20% of active users |
| Trial to paid | 40–60% |
| Paying users | 3–5% of monthly actives |
| Refund rate | under 3% |

RevenueCat's dashboard shows trials, conversions and revenue without extra work. For
usage, a privacy-friendly counter on the Worker (sign-ups, imports, weekly actives) is
enough; avoid third-party tracking SDKs, which also keep the App Store privacy label
clean.

## Risks

- **Spotify:** apps in Spotify's development mode are limited to a small list of
  users. Opening the music player to the public needs Spotify's approval, which is
  hard to get for small apps. Plan for Term to sell without it; keep it as a perk.
- **AI costs** grow with users. The free limit, the Pro limit, and caching (already
  built for repeat reads) keep it bounded; watch the Admin page's usage meters.
- **App Review:** the usual first-time rejections are a missing demo account, a paywall
  without the required wording, or no account deletion. The last two are built.
- **Free-tier limits** on Cloudflare: move to Workers Paid ($5 a month) before launch
  day, not during it.
- **One person running it:** keep the admin tools and the maintenance switches handy;
  they already let you turn a feature off without a deploy.
