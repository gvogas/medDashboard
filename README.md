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
- **Views**: Week, Month, All items, Study and Music. Admins also get Admin.
- **Semesters and school calendar**: terms, breaks and repeating items.
- **Grades**: weights, the average so far, what the rest needs, and "What if" scores.
- **Study**: a flow timer, a focus screen, streaks, history and spaced review.
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
- **Team projects** (admins only for now): a project, on its own or belonging to a class
  assignment, with tasks the team adds, assigns, claims and completes, in a project
  sheet. They join the Week and the other views later.
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

Pushing `main` deploys through Cloudflare's Git build (`npm run build`). That build does
not apply database migrations. If a change includes a new migration, run
`npm run db:remote` before you push. Secrets, accounts, Spotify setup and
troubleshooting are in [docs/DEPLOYING.md](docs/DEPLOYING.md).

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
