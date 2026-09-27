// Hash de senha e tokens de sessão (JWT-like), usando só o módulo nativo
// "crypto" do Node -- sem precisar de bcrypt nem jsonwebtoken via npm.
//
// Senha: scrypt (função de hash lenta de propósito, resistente a força
// bruta), com um "sal" (salt) aleatório por senha, guardado junto do hash.
//
// Token: mesmo formato de um JWT (header.payload.assinatura em base64url),
// assinado com HMAC-SHA256. Qualquer biblioteca padrão de JWT consegue ler
// um token gerado aqui, caso você troque para uma no futuro.

const crypto = require("crypto");
const config = require("./config");

const SCRYPT_KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  const [salt, hashHex] = String(stored).split(":");
  if (!salt || !hashHex) return false;
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hashHex, "hex");
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(input) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

function sign(payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const expiresAt = Math.floor(Date.now() / 1000) + config.jwtExpiresDays * 24 * 60 * 60;
  const fullPayload = { ...payload, exp: expiresAt };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(fullPayload));
  const toSign = `${headerB64}.${payloadB64}`;
  const signature = crypto
    .createHmac("sha256", config.jwtSecret)
    .update(toSign)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${toSign}.${signature}`;
}

function verify(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signature] = parts;

  const expectedSig = crypto
    .createHmac("sha256", config.jwtSecret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString("utf8"));
  } catch (e) {
    return null;
  }

  if (!payload.exp || Math.floor(Date.now() / 1000) > payload.exp) {
    return null; // token expirado
  }
  return payload;
}

module.exports = { hashPassword, verifyPassword, sign, verify };
