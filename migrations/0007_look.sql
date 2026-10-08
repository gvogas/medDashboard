-- The free plan's own theme, Notebook ('note'), joins the six (docs/MONETIZATION.md). The
-- CHECK on users.bg cannot be widened in place, and rebuilding `users` would cascade-delete
-- every row that points at it, so the theme moves to a new column, `look`, which allows all
-- seven. `bg` stays for anything reading the old column: the Worker keeps it in step with
-- `look` for the six it knows and leaves it alone for Notebook.
--
-- New accounts start on Notebook (the column's default); everyone else keeps their theme.

ALTER TABLE users ADD COLUMN look TEXT NOT NULL DEFAULT 'note'
  CHECK (look IN ('note', 'med', 'cs', 'law', 'pilot', 'sports', 'eng'));
UPDATE users SET look = bg;
