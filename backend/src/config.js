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
// segredo (senão todo mundo seria deslogado a cada restart). Esse arquivo
// só é confiável em disco persistente -- em produção (NODE_ENV=production),
// exigimos a variável de ambiente de verdade em vez de cair nesse arquivo:
// numa hospedagem com disco temporário (ex: Render), o arquivo pode sumir
// num reinício e gerar um segredo novo sem avisar ninguém, derrubando a
// sessão de todo mundo silenciosamente. Preferível travar a inicialização
// com uma mensagem clara a fazer isso escondido. (No render.yaml deste
// projeto, JWT_SECRET já vem definido automaticamente -- generateValue.)
function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET não está definido em produção. Defina essa variável de ambiente " +
      "(ex: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\") " +
      "em vez de deixar o servidor gerar uma sozinho -- em produção isso pode se perder " +
      "num reinício e deslogar todo mundo sem aviso."
    );
  }
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

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/seulugar";

const config = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || "development",
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  jwtSecret: resolveJwtSecret(),
  jwtExpiresDays: Number(process.env.JWT_EXPIRES_DAYS || 30),
  databaseUrl,
  // Neon, Supabase e a maioria dos Postgres gerenciados exigem SSL. Um
  // Postgres rodando na própria máquina (localhost) normalmente não tem SSL
  // configurado, então desligamos automaticamente nesse caso.
  databaseSsl: !databaseUrl.includes("localhost") && !databaseUrl.includes("127.0.0.1"),
  // Usada pelo Seu Lugar Publicador para extrair dados de anúncios com IA.
  // Sem essa variável, o botão "Extrair com IA" mostra um aviso claro em vez
  // de quebrar. Gere uma chave em console.anthropic.com → API Keys.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  // Usadas pelo fluxo de "esqueci minha senha" (envio de e-mail via Resend).
  // Sem RESEND_API_KEY, o botão mostra um aviso em vez de quebrar. O
  // endereço em RESEND_FROM precisa ser de um domínio verificado na conta
  // Resend (ou o domínio de testes deles, que só entrega pro seu próprio
  // e-mail cadastrado lá -- ok para testar, não para o time inteiro).
  resendApiKey: process.env.RESEND_API_KEY || "",
  resendFrom: process.env.RESEND_FROM || "Seu Lugar <onboarding@resend.dev>",
  // Endereço público do próprio frontend, usado para montar o link de
  // redefinição de senha dentro do e-mail (ex: https://seulugar-saas.onrender.com).
  // Sem essa variável, cai no endereço do Render que já configuramos.
  publicUrl: process.env.PUBLIC_URL || "https://seulugar-saas.onrender.com",
};

module.exports = config;
