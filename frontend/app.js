// Front-end simples, sem framework nem build step -- roda direto no
// navegador. Toda comunicação com a API vai com "credentials: include" para
// o cookie de sessão (HttpOnly) ser enviado automaticamente.

const API_BASE = window.API_BASE;

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    credentials: "include",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch (e) {
    // resposta vazia (ex: 204) -- ok
  }
  if (!res.ok) {
    const err = new Error(data.error || `Erro (status ${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---- Elementos ----
const authView = document.getElementById("auth-view");
const appView = document.getElementById("app-view");
const authError = document.getElementById("auth-error");
const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const forgotForm = document.getElementById("forgot-form");

let currentUser = null;

function showAuthError(msg) {
  authError.textContent = msg;
  authError.hidden = !msg;
}

// ---- Tabs de login/registro ----
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    showAuthError("");
    const isLogin = btn.dataset.tab === "login";
    loginForm.hidden = !isLogin;
    registerForm.hidden = isLogin;
    forgotForm.hidden = true;
  });
});

document.getElementById("link-esqueci-senha").addEventListener("click", (e) => {
  e.preventDefault();
  showAuthError("");
  loginForm.hidden = true;
  registerForm.hidden = true;
  forgotForm.hidden = false;
});
document.getElementById("link-voltar-login").addEventListener("click", (e) => {
  e.preventDefault();
  showAuthError("");
  forgotForm.hidden = true;
  loginForm.hidden = false;
});

forgotForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showAuthError("");
  const emailEl = document.getElementById("forgot-email");
  try {
    const { message } = await api("/api/auth/esqueci-senha", {
      method: "POST",
      body: { email: emailEl.value.trim() },
    });
    forgotForm.innerHTML = '<p class="hint">' + message + "</p>";
  } catch (err) {
    showAuthError(err.message);
  }
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showAuthError("");
  try {
    const { user } = await api("/api/auth/login", {
      method: "POST",
      body: {
        email: document.getElementById("login-email").value.trim(),
        password: document.getElementById("login-password").value,
      },
    });
    currentUser = user;
    await enterApp();
  } catch (err) {
    showAuthError(err.message);
  }
});

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showAuthError("");
  try {
    const { user } = await api("/api/auth/register-organization", {
      method: "POST",
      body: {
        organizationName: document.getElementById("reg-org").value.trim(),
        name: document.getElementById("reg-name").value.trim(),
        email: document.getElementById("reg-email").value.trim(),
        password: document.getElementById("reg-password").value,
      },
    });
    currentUser = user;
    await enterApp();
  } catch (err) {
    showAuthError(err.message);
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  currentUser = null;
  appView.hidden = true;
  authView.hidden = false;
});

// ---- Navegação dentro do app ----
document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    // "Publicador" é uma página separada (própria aplicação, com seu próprio
    // JS grande) -- navega de verdade em vez de só trocar de aba dentro desta SPA.
    if (btn.dataset.page === "publicador") {
      window.location.href = "publicador.html";
      return;
    }
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("page-dashboard").hidden = btn.dataset.page !== "dashboard";
    document.getElementById("page-team").hidden = btn.dataset.page !== "team";
    if (btn.dataset.page === "team") loadTeam();
  });
});

async function enterApp() {
  const meRes = await api("/api/auth/me");
  currentUser = meRes.user;

  authView.hidden = true;
  appView.hidden = false;

  document.getElementById("who-org").textContent = currentUser.organization?.name || "";
  document.getElementById("who-name").textContent = currentUser.name;
  document.getElementById("who-role").textContent =
    currentUser.role === "admin" ? "admin" : "membro";

  // Só admin pode criar/remover contas do time.
  document.getElementById("team-add-card").hidden = currentUser.role !== "admin";
}

async function loadTeam() {
  const tbody = document.getElementById("team-table-body");
  tbody.innerHTML = "<tr><td colspan='4'>Carregando...</td></tr>";
  try {
    const { users } = await api("/api/team");
    tbody.innerHTML = "";
    users.forEach((u) => {
      const tr = document.createElement("tr");
      const canDelete = currentUser.role === "admin" && u.id !== currentUser.id;
      tr.innerHTML = `
        <td>${escapeHtml(u.name)}</td>
        <td>${escapeHtml(u.email)}</td>
        <td>${u.role === "admin" ? "Admin" : "Membro"}</td>
        <td class="row-actions">
          ${canDelete ? `<button class="btn btn-danger" data-remove="${u.id}" style="padding:4px 10px;font-size:0.78rem;">Remover</button>` : ""}
        </td>
      `;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll("[data-remove]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Remover o acesso desta pessoa?")) return;
        await api(`/api/team/${btn.dataset.remove}`, { method: "DELETE" });
        loadTeam();
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4">${escapeHtml(err.message)}</td></tr>`;
  }
}

document.getElementById("team-add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("team-error");
  errEl.hidden = true;
  try {
    await api("/api/team", {
      method: "POST",
      body: {
        name: document.getElementById("team-name").value.trim(),
        email: document.getElementById("team-email").value.trim(),
        password: document.getElementById("team-password").value,
      },
    });
    e.target.reset();
    loadTeam();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// ---- Ao carregar a página, ver se já tem sessão válida (cookie) ----
(async function init() {
  try {
    await enterApp();
  } catch (e) {
    // Sem sessão válida -- fica na tela de login/registro mesmo.
  }
})();
