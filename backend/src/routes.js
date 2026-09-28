const crypto = require("crypto");
const db = require("./db");
const auth = require("./auth");
const config = require("./config");
const email = require("./email");
const { setSessionCookie, clearSessionCookie } = require("./http-helpers");
const { requireAuthUser: requireAuth } = require("./auth-helpers");

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    if (await db.findUserByEmail(email)) {
      return res.json(409, { error: "Já existe uma conta com este e-mail." });
    }

    const passwordHash = auth.hashPassword(password);
    const { user } = await db.createOrganizationWithAdmin({
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
    const user = await db.findUserByEmail(email);
    if (!user || !auth.verifyPassword(password, user.passwordHash)) {
      return res.json(401, { error: invalidMsg });
    }

    const token = auth.sign({ userId: user.id });
    setSessionCookie(res.raw, token);
    return res.json(200, { user: publicUser(user) });
  });

  // "Esqueci minha senha" -- pede o e-mail, gera um link de redefinição e
  // manda por e-mail (via Resend). Sempre responde com sucesso, exista ou
  // não uma conta com esse e-mail -- senão dá pra usar esta rota para
  // descobrir quais e-mails têm conta no sistema (enumeração de usuários).
  router.post("/api/auth/esqueci-senha", async (req, res) => {
    const { email: emailInformado } = req.body || {};
    if (!emailInformado || !EMAIL_RE.test(emailInformado)) {
      return res.json(400, { error: "Informe um e-mail válido." });
    }
    const respostaGenerica = {
      ok: true,
      message: "Se esse e-mail tiver uma conta, enviamos um link de redefinição de senha.",
    };
    const user = await db.findUserByEmail(emailInformado);
    if (!user) return res.json(200, respostaGenerica); // não revela se o e-mail existe ou não

    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
    await db.setResetToken(user.id, tokenHash, expiresAt);

    const link = config.publicUrl + "/redefinir-senha.html?token=" + token;
    try {
      await email.sendEmail({
        to: user.email,
        subject: "Redefinir senha -- Seu Lugar",
        html:
          "<p>Olá, " + user.name + ".</p>" +
          "<p>Alguém (esperamos que você) pediu para redefinir a senha da sua conta no painel do Seu Lugar.</p>" +
          '<p><a href="' + link + '">Clique aqui para criar uma senha nova</a></p>' +
          "<p>Esse link vale por 1 hora. Se você não pediu isso, pode ignorar este e-mail -- sua senha continua a mesma.</p>",
      });
    } catch (err) {
      console.error("Falha ao enviar e-mail de redefinição de senha:", err);
      return res.json(502, {
        error: "Não foi possível enviar o e-mail agora. Peça ao administrador para redefinir sua senha manualmente pela aba Time.",
      });
    }
    return res.json(200, respostaGenerica);
  });

  router.post("/api/auth/redefinir-senha", async (req, res) => {
    const { token, password } = req.body || {};
    if (!token || !password) {
      return res.json(400, { error: "Link inválido." });
    }
    if (String(password).length < 8) {
      return res.json(400, { error: "A senha precisa ter pelo menos 8 caracteres." });
    }
    const tokenHash = crypto.createHash("sha256").update(String(token)).digest("hex");
    const user = await db.findUserByValidResetTokenHash(tokenHash);
    if (!user) {
      return res.json(400, { error: "Esse link expirou ou já foi usado. Peça um novo em \"Esqueci minha senha\"." });
    }
    const passwordHash = auth.hashPassword(password);
    await db.updatePasswordAndClearResetToken(user.id, passwordHash);
    return res.json(200, { ok: true });
  });

  router.post("/api/auth/logout", async (req, res) => {
    clearSessionCookie(res.raw);
    return res.json(200, { ok: true });
  });

  router.get("/api/auth/me", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const org = await db.findOrganizationById(user.organizationId);
    return res.json(200, {
      user: { ...publicUser(user), organization: org ? { id: org.id, name: org.name } : null },
    });
  });

  // Lista todo mundo da mesma organização de quem está logado.
  router.get("/api/team", async (req, res) => {
    const user = await requireAuth(req, res);
    if (!user) return;
    const users = await db.listUsersByOrganization(user.organizationId);
    return res.json(200, { users: users.map(publicUser) });
  });

  // Só admin cria login/senha para uma nova pessoa do time. A senha inicial
  // é definida aqui pelo admin -- ainda não há envio de e-mail de convite
  // configurado (veja o README, "Próximos passos" para adicionar isso).
  router.post("/api/team", async (req, res) => {
    const user = await requireAuth(req, res);
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
    if (await db.findUserByEmail(email)) {
      return res.json(409, { error: "Já existe uma conta com este e-mail." });
    }

    const finalRole = role === "admin" ? "admin" : "member";
    const passwordHash = auth.hashPassword(password);
    const newUser = await db.createUser({
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
    const user = await requireAuth(req, res);
    if (!user) return;
    if (!requireAdmin(user, res)) return;

    const target = await db.findUserById(req.params.id);
    if (!target || target.organizationId !== user.organizationId) {
      return res.json(404, { error: "Usuário não encontrado." });
    }
    if (target.id === user.id) {
      return res.json(400, { error: "Você não pode remover sua própria conta por aqui." });
    }
    await db.deleteUser(target.id);
    return res.json(200, { ok: true });
  });

  router.get("/api/health", async (req, res) => res.json(200, { ok: true }));
}

module.exports = { register };
