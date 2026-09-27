// Verificação de login compartilhada entre routes.js e publicador-routes.js
// -- extraída para não duplicar a mesma lógica (ler o cookie de sessão,
// validar o token, carregar o usuário) em dois arquivos.

const db = require("./db");
const auth = require("./auth");

async function requireAuthUser(req, res) {
  const payload = auth.verify(req.sessionToken);
  if (!payload) {
    res.json(401, { error: "Não autenticado." });
    return null;
  }
  const user = await db.findUserById(payload.userId);
  if (!user) {
    res.json(401, { error: "Sessão inválida." });
    return null;
  }
  return user;
}

module.exports = { requireAuthUser };
