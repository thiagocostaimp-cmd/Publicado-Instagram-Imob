// Envio de e-mail via Resend (resend.com) -- API simples via HTTP, sem
// precisar de um pacote extra (é só um POST). Usado hoje só pelo fluxo de
// "esqueci minha senha". Sem RESEND_API_KEY configurada, sendEmail() lança
// um erro claro em vez de falhar silenciosamente.

const config = require("./config");

async function sendEmail({ to, subject, html }) {
  if (!config.resendApiKey) {
    throw new Error("Envio de e-mail não configurado neste servidor (RESEND_API_KEY ausente).");
  }
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + config.resendApiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.resendFrom,
      to,
      subject,
      html,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error((data && data.message) || "Falha ao enviar e-mail (HTTP " + resp.status + ").");
  }
  return data;
}

module.exports = { sendEmail };
