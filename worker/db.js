// Every query here takes a userId and scopes to it. No exceptions.

const PROFILE_COLS =
  'id, email, display_name, coat_name, coat_role, coat_color, theme, term_start, imported_at, created_at, updated_at';

function profileFromRow(r) {
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    coat: { name: r.coat_name, role: r.coat_role, color: r.coat_color },
    theme: r.theme,
    termStart: r.term_start,
    importedAt: r.imported_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function findOrCreateUser(db, email, displayName = '', now = Date.now()) {
  const found = await db.prepare(`SELECT ${PROFILE_COLS} FROM users WHERE email = ?`).bind(email).first();
  if (found) return profileFromRow(found);
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, email, displayName, now, now)
    .run();
  return getProfile(db, id);
}

export async function getProfile(db, userId) {
  const row = await db.prepare(`SELECT ${PROFILE_COLS} FROM users WHERE id = ?`).bind(userId).first();
  return row ? profileFromRow(row) : null;
}

export async function updateProfile(db, userId, p, now = Date.now()) {
  await db
    .prepare(
      'UPDATE users SET display_name = ?, coat_name = ?, coat_role = ?, coat_color = ?, theme = ?, term_start = ?, updated_at = ? WHERE id = ?',
    )
    .bind(p.displayName, p.coatName, p.coatRole, p.coatColor, p.theme, p.termStart, now, userId)
    .run();
  return getProfile(db, userId);
}
