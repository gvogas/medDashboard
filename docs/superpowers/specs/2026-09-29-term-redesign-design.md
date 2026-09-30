# Term: the redesign

Approved by the owner on 29 September 2026 ("its all good"), after a week of iterating on a
clickable prototype. This records what was approved and how it maps onto the app we have.
The plan is `docs/superpowers/plans/2026-09-29-term-redesign.md`.

**The source of truth is the prototype.** Canvas:
https://claude.ai/artifact/9xFvWnbeuFGhLwmuKbNAwV (the "Prototype — click around" board).
A copy is in the repo: `design/term-prototype.dc.html`. It is one self-contained page: the
markup at the top, and at the bottom a `<script type="text/x-dc">` whose `renderVals()`
holds every colour, word and rule below (search for `THEMES`, `TYPES`, `GOALS`, `STUDY`).
It runs only inside the canvas; read it as a reference, don't try to open it.

## Why

The owner found the current look "looks AI": textured cards, gradients, uppercase labels,
emoji, the DNA ornament, the dock of icons. The redesign is quieter and more editorial: a
paper background, near-black ink, one accent, a serif for headings, hairline rules, and
room to breathe. At the same time the app stops being medicine-only: it becomes **Term**,
with six themes.

## What changes, part by part

### 1. The name and the look

- **Name.** "Rounds" becomes **Term** everywhere a person reads it: the sidebar, the
  sign-in screen, the page title, the web manifest, Settings, the Spotify device name,
  messages. Internal names stay: the Worker (`rounds`), the D1 database (`rounds-v4`), the
  workers.dev address, IndexedDB names, CSS class names. No new domain (see memory: free
  tiers, workers.dev only).
- **Type.** Source Serif 4 for headings, big numbers and the quote; IBM Plex Sans for
  text; IBM Plex Mono for times, counts and codes. Self-hosted with `@fontsource`, like
  today. Figtree and Spectral go.
- **Colour (light, Medicine).** Paper `#F6F5F1`, panels `#FFFFFF`, the sidebar `#EFEEE9`,
  ink `#1C1C1A`, secondary ink `#55534E`, quiet ink `#6E6B64`, rules `#E6E3DC` and
  `#EFEDE8`, accent `#0F5F58`, today's tint `#EEF5F3`, overdue `#A8322A`, due tonight
  `#8A5300`. Each theme sets its own accent and completed colours (below).
- **Dark mode stays.** The prototype is light only; dark mode was not designed. Keep
  light / dark / device in Settings, and derive dark tokens from the same roles: a warm
  near-black paper (`#121312`), panels one step up (`#1B1C1A`), ink `#ECEAE4`, the accent
  lifted for contrast. The owner should look at dark mode at the end of Stage 1.
- **Gone.** The Texture cards and buttons (`src/components/ui/texture-*`), gradients,
  uppercase tracking labels, emoji (the 🔥 in the study tile), the DNA/biomolecule ornament
  and the stethoscope drape over the page, the magnetic dock.
- **Kept.** Everything the app does. Nothing is removed without a place to go.

### 2. Layout

- **Sidebar** (260px), top to bottom: the wordmark "Term" with the theme's name; the
  pages (Week, Month, All items, Study, Music), replacing the dock in the top bar; the
  courses, with a semester picker above them (Stage 3); the theme's picture with your name
  (Stage 2 for the new pictures); "Headed for *Neurologist*" (Stage 2); your quote; your
  name, the sync state and Settings.
- **The type filters.** Today's sidebar has "Open items" filters by type. The prototype has
  none. **Decision:** keep them, restyled, under the courses. Flag it for the owner at the
  Stage 1 review.
- **The sidebar player** (Spotify) stays where it is until Stage 6 redesigns music.
- **Top bar:** the date line and the page's title in serif (e.g. "28 Sep – 4 Oct"),
  previous / Today / next, search, "Import with AI" (Stage 7), "New item".
- **The four boxes** replace the five tiles: next exam or quiz (with the theme's animation,
  Stage 2), open assignments, overdue, studied today (with a goal bar and the streak). The
  quote tile moves to the sidebar. White cards, 8px radius, a 1px rule, no texture.

### 3. The week

