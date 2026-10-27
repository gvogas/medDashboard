-- Lookups by class or project rather than by person: the nightly purge (worker/db.js
-- purgeTombstones, a gone space's rows and a class item's last marks), autoKeep
-- (worker/leaving.js) and deleteProject (worker/projects.js). The primary keys lead with
-- user_id, so without these each of them scanned the whole table.
CREATE INDEX marks_space_item ON marks (space_id, item_id);
CREATE INDEX space_prefs_space ON space_prefs (space_id);
