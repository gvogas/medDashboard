// What deleting an account removes: each table, with how its rows name their owner (?1 is
// the user id), in an order the foreign keys accept; then the user row, whose deletion
// cascades to its Spotify attempts. Courses, items and the change feed belong to the
// scope 'u:<id>', which no foreign key follows, so they are listed here. Shared by the
// Admin page (worker/admin.js) and scripts/add-user.mjs, so no imports: the script runs
// it under Node.

export const ACCOUNT_TABLES = [
  ['achievements', 'user_id = ?1'],
  ['study_sessions', 'user_id = ?1'],
  ['items', "scope = 'u:' || ?1"],
  ['quotes', 'user_id = ?1'],
  ['courses', "scope = 'u:' || ?1"],
  ['spotify_tokens', 'user_id = ?1'],
  ['changes', "scope = 'u:' || ?1"],
];
