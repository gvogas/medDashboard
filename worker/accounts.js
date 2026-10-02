// What deleting an account removes, in an order the foreign keys accept; then the user
// row, whose deletion cascades to its change feed and Spotify attempts. Shared by the
// Admin page (worker/admin.js) and scripts/add-user.mjs, so no imports: the script runs
// it under Node.

export const ACCOUNT_TABLES = ['achievements', 'study_sessions', 'items', 'quotes', 'courses', 'spotify_tokens'];