- One white panel, "Schedule", with Everything / Deadlines / Classes.
- One band per day: the date in serif and the weekday on the left; today tinted with a 3px
  accent bar on its left edge and "Today" under the date.
- One **row** per entry, in columns: time (mono) · a mark and the title · type · course ·
  status on the right. A class has a hollow ring in its course colour; an item a filled
  square in its type colour. The next exam and quiz are bold.
- **Completed items tint the whole row** in the theme's completed colour (Medicine: pink,
  `#FBE8EF` with ink `#874A60`), with "✓ Done" on the right. This replaces fading them out.
- **The checklist bar stays**: a 48px bar beside the title that fills in the theme's
  completed gradient (Medicine `#EFAEC3 → #D9648C`), with "2/5".
- Office hours and Tasks stay in the right column, restyled as lists under a dark rule.
  Completed tasks tint like the rows.

### 4. The month

- Classes show as chips in **their course's colour** (a 12% tint, the course colour as
  text). Deadlines are white chips with the type's square; completed ones tint.
- Weekly items (tutorials, labs with Repeat) show on every week they repeat (Stage 3).

### 5. Themes (Stage 2)

Six, picked in Settings: Medicine, Computer Science, Law, Aviation, Sports, Engineering.
Each has its sidebar picture with the person's name on it, its accent, its "today" tint,
its completed colours, its next-exam animation, its study word, its dark timer colour and a
default quote. Exact values: `THEMES` and `STUDY` in the prototype. Summary:

| Theme | Picture | Accent | Completed | Next-exam animation |
|---|---|---|---|---|
| Medicine | Lab coat, name embroidered above the pocket, goal under it, stethoscope | `#0F5F58` | pink `#FBE8EF` / `#874A60` | ECG trace sweeping |
| Computer Science | Lanyard ID badge, goal on a band | `#2B4FA8` | mint `#E3F1E8` / `#2C6541` | terminal countdown, blinking cursor |
| Law | Suit, brass name plate, goal under it | `#7A2E2E` | parchment `#F4ECD6` / `#6A511C` | scales swaying, "Outlines 3 of 5" |
| Aviation | Flight jacket, wings, name tape, goal under it | `#1F3A5F` | sky `#DFEBF6` / `#274B70` | plane flying a dotted route |
| Sports | Back of a jersey, name, number, goal under it | `#2F6B3A` | peach `#FCE8D8` / `#84420F` | stopwatch hand |
| Engineering | Hi-vis vest, name tag with goal | `#3F4E5E` | hi-vis yellow `#FBF3C8` / `#665509` | two gears turning |

- **Pictures are SVG plus HTML text.** The canvas taught us that text inside the SVG is
  risky; put the name and goal as positioned HTML over the drawing, as the prototype does.
- **Names:** the coat shows the full name ("Alex Rivera") in serif italic, fitted to the
  space; the others use initial + surname or surname in capitals, as the prototype does.
- **"Where you're headed"** (the goal): six suggestions per theme (`GOALS` in the
  prototype) or free text. Shown on the picture and as "Headed for *Neurologist*" under it.
  **Stored in the profile's existing `coat_role`** (≤ 34 characters), which today holds the
  line under the name. No new column.
- **Animations respect reduced motion** (they stop).
- **Data:** the profile's `bg` column allows only `med` and `cs`
  (`migrations/0001_schema.sql`, `CHECK (bg IN ('med','cs'))`, and `BACKGROUNDS` in
  `worker/validate.js`). Stage 2 adds `law`, `pilot`, `sports`, `eng` with a migration.

### 6. Semesters and repeats (Stage 3)

- **A course belongs to a semester**: one of the school calendar's terms (Fall 2026, Winter
  2027…) or "Both / all year". Its classes show only between that term's first and last day,
  and skip the calendar's breaks as today.
- **Stored in the course's existing `term`** (≤ 40 characters): the term's name, or `''`
  for all year. Today `term` is free text ("2026 Autumn"); the course sheet turns it into a
  picker of the calendar's terms plus "Both semesters". A course whose text matches no term
  counts as all year. No new column.
- **The sidebar's semester picker** shows the courses of the term picked (all-year courses
  in both).
