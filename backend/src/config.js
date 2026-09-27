// Configuração central. Lê variáveis de ambiente com fallback para valores
// padrão que funcionam de primeira em desenvolvimento, sem nenhum setup.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");

// Tenta carregar backend/.env manualmente (sem depender do pacote "dotenv",
// que exigiria npm install). Formato simples: LINHA=valor, uma por linha.
function loadDotEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
loadDotEnv();

// Se ninguém definiu JWT_SECRET (nem no ambiente, nem no .env), geramos um
// valor aleatório na primeira execução e guardamos em backend/.jwt-secret,
// para que reinicializações do mesmo servidor continuem usando o mesmo
// segredo (senão todo mundo seria deslogado a cada restart).
function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const secretFile = path.join(ROOT, ".jwt-secret");
  if (fs.existsSync(secretFile)) {
    return fs.readFileSync(secretFile, "utf8").trim();
  }
  const generated = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  console.log(
    "[config] JWT_SECRET não definido -- gerei um novo e salvei em backend/.jwt-secret"
  );
  return generated;
}

const config = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || "development",
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  jwtSecret: resolveJwtSecret(),
  jwtExpiresDays: Number(process.env.JWT_EXPIRES_DAYS || 30),
  databaseFile: path.join(ROOT, process.env.DATABASE_FILE || "./data/seulugar.db"),
};

module.exports = config;
