# Study Garden — Design

2026-10-14 · George · Revised 2026-11-02 (AI without a paid or sign-up third party; review against main) · Companion spec: [2026-10-14-study-garden-spec.md](2026-10-14-study-garden-spec.md)

## Summary

Study Garden brings the study tools and game layer from [gvogas/hacks](https://github.com/gvogas/hacks) into the tracker as an opt-in mode. It adds AI notes, flashcards, quizzes and study plans, plus coins, a shop and a plant pet that grows as you study. Members of a shared class can also share their decks, quizzes, notes and material with the class.

The tracker already has Study tabs, a focus timer, achievements, Spotify and Import with AI. Study Garden builds on those instead of copying hacks' FastAPI and SQLite code. Collab Stages 7–10 are on main; Study together (rooms, presence, room chat) landed after this plan was first written.

In the app the feature is the **Garden** tab with a **Gameplay** toggle in Settings; "Study Garden" is only the project name.

## Goals and non-goals

**Goals**

- Turn a class's material into flashcards, quizzes, notes and a study plan, and review the cards with spaced repetition.
- Shared classes: members share decks, quizzes, notes and pasted or uploaded material with the class, so everyone studies from the same pool. Each person keeps their own review progress.
- Reward real study: focus-timer minutes, finished items and good grades earn XP and coins.
- A plant pet with 7 tiers, a shop and cosmetics, all behind a gameplay toggle that is off by default.
- Keep AI free for the app and for users, with no third party to sign up for or pay: Workers AI with caps, and the user's own AI chat (ChatGPT, Claude, Gemini, any plan) through copy and paste. Later, Sign in with ChatGPT and a connector that runs inside the user's chat.
- Never block the core tracker: game and study-AI each get their own maintenance switch.

**Non-goals**

- The game is personal: plants, coins and review progress are never shown to others. The existing opt-in study leaderboard stays as it is.
- No web research (hacks used Tavily).
- No paid tiers, no custom domain.
- No API key paste for any provider, and no OpenRouter (removed 11/02).
- The plant never dies and never costs coins.
- No AI for Scout or Import with AI through the user's own AI; those stay on Workers AI.

## Plan review

### 10/14

The decisions from the 10/14 Q&A hold up, but the plan needed eight changes. The biggest: coins and XP must be worked out on the server from synced rows, because the tracker is local-first and every row can be edited.

| # | Finding | Why it matters | Change to the plan |
| --- | --- | --- | --- |
| 1 | Study sessions can be typed in (`manual = 1`) and edited up to 1,440 minutes | A user could log 24 h and buy everything | Only timed sessions earn. XP counts at most 240 timed min/day; manual logs earn nothing |
| 2 | Item status toggles freely (`todo` ↔ `done`), in `items` and in `marks` for class items | Toggling would farm the finish bonus | Award a finish once per item, ever, through a ledger row keyed by item id; tasks, office hours, tutoring and custom types pay at most 5 a day, since anyone can make those |
| 3 | The tracker syncs through the `changes` feed, and the browser holds a full copy | A client-side coin count can be forged | The Worker owns the wallet. The browser only shows what `GET /api/garden` returns |
| 4 | XP from edited or deleted sessions | Deleting a session should not keep its XP | XP is derived from live sessions on read, not stored. Coins earned are ledger rows, so a spend never goes negative after a delete |
| 5 | PDF text is already extracted in the browser (`src/core/pdftext.ts`, vendored pdf.js) | The plan said "parse files in the Worker" | Parse in the browser. PPTX = zip + slide XML, read with `DecompressionStream`; no new library |
| 6 | Workers AI is shared: ~108 neurons per Scout screenshot, 10 outline reads per user per day | Study AI could starve Import with AI | A global study-AI ceiling of 4,000 neurons/day (estimated from token counts) on top of per-user caps |
| 7 | The client rejects a whole sync page that holds a kind it does not know (`src/core/api.ts:187`), and any `c:` change that is not `courses` or `items` | New decks and cards must not break open tabs | New kinds are served only on a new sync v4; v3 gets a kind filter it does not have today |
| 8 | Flashcards are useful without AI | Everyone gets value even with the AI cap spent | Manual card creation ships first; AI generation fills the same decks |

### 11/02, against main at `3aaeaae`

| # | Finding | Change to the plan |
| --- | --- | --- |
| 9 | Migrations `0006`–`0009` are taken (sessions, push, room chat) | Study Garden starts at `0010`; each stage bumps `LATEST_MIGRATION` (`worker/admin.js`, `scripts/lib/move-db.js`) and the list in DEPLOYING |
| 10 | `activity.verb` has a fixed `CHECK` list; SQLite cannot change it in place | Stage 7 needs a migration that rebuilds `activity` with a `material.shared` verb |
| 11 | `syncPageV3` (`worker/db.js:635`) filters no kinds; only v2 does (`db.js:318`). The v2 client was removed 10/27 | v3 gets an explicit filter to its seven kinds in Stage 3, before any new kind is written |
| 12 | `askJson` (`worker/ai.js:201`) already asks, cleans and retries; `giveBackOutline` (`worker/limits.js:129`) hands a use back | The gateway reuses both instead of `runModel` + `modelJson` |
| 13 | Maintenance switches are a fixed list (`worker/maintenance.js:13`) with a route map | `garden` and `studyai` are added there and in `src/core/maintenance.ts` |
| 14 | Lecture reviews (`src/core/reviews.ts`) make "Review 1/4 …" tasks | They don't use up the 5-a-day task limit, since the app makes them; card reminders in the calendar say "Flashcards: N due" so the two never look alike |
| 15 | OpenRouter Connect cost the app nothing, but made every user sign up with a third party, and took a third of Stage 4 | Removed. Bring your own AI is copy and paste now; Sign in with ChatGPT and a connector later (see below) |

**Open from the 11/02 review** (decide before Stage 1): self-made exams and projects pay with no daily limit; `manual` and `completedAt` are set by the browser; project (`p:`) items are not covered; study-room sessions could be checked against the room's server clock. Listed under Rollout.

**Stage order.** Game core (toggle, ledger, Garden) comes first because it touches no AI. Decks and spaced repetition come before the AI gateway, so AI generation drops into a working deck. Quizzes need the gateway; notes and plans come next; shared class materials after that. The connector is last and optional.

## Architecture

Study Garden adds two Worker route groups (three with the connector), extends sync, and adds nine D1 tables (twelve with the connector). Every coin and every Workers AI call passes through the Worker, which checks the `garden` or `studyai` switch first.

```mermaid
flowchart LR
  subgraph Browser["Browser (React)"]
    GT["Garden tab<br/>plant, shop, badge"]
    ST["Study tabs<br/>cards, quiz, notes"]
    FR["File reader<br/>PDF and PPTX to text"]
    PP["Prompts + answer check<br/>shared with the Worker"]
    SS["Store + sync<br/>decks, cards, reviews"]
  end
  subgraph Worker["Worker (/api)"]
    AG["/api/garden<br/>wallet ledger, derived XP"]
    AI["/api/study-ai<br/>switch, caps, provider slot"]
    SY["/api/sync v4<br/>new feed kinds"]
    MC["/mcp + /oauth<br/>connector (Stage 8)"]
  end
  WAI["Workers AI<br/>free, per-user + global cap"]
  CHAT["User's own AI chat<br/>ChatGPT, Claude, Gemini"]
  D1[("D1<br/>garden_ledger, decks, cards,<br/>card_state, quizzes, ...")]
  FR --> ST
  ST --> PP
  PP -- "copy prompt / paste answer" --> CHAT
  GT --> AG
  ST --> AI
  SS --> SY
  AI --> WAI
  CHAT -. "connector tools" .-> MC
  Worker --> D1
```

The browser turns files into text and sends only text. There are three ways to get AI output, all checked by the same answer rules and all ending in the same preview:

- **Workers AI** (one tap, capped): `/api/study-ai` builds the prompt, calls the model, checks the answer.
- **Your own AI** (copy and paste, no cap): the browser builds the same prompt from its local copy of the class, the user runs it in any AI chat and pastes the answer back, and the browser checks it. Nothing new on the Worker; saving uses the existing row routes.
- **Later:** Sign in with ChatGPT as a second provider in the same slot, and a connector that lets the user's ChatGPT or Claude read class material and save decks directly.

- **Wallet.** `garden_ledger` holds one row per award or spend, with a unique key per source (`session:<id>`, `item:<scope>:<id>`, `claim:<tier>`, `buy:<sku>:<n>`) so nothing pays twice. Balance = sum of rows. XP is worked out on read from timed sessions and first finishes.
- **Decks and reviews.** Study content (decks, cards, quizzes, docs) carries a `scope` like items: `u:` when personal, `c:<space>` when shared with a class. Review progress (`card_state`, `card_reviews`) is always personal, in the user's `u:` feed, so review works offline and syncs.
- **Prompts and answer rules live once**, in `src/core/study-prompts.ts` and `src/core/study-answers.ts`, imported by both the browser (paste) and the Worker (Workers AI), as the Worker already imports `src/core/grades.ts`. A pasted answer and a model answer are held to exactly the same limits.
- **AI gateway.** One module picks the provider through a small provider interface, enforces caps through `request_limits` (`claimLimit`, as outline reads do), estimates neurons from token counts, and writes the usage line to Workers Logs. Only `workers` exists at Stage 4; `chatgpt` slots in if OpenAI accepts the app.

## User experience

With gameplay off, nothing new shows apart from flashcards and AI tools in Study. Turning it on in Settings adds the Garden tab and a header badge.

| Surface | Shows | Gameplay off |
| --- | --- | --- |
| Settings › Gameplay | Gameplay toggle; "AI for study" card: "Free quota: 2 of 3 left today" and a note that "Use your own AI" always works with any chat | AI card still shows |
| Header badge | Plant thumbnail + coin count; tap opens Garden | Hidden |
| Garden tab | Plant (sprite by tier, wilt level by health), XP bar to next tier, streak, tier list with Claim/Equip, shop (upgrades, backgrounds and frames, AI uses), recent earnings | Hidden |
| Study › Cards | Decks per class (mine and shared), "N due" count, review screen (flip, Again/Good/Easy), add card by hand, Generate | Shows; no coins or heal |
| Study › Quiz | Generate quiz (1–20 questions, difficulty), take it, score, weak topics; link to an exam | Shows; no plant effect |
| Study › Notes & plan | Generate notes from class data, files or a topic; a plan up to the class's next exam that weights weak topics | Shows |
| Class sheet › Materials | Shared decks, quizzes, notes and material; Add material; Share from mine; Generate | Shows (shared classes) |
| Focus screen | "+N XP" toast when a timed session ends | No toast |

**Generate flow.** Pick a class, pick sources (class items and notes, uploaded PDF/PPTX/TXT/MD, or a typed topic), pick counts, then choose **Generate here** (Workers AI) or **Use your own AI**. Files are read in the browser and only text is sent. A preview lists the cards or questions; the user removes or edits any before saving.

**Use your own AI.** Step 1: **Copy prompt** (and links to open ChatGPT, Claude or Gemini in a new tab). Step 2: paste the answer into the box. The app reads the JSON even when the chat wraps it in a code block or adds a sentence around it, keeps the entries that pass the rules, and says "18 of 20 cards could be read". The same preview follows. It works on a phone, with any plan, free or paid, and never counts against the free quota.

**Caps shown up front.** "Generate here" says how many free uses are left today. A spent cap points to Use your own AI (always available) or a coin-bought extra use.

**More ways in.** Generate also opens from an exam's item card, the class sheet, and a toast after a lecture review. A quiz can be linked to an exam and add its weak topics to that exam's prep checklist. The study plan runs to the class's next exam by default.

**Reminders.** A "N cards due" chip on today in Week view, a drooping header plant while cards wait, and optional "Flashcards: N due" events in the calendar feed.

**Sharing.** Sharing to a class makes a copy and posts to the class inbox (Collab Stage 7 activity). The author edits; the author or the class owner/editors remove. No votes or reports.

**Maintenance.** Two new switches: `garden` (hides Garden, badge, earning) and `studyai` (stops Generate here and the connector; hand-made cards and Use your own AI still work, since neither calls the Worker's AI). Sharing also respects `classes`.

## Bring your own AI

The aim: people use AI they already have, and neither they nor the app pays or signs up for anything new. Three steps, in this order.

| Step | How it works | When | Cost |
| --- | --- | --- | --- |
| 1. Copy prompt / paste answer | Browser builds the prompt; user runs it in any AI chat and pastes the answer back | Stage 4 | None |
| 2. Sign in with ChatGPT | A sign-in button; the user's ChatGPT plan answers Generate requests, as a second provider in the gateway | Only if OpenAI accepts the app into its preview (announced DevDay 2026; hosted apps must request access) | None; the user's plan allowance |
| 3. Connector (MCP) | User adds Rounds as a connector in ChatGPT (Apps SDK) or Claude. Their chat calls the app's tools: list classes, read class material, save a deck, save a quiz | Stage 8, optional | None; the user's chat does the AI work |

Step 2 is not designed in detail until OpenAI accepts the app and publishes the terms; the gateway's provider slot is the only thing built for it ahead of time. Apply now, from the OpenAI developer dashboard.

## Game economy

Legendary takes about 65 hours of timed study, roughly one busy semester. hacks reached it in 7 hours (6 XP a minute), which suits a hackathon demo, not a term. All numbers are starting values, kept in one constants file for tuning. Gameplay starts fresh: nothing from before it was turned on counts.

**XP and tiers.** 1 XP per timed minute (max 240 a day) plus 10 XP the first time an item is finished. The plant's tier is set by total XP.

| Tier | XP | Hours of study (approx.) | Claim reward (coins) | Sprite |
| --- | --- | --- | --- | --- |
| Bad | 0 | 0 | 5 | MainFlower1 |
| Average | 120 | 2 | 25 | MainFlower2 |
| Good | 300 | 5 | 50 | MainFlower3 |
| Excellent | 700 | 11 | 100 | MainFlower4 |
| Amazing | 1,400 | 22 | 200 | Sunflower |
| Phenomenal | 2,500 | 40 | 400 | WhiteFlower |
| Legendary | 4,000 | 65 | 800 | CactiBro |

**Coins earned.** 1 coin per 5 timed minutes, 5 per finished item (15 for an exam or project; tasks and other self-made items at most 5 a day), 1 per 10 cards reviewed (max 10 a day), 1 per correct quiz answer (max 20 a day). Upgrades raise each rate. Cards and quizzes earn the same however they were made (by hand, Workers AI, pasted, or the connector).

**Grade bonus.** A grade of 80% or more pays 10 coins, 90% or more pays 25, once per item. Lowering the grade later takes nothing back.

**Streak.** A day with 15+ timed minutes or 10+ card reviews extends the streak and pays 2 coins per streak day, at most 20. Missing a day resets it and never hurts the plant.

**Author reward.** When a classmate first uses a deck or quiz you shared, you get 1 coin, at most 20 a day. Sharing pays a little; it can't be farmed alone.

**Plant health (0–100, never dies).**

| Event | Health |
| --- | --- |
| Lab missed, office hour skipped, or assignment still open a day after due (not tutoring Cancelled or project Dropped) | −10 |
| Wrong quiz answer | −3 |
| 4th and later day in a row with no timed study | −5 per day |
| 10 timed minutes | +1 |
| Card reviewed (once per card per day) | +2 |
| Correct quiz answer | +5 |

Health only changes the look: 70–100 healthy, 40–69 drooping, 15–39 cracked (Cracked2), 0–14 broken (Cracked1). It never removes XP or coins. The shattered-pot sprite (Broken) is not used.

**Shop.**

| Track | Effect per level | Cost (level n) | Max level |
| --- | --- | --- | --- |
| Focus Engine | +20% study coins | 40 + 35n | 5 |
| Card Foundry | +1 coin cap on cards | 55 + 45n | 5 |
| Quiz Magnet | +5 quiz coin cap | 70 + 55n | 5 |
| Finisher | +2 coins per finished item | 65 + 50n | 5 |
| Backgrounds and frames | Cosmetic only | 30–300 each | — |
| Extra AI use | +1 Workers AI generation today | 60 | 2 per day |

Extra AI uses still stop at the global ceiling, so coins can never buy past the shared quota. Use your own AI makes them a convenience, not a necessity.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Run hacks' FastAPI app beside the tracker | Second host, second login, second database; Cloudflare free tier has no Python server |
| Coins counted in the browser and synced as a row | Editable on the device; any sync conflict could mint coins |
| Paste a Gemini, OpenAI or Anthropic key | Users would have to make an API account and a key; free API tiers change often. Copy and paste gives the same with nothing to set up |
| OpenRouter Connect (the 10/14 plan) | Free for the app, but every user signs up with a third party, and it took a third of Stage 4 (OAuth, encrypted keys, model picker, four error codes). Removed 11/02 |
| On-device AI in the browser | Only some browsers and devices; small models make weaker cards. Revisit when it is widely available |
| Copy and paste through the Worker (prompt and answer check on the server) | The browser already holds the class and the rules are shared code; a Worker round trip would add requests and nothing else |
| User's own AI also powers Scout and Import with AI | User chose study features only; keeps those reads on the tested Workers AI prompts |
| Plant that dies and costs coins (as in hacks) | Punishing in a tool people open when stressed; user chose gentle |
| Simple flip deck instead of spaced repetition | User chose spaced repetition; the due count also gives a daily reason to return |
| Redraw sprites to follow the tracker's themes | More work; hacks' PNGs are the user's own and ready now |
| Parse uploads in the Worker | The browser already extracts PDF text; the Worker would spend CPU time and request size on it |
| Pot cosmetics | hacks' sprites have the pot drawn in; separate pots would need 7 new sprite sets each. User chose backgrounds and frames |
| Votes, reports or copy-to-mine on shared materials | User chose to keep it simple: the author edits, the author or class owner removes |
| Counting study logged before gameplay was turned on | User chose to start fresh |

## Rollout and open questions

Eight stages, each its own branch (`garden-N-<name>`), merged and released before the next starts. Stage 8 is optional. Every stage with a migration needs `db:remote` run by hand, since Git builds skip remote migrations, and bumps `LATEST_MIGRATION`.

1. **Game core** (`0010`). Gameplay toggle, `garden` maintenance switch, wallet ledger, XP worked out from sessions and finished items, Garden tab with plant, tiers and claim, header badge, streak bonus, admin grant for testing.
2. **Shop** (`0011`). Upgrades, backgrounds and frames, equip, grade bonus; extra AI use stays hidden until Stage 4.
3. **Decks and spaced repetition** (`0012`). Decks per class, cards by hand, review screen, due counts, card XP and heal; synced as new feed kinds (sync v4, and a kind filter on v3); Week view chip, plant nudge and calendar reminders.
4. **AI gateway and Use your own AI** (no migration). Per-user and global caps, `studyai` switch, provider slot, shared prompts and answer rules, Generate here (Workers AI) and Use your own AI (copy and paste) for flashcards from class data, files and topic; Admin usage and live caps; Generate from the exam card, class sheet and lecture review.
5. **Quizzes** (`0013`). Generate (both ways), take, score, weak topics, plant effects; link to an exam and feed its prep checklist.
6. **Notes and study plan** (`0014`). Generated notes per class (both ways); plan up to the class's next exam (max 30 days) weighted by weak topics.
7. **Shared class materials** (`0015`). Share a deck, quiz or notes to a class as a copy; add material as text; author and class owner/editors can remove; each share posts to the class inbox; author reward. The migration rebuilds `activity` with the `material.shared` verb.
8. **Connector, optional** (`0016`). An MCP server on the Worker with its own OAuth sign-in, usable from ChatGPT and Claude: list classes, read class material, save a deck, save a quiz. Private testing first; submit to the ChatGPT app directory only if it is worth it.

**Settled in Q&A (10/14)**

- Sprites: hacks' own mapping (table above); Cracked2 and Cracked1 show low health; Broken is unused.
- A quiz linked to an exam offers "Add weak topics to exam prep".

**Settled 11/02**

- OpenRouter Connect removed. Bring your own AI is copy and paste (Stage 4), then Sign in with ChatGPT if accepted, then the optional connector (Stage 8).

**Open**

- [ ] Neurons per generation: measure a 20-card run on Workers AI before fixing the per-user cap (planned: 3 a day).
- [ ] Apply for Sign in with ChatGPT; design the `chatgpt` provider only after acceptance.
- [ ] Self-made exams and projects pay 15 coins and grade bonuses with no daily limit. Cap all `u:` items instead, and pay grade bonuses only on class items?
- [ ] `manual` and `completedAt` are set by the browser. Accept that the 240 min/day cap is the real guard, and use the ledger row's server time (not `completed_at`) for the `garden_since` check?
- [ ] Project (`p:`) items: does finishing a project task pay, and to whom (the assignee)?
- [ ] Study-room sessions: check them against the room's server clock (`worker/rooms.js` `studyAt`), and is there a small group-study bonus?
- [ ] Two streaks: reuse the existing study streak rule (`studyPrefs`: goal, rest days) plus card reviews, instead of a separate Garden rule?
