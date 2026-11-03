# Agent rules for this repo

## Commits

- Do not add `Co-Authored-By` or any other trailer to commit messages.
- A `commit-msg` hook in `.git/hooks/` removes `Co-Authored-By` lines. It is local to this machine and is skipped by `--no-verify`, so check the message yourself before committing.
- Do not rewrite existing history. The 663 existing commits keep their trailers by decision.

## Pushing and deploying

- Never push, merge to `main`, or touch remote D1 without George's explicit yes.
- A stage with a migration needs `npm run db:remote` and `npm run db:check -- --remote` before its merge to `main`.

## Checks

- Run `npm run check` (typecheck, test, build) after changes.
- Keep every file LF. Non-ASCII text goes in with the edit or write tools, not through a shell; run `npm run build` after, because Vite rejects Latin-1 bytes.

## Plans

- Active plans: `docs/superpowers/plans/2026-11-02-study-buddy.md` and `docs/superpowers/plans/2026-11-03-ai-practice.md`. Follow their task order and decisions.
