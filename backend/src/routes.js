const db = require("./db");
const auth = require("./auth");
const { setSessionCookie, clearSessionCookie } = require("./http-helpers");

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Middleware (no sentido de "função que roda antes da rota") que exige login
// válido. Lê o token do cookie (já colocado em req.sessionToken pelo server),
// verifica a assinatura/validade, carrega o usuário do banco e guarda em
// req.user para as rotas usarem.
function requireAuth(req, res) {
  const payload = auth.verify(req.sessionToken);
  if (!payload) {
    res.json(401, { error: "Não autenticado." });
    return null;
  }
  const user = db.findUserById(payload.userId);
  if (!user) {
    res.json(401, { error: "Sessão inválida." });
    return null;
  }
  return user;
}

function requireAdmin(user, res) {
  if (user.role !== "admin") {
    res.json(403, { error: "Apenas administradores podem fazer isso." });
    return false;
  }
  return true;
}

function register(router) {
  // Cria a imobiliária (organização) e a primeira conta, que é sempre admin.
  // Passo único de "criar a empresa no sistema" -- novas pessoas do time
  // entram depois pela rota /team, nunca por aqui.
  router.post("/api/auth/register-organization", async (req, res) => {
    const { organizationName, name, email, password } = req.body || {};

    if (!organizationName || !name || !email || !password) {
      return res.json(400, {
        error: "Preencha o nome da imobiliária, seu nome, e-mail e senha.",
      });
    }
    if (!EMAIL_RE.test(email)) {
      return res.json(400, { error: "E-mail inválido." });
    }
    if (String(password).length < 8) {
      return res.json(400, { error: "A senha precisa ter pelo menos 8 caracteres." });
    }
    if (db.findUserByEmail(email)) {
      return res.json(409, { error: "Já existe uma conta com este e-mail." });
    }

    const passwordHash = auth.hashPassword(password);
    const { user } = db.createOrganizationWithAdmin({
      organizationName,
      name,
      email,
      passwordHash,
    });

    const token = auth.sign({ userId: user.id });
    setSessionCookie(res.raw, token);
    return res.json(201, { user: publicUser(user) });
  });

  router.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.json(400, { error: "Informe e-mail e senha." });
    }

    const invalidMsg = "E-mail ou senha incorretos.";
    const user = db.findUserByEmail(email);
    if (!user || !auth.verifyPassword(password, user.passwordHash)) {
      return res.json(401, { error: invalidMsg });
    }

    const token = auth.sign({ userId: user.id });
    setSessionCookie(res.raw, token);
    return res.json(200, { user: publicUser(user) });
  });

  router.post("/api/auth/logout", async (req, res) => {
    clearSessionCookie(res.raw);
    return res.json(200, { ok: true });
  });

  router.get("/api/auth/me", async (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const org = db.findOrganizationById(user.organizationId);
    return res.json(200, {
      user: { ...publicUser(user), organization: org ? { id: org.id, name: org.name } : null },
    });
  });

  // Lista todo mundo da mesma organização de quem está logado.
  router.get("/api/team", async (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    const users = db.listUsersByOrganization(user.organizationId);
    return res.json(200, { users: users.map(publicUser) });
  });

  // Só admin cria login/senha para uma nova pessoa do time. A senha inicial
  // é definida aqui pelo admin -- ainda não há envio de e-mail de convite
  // configurado (veja o README, "Próximos passos" para adicionar isso).
  router.post("/api/team", async (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    if (!requireAdmin(user, res)) return;

    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password) {
      return res.json(400, { error: "Preencha nome, e-mail e senha." });
    }
    if (!EMAIL_RE.test(email)) {
      return res.json(400, { error: "E-mail inválido." });
    }
    if (String(password).length < 8) {
      return res.json(400, { error: "A senha precisa ter pelo menos 8 caracteres." });
    }
    if (db.findUserByEmail(email)) {
      return res.json(409, { error: "Já existe uma conta com este e-mail." });
    }

    const finalRole = role === "admin" ? "admin" : "member";
    const passwordHash = auth.hashPassword(password);
    const newUser = db.createUser({
      name,
      email,
      passwordHash,
      role: finalRole,
      organizationId: user.organizationId,
    });
    return res.json(201, { user: publicUser(newUser) });
  });

  // Remove o acesso de alguém do time. Não deixa remover a própria conta por
  // aqui, para a organização nunca ficar sem nenhum admin por acidente.
  router.delete("/api/team/:id", async (req, res) => {
    const user = requireAuth(req, res);
    if (!user) return;
    if (!requireAdmin(user, res)) return;

    const target = db.findUserById(req.params.id);
    if (!target || target.organizationId !== user.organizationId) {
      return res.json(404, { error: "Usuário não encontrado." });
    }
    if (target.id === user.id) {
      return res.json(400, { error: "Você não pode remover sua própria conta por aqui." });
    }
    db.deleteUser(target.id);
    return res.json(200, { ok: true });
  });

  router.get("/api/health", async (req, res) => res.json(200, { ok: true }));
}

module.exports = { register };
