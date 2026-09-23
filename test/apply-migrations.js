import { applyD1Migrations, env } from 'cloudflare:test';

// Runs once per test file. Tests within a file share storage and must use distinct
// users or explicitly clean shared state such as upstream cooldowns.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
