# Term

Term is a student tracker for courses, class timetables, deadlines, grades and study
time. It is a small multi-user web app for a few people. Each account is created by
hand; there is no sign-up page. It runs on free Cloudflare tiers: static files and a
Worker API in front of a D1 (SQLite) database. The live site is
https://rounds.termanitor07.workers.dev.

The repo is called medDashboard. Inside the code the app is called `rounds` (the Worker,
the database, cookies and IndexedDB).

## Features

- **Courses and items**: exams, quizzes, assignments, labs, tutorials, office hours,
  tasks and projects. Courses carry their weekly classes (day, time, room).
- **Views**: Week, Month, All items, Study and Music. Admins also get Admin. The Week
  opens with **Up next**, a ranked list of what to do now, each with its reason ("Exam in
  4 days · worth 30% · 8 topics left"). Crowded days and weeks (two tests on a day, three
  exams in a week, three weighted deadlines within 48 hours) are marked on the Week and the
  Month, and saving an item that crowds one says so. On a phone the Week is an **Agenda**:
  a list of days from today, with a switch back to the grid.
- **First-run setup**: a new account picks a theme, imports a timetable and an outline,
  and turns on lecture reviews and a daily goal. Every step can be skipped.
- **Semesters and school calendar**: terms, breaks and repeating items.
- **Grades**: weights, the average so far, what the rest needs, and "What if" scores.
  A course can split its grade into categories ("Quizzes 20%, drop the lowest 2") and
  carries its credits; the sidebar shows your GPA for the semester and overall, on a
  grading scale and pass marks you can edit.
- **Study**: a flow timer with presets, a focus screen, streaks, history, a term recap
  and spaced review (on for your account, so every device follows it).
- **Reminders**: the calendar feed alerts a day and an hour before each open deadline,
  and each device can turn on a morning digest, a notification of what is due today and
  tomorrow.
- **Undo and export**: every delete of your own can be undone from its toast for 6
  seconds, and Settings downloads all your data as JSON or your items as CSV.
- **Achievements and a leaderboard.**
- **Music**: each person connects their own Spotify account.
- **Import with AI**: course outlines, school calendars and schedule screenshots,
  read by Workers AI and shown as a preview before anything is saved. An outline can
  go into your own courses, into a class you edit, or make a new class.
- **Shared classes**: for everyone signed in. A class is one course with its items,
  shared by the people in it. Join by an invite to your username or with a join code;
  roles are owner, editor and member. You keep your own layer (status, grade, notes,
  colour, semester) on top, and leaving keeps a copy of the class as your own course.
  A bell opens your inbox (invites and what others changed that concerns you), and
  each class has an Activity tab.
- **Team projects**: tasks shared with a small team, each with who has it, in your Week
  and your calendar feed. For everyone signed in. A project, on its own or belonging to
  a class assignment, has tasks the team adds, assigns, claims and completes, in a
  project sheet. The Week and the Month show each project's due date and your tasks
  there (ticking one completes it for the team), the calendar feed carries them too, the
  inbox tells you about tasks given to you, All items filters by source, and the
  sidebar shows each project's progress.
- **Admin page**: accounts, error log, audit log, announcement banner, and maintenance
  switches per feature.
- **Themes**: Medicine, Computer Science, Law, Aviation, Sports and Engineering, each
  in light or dark.
- **Local-first**: the app reads from IndexedDB, works offline, and syncs to D1. A
  private calendar feed works with Google or Apple Calendar, and carries your classes
  too.

## Quick start

Needs Node and Wrangler (`wrangler login` once). Copy `.dev.vars.example` to
`.dev.vars` and set a long random `SESSION_SECRET`.

```sh
npm install
npm run db:local                  # apply migrations to the local D1
npm run user:add -- yourname      # add --admin for an admin account
npm run dev                       # http://127.0.0.1:8787
npm run check                     # typecheck, tests and build
```

## Deploying

Pushing `main` deploys through GitHub Actions (`.github/workflows/deploy.yml`): the
checks run, new migrations are applied to the live database and checked, then the Worker
goes live. If a step fails nothing after it runs. It needs the `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` repository secrets. The morning digest needs three optional secrets (`npm run push:key` makes
them); without them push is off and everything else works. To try a branch for real first,
`npm run deploy:staging` puts it on a separate test site with its own database. Secrets,
accounts, staging, Spotify setup and troubleshooting are in [docs/DEPLOYING.md](docs/DEPLOYING.md).

## Keyboard shortcuts

| Key | Does |
| --- | --- |
| `n` | New item |
| `t` | Go to today |
| `[` `]` | Previous / next week or month |
| `1`–`5` | Week, Month, All items, Study, Music |
| `/` | Search |
| `?` | Show the list |
| `Esc` | Close a drawer or leave the focus screen |

## Docs

- [docs/PROJECT-OVERVIEW.md](docs/PROJECT-OVERVIEW.md): start here. Architecture, repo
  map and history.
- [docs/DATA-MODEL.md](docs/DATA-MODEL.md): schema, API, sync and security, including
  account and lockout rules.
- [docs/DEPLOYING.md](docs/DEPLOYING.md): running, deploying, accounts,
  [Spotify](docs/DEPLOYING.md#spotify), migrations and troubleshooting.
- [docs/superpowers/](docs/superpowers/): design specs and implementation plans.
- [docs/archive/](docs/archive/): finished plans and old reviews, kept for history.

## Licence

MIT. See [LICENSE](LICENSE).
