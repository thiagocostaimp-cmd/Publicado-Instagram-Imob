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
      created_at TIMESTAMPTZ NOT NULL,
      reset_token_hash TEXT,
      reset_token_expires_at TIMESTAMPTZ
    );
  `);
  // Coluna nova em bancos que já existiam antes desta versão (IF NOT EXISTS
  // faz o CREATE TABLE acima não fazer nada numa tabela que já existe).
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ;`);

  // "imoveis" e "publicador_config" guardam o essencial (id, dono, datas) em
  // colunas de verdade, e o resto -- os muitos campos específicos de cada
  // imóvel (quartos, preço, fotos do carrossel, hashtags...) -- num único
  // JSONB. Esses campos mudam com frequência conforme o painel evolui, e um
  // JSONB evita uma migração de banco a cada campo novo; a coluna
  // organization_id garante que uma imobiliária nunca veja os imóveis de outra.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS imoveis (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS imoveis_org_updated_idx
      ON imoveis (organization_id, updated_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS publicador_config (
      organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
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

// Guarda o HASH do token de redefinição de senha (nunca o token em si --
// mesmo raciocínio de nunca guardar senha em texto puro: se o banco
// vazasse, ninguém conseguiria usar os hashes para redefinir a senha de
// alguém). expiresAt limita quanto tempo o link do e-mail continua válido.
async function setResetToken(userId, tokenHash, expiresAt) {
  await pool.query(
    "UPDATE users SET reset_token_hash = $1, reset_token_expires_at = $2 WHERE id = $3",
    [tokenHash, expiresAt, userId]
  );
}

async function findUserByValidResetTokenHash(tokenHash) {
  const result = await pool.query(
    "SELECT * FROM users WHERE reset_token_hash = $1 AND reset_token_expires_at > now()",
    [tokenHash]
  );
  return rowToUser(result.rows[0]);
}

// Troca a senha e invalida o token na mesma operação -- um link de
// redefinição só pode ser usado uma vez.
async function updatePasswordAndClearResetToken(userId, passwordHash) {
  await pool.query(
    "UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_token_expires_at = NULL WHERE id = $2",
    [passwordHash, userId]
  );
}

/* ============================================================
   IMÓVEIS (Seu Lugar Publicador)
   ============================================================ */
function rowToImovel(row) {
  if (!row) return null;
  return Object.assign({ id: row.id }, row.data, {
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

async function listImoveis(organizationId) {
  const result = await pool.query(
    "SELECT * FROM imoveis WHERE organization_id = $1 ORDER BY updated_at DESC LIMIT 200",
    [organizationId]
  );
  return result.rows.map(rowToImovel);
}

async function getImovel(organizationId, id) {
  const result = await pool.query(
    "SELECT * FROM imoveis WHERE id = $1 AND organization_id = $2",
    [id, organizationId]
  );
  return rowToImovel(result.rows[0]);
}

// Cria (id vazio) ou substitui por completo (id de um imóvel já existente
// desta organização) -- mesmo comportamento de "set" que o rascunho do
// wizard espera ao salvar a cada etapa.
async function saveImovel(organizationId, id, data) {
  const now = nowIso();
  const payload = Object.assign({}, data);
  delete payload.id; delete payload.createdAt; delete payload.updatedAt;

  if (id) {
    const result = await pool.query(
      "UPDATE imoveis SET data = $1, updated_at = $2 WHERE id = $3 AND organization_id = $4",
      [payload, now, id, organizationId]
    );
    if (result.rowCount === 0) return null; // não existe (ou é de outra organização)
    return getImovel(organizationId, id);
  }

  const newId = crypto.randomUUID();
  await pool.query(
    "INSERT INTO imoveis (id, organization_id, data, created_at, updated_at) VALUES ($1, $2, $3, $4, $4)",
    [newId, organizationId, payload, now]
  );
  return getImovel(organizationId, newId);
}

async function deleteImovel(organizationId, id) {
  await pool.query("DELETE FROM imoveis WHERE id = $1 AND organization_id = $2", [id, organizationId]);
}

/* ============================================================
   CONFIGURAÇÃO DO PUBLICADOR (uma por organização)
   ============================================================ */
async function getPublicadorConfig(organizationId) {
  const result = await pool.query(
    "SELECT data FROM publicador_config WHERE organization_id = $1",
    [organizationId]
  );
  return result.rows[0] ? result.rows[0].data : null;
}

async function savePublicadorConfig(organizationId, data) {
  await pool.query(
    `INSERT INTO publicador_config (organization_id, data, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (organization_id) DO UPDATE SET data = $2, updated_at = $3`,
    [organizationId, data, nowIso()]
  );
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
  setResetToken,
  findUserByValidResetTokenHash,
  updatePasswordAndClearResetToken,
  listImoveis,
  getImovel,
  saveImovel,
  deleteImovel,
  getPublicadorConfig,
  savePublicadorConfig,
};