- **Repeat for tutorials and labs** in the item card: "Just once" or "Every week", until the
  end of Fall, of Winter, or of the year. Items already have `recur` and `recurUntil`;
  today only office hours and tutorials may repeat. Allow labs, and set `recurUntil` from
  the term picked.

### 7. The item card (Stage 4)

One floating card (460px, 10px from the edges, 16px radius) for a new item and for editing
one; edits save as you type, as today. Top to bottom:
- The kind ("New assignment") and when it's due ("in 3 days"), ✕.
- The title, large serif, borderless: "What is it called?".
- "Physiology meets Tue 08:30 · Room 1.07" when a course is picked.
- **The type as buttons** (Assignment, Exam, Quiz, Lab, Tutorial, Project, Task, plus the
  person's own types), not a dropdown.
- A list of rows with an icon and a label, the fields borderless until hovered or focused:
  Course (with its colour), **Date**, Time from–to, Room, Status (the type's words),
  Repeat (tutorials and labs), Weight (exams, quizzes, assignments).
- **Date:** the chosen day in words ("Fri 2 Oct"), Today, and a **Week / Month** switch.
  Week (the default) is the chosen week as seven buttons with ‹ ›; Month opens a calendar
  with ‹ October 2026 ›; picking a day there goes back to Week. Today is ringed; days that
  already have something due have a dot.
- Checklist (Topics for exams and quizzes), Notes and Links start folded behind
  "+ Checklist", "+ Notes", "+ Links", and open by themselves when the item has any.
- The foot: "Give it a name to save" / "Ready to save" / "Edits save as you type",
  Cancel or Delete, Save item or Done.
- Everything the current sheet has stays: fill topics from lectures, the prep pace, grade,
  studied time, weight, department for office hours.

### 8. Study (Stage 5)

Three tiles (streak, today against the goal as a ring, the semester so far), then four
tabs:
- **Timer:** the Ready card, large, in the theme's dark colour: the phase ("On shift ·
  round 1 of 4"; the word is the theme's), a four-card clock 96px high, the round strip,
  course and item, Start focus. Beside it Your flow (steps, rounds, quick starts, the third
  preset named for the theme) and Today (today's sessions, "Log study by hand").
- **History:** full width; Week as the chart (taller) beside the sessions, Month, Term.
- **Achievements:** full width, the medal groups two across.
- **Leaderboard:** its own tab, a centred column.
- The focus screen, the dock, logging and editing sessions, Undo all stay as they are.

### 9. Music (Stage 6)

The Music page (was Spotify): the player on the left (cover, title, progress, shuffle,
previous, play, next, repeat, device and volume, then Up next / Recent) and the browser on
the right (search, a playlist picked for the theme at the top, Liked Songs and the
playlists, an opened playlist with Play all, Shuffle and a filter, ▶ and + on every
track). **In focus mode**, the music pill opens a side panel on the focus screen (now
playing, controls, Up next / Recent / Library) with ✕, and the clock re-centres; this is
today's behaviour, restyled.

### 10. Import with AI (Stage 7)

A button in the top bar opens a card with three kinds:
- **Class schedule** (new): a timetable PDF or screenshot (PNG, JPG). The AI finds each
  course and its lectures, labs and tutorials (day, start, end, room). The preview lists
  courses ("Matches your course" or "New course"), each with a semester picker and a tick
  per class; "Add 13 classes" writes them to the courses' meetings. Classes already there
  aren't added twice.
- **Course outline:** as today, plus a **semester** picker beside the course.
- **School calendar:** as today (Settings keeps its entry too).
- While reading: a card with three steps ticking off and Cancel. Reads left today shown.
- **Images need a vision model.** Today `worker/outline.js` sends PDF text to
  `@cf/openai/gpt-oss-120b`. A screenshot needs a Workers AI model that reads images; the
  Stage 7 plan must pick one, check its neuron cost against the 10k/day free allowance
  shared with the live site (memory: Workers AI quota), and keep testing to a handful of
  runs. A PDF timetable can use the text path.

## Not in this redesign

The phone layout was only sketched (one board); Stages 1–6 must keep today's phone
behaviour working and restyle it with the same tokens, but a phone design pass is its own
job later. The sign-in screen gets the new look and name in Stage 1 (the canvas has a
board for it). Achievements' logic, the leaderboard's rules, sync and the Worker API are
unchanged except where a stage says so.
