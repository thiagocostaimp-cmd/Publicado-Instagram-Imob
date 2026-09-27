// Camada de banco de dados. Usa Postgres via o pacote "pg" -- funciona com
// qualquer Postgres (Neon, Supabase, Railway, um Postgres local...), basta
// apontar DATABASE_URL. Todas as funções são assíncronas (retornam Promise);
// as rotas em routes.js usam "await" para chamá-las.

const crypto = require("crypto");
const { Pool } = require("pg");
const config = require("./config");

// Neon (e a maioria dos Postgres gerenciados) exige conexão via SSL. Em
// desenvolvimento local (Postgres na própria máquina, sem SSL) isso é
// desligado automaticamente -- veja config.js.
const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      created_at TIMESTAMPTZ NOT NULL
    );
  `);
}

function nowIso() {
  return new Date().toISOString();
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    organizationId: row.organization_id,
    createdAt: row.created_at,
  };
}

// Cria a organização e a primeira conta (admin) numa única transação -- ou
// as duas coisas acontecem, ou nenhuma (evita organização "órfã" sem nenhum
// usuário se algo falhar no meio).
async function createOrganizationWithAdmin({ organizationName, name, email, passwordHash }) {
  const orgId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const createdAt = nowIso();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO organizations (id, name, created_at) VALUES ($1, $2, $3)",
      [orgId, organizationName, createdAt]
    );
    await client.query(
      `INSERT INTO users (id, name, email, password_hash, role, organization_id, created_at)
       VALUES ($1, $2, $3, $4, 'admin', $5, $6)`,
      [userId, name, email, passwordHash, orgId, createdAt]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const userRow = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
  return {
    organization: { id: orgId, name: organizationName, createdAt },
    user: rowToUser(userRow.rows[0]),
  };
}

async function findUserByEmail(email) {
  const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  return rowToUser(result.rows[0]);
}

async function findUserById(id) {
  const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return rowToUser(result.rows[0]);
}

async function findOrganizationById(id) {
  const result = await pool.query("SELECT * FROM organizations WHERE id = $1", [id]);
  return result.rows[0] || null;
}

async function listUsersByOrganization(organizationId) {
  const result = await pool.query(
    "SELECT * FROM users WHERE organization_id = $1 ORDER BY created_at ASC",
    [organizationId]
  );
  return result.rows.map(rowToUser);
}

async function createUser({ name, email, passwordHash, role, organizationId }) {
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, role, organization_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, name, email, passwordHash, role, organizationId, createdAt]
  );
  return findUserById(id);
}

async function deleteUser(id) {
  await pool.query("DELETE FROM users WHERE id = $1", [id]);
}

module.exports = {
  init,
  createOrganizationWithAdmin,
  findUserByEmail,
  findUserById,
  findOrganizationById,
  listUsersByOrganization,
  createUser,
  deleteUser,
};
