import { applyD1Migrations, env } from 'cloudflare:test';

// Runs once per test file; isolated storage then restores this state for every test.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
