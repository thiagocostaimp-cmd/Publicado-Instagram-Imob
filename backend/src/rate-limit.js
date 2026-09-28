// Limite de tentativas bem simples, em memória (não precisa de tabela nova
// no banco nem de outro serviço externo). Funciona bem para o tamanho deste
// projeto (um único processo Node no Render) -- não sobrevive a um
// reinício do servidor nem escala para múltiplas instâncias, mas isso é
// aceitável aqui: o objetivo é dificultar um script tentando adivinhar
// senha ou inundar alguém de e-mail de redefinição, não é uma defesa contra
// um ataque distribuído de verdade.

const buckets = new Map();

// key: identifica o que está sendo limitado (ex: "login:fulano@email.com").
// Devolve {allowed:true} ou {allowed:false, retryAfterSeconds}.
function checkRateLimit(key, maxAttempts, windowMs) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count++;
  if (bucket.count > maxAttempts) {
    return { allowed: false, retryAfterSeconds: Math.ceil((windowMs - (now - bucket.start)) / 1000) };
  }
  return { allowed: true };
}

// Libera as tentativas de uma chave assim que der certo (ex: login
// correto) -- assim um erro de digitação antigo não continua contando
// contra a pessoa depois que ela já conseguiu entrar.
function resetRateLimit(key) {
  buckets.delete(key);
}

// Limpeza periódica -- sem isso, "buckets" cresceria pra sempre com uma
// entrada por e-mail já tentado, mesmo horas depois da janela ter expirado.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.start > 60 * 60 * 1000) buckets.delete(key);
  }
}, 10 * 60 * 1000).unref();

module.exports = { checkRateLimit, resetRateLimit };
