// Camada de banco de dados. Usa o módulo nativo node:sqlite (Node 22.5+),
// então não precisa de "npm install" para funcionar. É um recurso ainda
// experimental do Node -- funciona bem para começar, mas antes de vender
// para várias imobiliárias ao mesmo tempo (mais de um servidor, mais
// escrita simultânea), troque para Postgres. Veja o README, seção
// "Migrando para produção" -- as funções abaixo foram escritas para que
// essa troca não exija mexer nas rotas, só neste arquivo.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const config = require("./config");

fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });

const db = new DatabaseSync(config.databaseFile);
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    organization_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(id)
  );
`);

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

// Cria a organização e a primeira conta (admin) numa única operação --
// ou as duas coisas acontecem, ou nenhuma (evita organização "órfã" sem
// nenhum usuário se algo falhar no meio).
function createOrganizationWithAdmin({ organizationName, name, email, passwordHash }) {
  const orgId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const createdAt = nowIso();

  const insertOrg = db.prepare(
    "INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)"
  );
  const insertUser = db.prepare(
    `INSERT INTO users (id, name, email, password_hash, role, organization_id, created_at)
     VALUES (?, ?, ?, ?, 'admin', ?, ?)`
  );

  insertOrg.run(orgId, organizationName, createdAt);
  insertUser.run(userId, name, email, passwordHash, orgId, createdAt);

  return {
    organization: { id: orgId, name: organizationName, createdAt },
    user: rowToUser(db.prepare("SELECT * FROM users WHERE id = ?").get(userId)),
  };
}

function findUserByEmail(email) {
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  return rowToUser(row);
}

function findUserById(id) {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  return rowToUser(row);
}

function findOrganizationById(id) {
  return db.prepare("SELECT * FROM organizations WHERE id = ?").get(id) || null;
}

function listUsersByOrganization(organizationId) {
  const rows = db
    .prepare("SELECT * FROM users WHERE organization_id = ? ORDER BY created_at ASC")
    .all(organizationId);
  return rows.map(rowToUser);
}

function createUser({ name, email, passwordHash, role, organizationId }) {
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, role, organization_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, email, passwordHash, role, organizationId, createdAt);
  return findUserById(id);
}

function deleteUser(id) {
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}

module.exports = {
  createOrganizationWithAdmin,
  findUserByEmail,
  findUserById,
  findOrganizationById,
  listUsersByOrganization,
  createUser,
  deleteUser,
};
