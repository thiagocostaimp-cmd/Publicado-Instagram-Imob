// Rotas do "Seu Lugar Publicador" -- a tela de montar capa, carrossel e
// legenda de cada imóvel. Portado de um Claude Artifact (que rodava dentro
// do claude.ai e usava capacidades exclusivas de lá: banco, armazenamento de
// arquivo, IA e conectores embutidos). Aqui, cada uma dessas capacidades
// virou uma peça real:
//   - banco de dados do Artifact  -> tabelas "imoveis" e "publicador_config" (db.js)
//   - armazenamento de imagens    -> Cloudinary, direto do navegador (não passa por aqui)
//   - IA para extrair dados       -> API da Anthropic, chamada abaixo
// A publicação automática no Instagram (que usava um conector Zapier só
// disponível dentro do claude.ai) fica de fora por enquanto -- ver README.

const Anthropic = require("@anthropic-ai/sdk");
const db = require("./db");
const config = require("./config");
const { requireAuthUser } = require("./auth-helpers");

const anthropic = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;

const DEFAULT_CONFIG = {
  nome_marca: "Seu Lugar",
  slogan: "Imobiliária Descomplicada",
  cidade_estado: "LAVRAS/MG",
  cor_vermelho: "#9e0000",
  cor_preto: "#000000",
  cor_branco: "#ffffff",
  legenda_template:
    "🏠 Locação: {tipo_imovel} no {bairro}\n\n🔑 Código do Imóvel: {codigo_unico}\n\n🛏️ {numero_quartos} {quartos_label} | 🚿 {numero_banheiros} {banheiros_label} | 🚗 {numero_vagas} {vagas_label} | 📐 {metragem}m²\n\n💰 Preço de Locação R${valor_aluguel}/mês\n💰 Condomínio: R${valor_condominio}/mês\n💰 IPTU R${valor_iptu}\n\n✨ Benefícios Exclusivos:\n✅ Seguro Fiança e Incêndio\n✅ Cobertura de IPTU\n✅ Cobertura contra incêndio, vendaval, danos elétricos;\n\n📲 Comente \"Alugar\" ou chame no direct para saber mais!",
  pool_hashtags: [
    "#SeuLugar", "#SemFiador", "#AluguelDigital", "#LavrasMG", "#12Horas",
    "#Autonomia", "#ImobiliariaDigital", "#Agilidade", "#MudancaRapida",
    "#Lavras", "#AtendimentoHumanizado", "#SeguroFianca", "#LocacaoSemFiador",
  ],
  max_hashtags_por_post: 15,
  cta_final: 'Comente "Alugar"',
  instagram_username: "",
  cloudinary_cloud_name: "",
  cloudinary_upload_preset: "",
  logo_url: "",
};

function register(router) {
  /* ---- Imóveis ---- */
  router.get("/api/imoveis", async (req, res) => {
    const user = await requireAuthUser(req, res);
    if (!user) return;
    const imoveis = await db.listImoveis(user.organizationId);
    return res.json(200, { imoveis });
  });

  router.get("/api/imoveis/:id", async (req, res) => {
    const user = await requireAuthUser(req, res);
    if (!user) return;
    const imovel = await db.getImovel(user.organizationId, req.params.id);
    if (!imovel) return res.json(404, { error: "Imóvel não encontrado." });
    return res.json(200, { imovel });
  });

  router.post("/api/imoveis", async (req, res) => {
    const user = await requireAuthUser(req, res);
    if (!user) return;
    const imovel = await db.saveImovel(user.organizationId, null, req.body || {});
    return res.json(201, { imovel });
  });

  router.post("/api/imoveis/:id", async (req, res) => {
    const user = await requireAuthUser(req, res);
    if (!user) return;
    const imovel = await db.saveImovel(user.organizationId, req.params.id, req.body || {});
    if (!imovel) return res.json(404, { error: "Imóvel não encontrado." });
    return res.json(200, { imovel });
  });

  router.delete("/api/imoveis/:id", async (req, res) => {
    const user = await requireAuthUser(req, res);
    if (!user) return;
    await db.deleteImovel(user.organizationId, req.params.id);
    return res.json(200, { ok: true });
  });

  /* ---- Configuração ---- */
  router.get("/api/publicador/config", async (req, res) => {
    const user = await requireAuthUser(req, res);
    if (!user) return;
    const saved = await db.getPublicadorConfig(user.organizationId);
    return res.json(200, { config: Object.assign({}, DEFAULT_CONFIG, saved || {}) });
  });

  router.post("/api/publicador/config", async (req, res) => {
    const user = await requireAuthUser(req, res);
    if (!user) return;
    await db.savePublicadorConfig(user.organizationId, req.body || {});
    return res.json(200, { ok: true });
  });

  /* ---- Ler o link do anúncio automaticamente ---- */
  router.post("/api/publicador/ler-link", async (req, res) => {
    const user = await requireAuthUser(req, res);
    if (!user) return;
    const { link } = req.body || {};
    if (!link || !/^https?:\/\/\S+/i.test(link)) {
      return res.json(400, { error: "Informe um link válido (começando com http:// ou https://)." });
    }
    try {
      const texto = await lerConteudoDaPagina(String(link));
      return res.json(200, { texto });
    } catch (err) {
      console.error("Erro ao ler link:", err);
      return res.json(502, { error: err.message || "Não foi possível ler essa página." });
    }
  });

  /* ---- Extração de dados por IA ---- */
  router.post("/api/publicador/extrair-ia", async (req, res) => {
    const user = await requireAuthUser(req, res);
    if (!user) return;
    if (!anthropic) {
      return res.json(503, {
        error: "IA não configurada neste servidor. Peça ao administrador para configurar ANTHROPIC_API_KEY.",
      });
    }
    const { texto, link } = req.body || {};
    if (!texto || !String(texto).trim()) {
      return res.json(400, { error: "Envie o texto do anúncio." });
    }
    try {
      const data = await extrairComIA(String(texto), link ? String(link) : "");
      return res.json(200, { data });
    } catch (err) {
      console.error("Erro na extração por IA:", err);
      return res.json(502, { error: "Não foi possível extrair os dados com IA. Tente novamente." });
    }
  });
}

// Busca a página do anúncio e devolve só o texto visível (sem tags, script,
// style etc.), pronto para a IA ler. Não usa nenhum serviço pago -- é um
// fetch simples com um User-Agent de navegador de verdade (muitos sites
// bloqueiam o User-Agent padrão de bibliotecas/robôs). Funciona bem em sites
// que renderizam o conteúdo no servidor; sites que só montam a página via
// JavaScript no navegador (client-side rendering) não vão funcionar aqui --
// nesse caso, a pessoa ainda pode copiar e colar o texto manualmente.
async function lerConteudoDaPagina(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let resp;
  try {
    resp = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        Accept: "text/html,application/xhtml+xml",
      },
    });
  } catch (err) {
    if (err.name === "AbortError") throw new Error("A página demorou demais para responder.");
    throw new Error("Não consegui acessar esse link.");
  } finally {
    clearTimeout(timeout);
  }
  if (!resp.ok) {
    throw new Error("A página respondeu com erro (HTTP " + resp.status + "). Alguns sites bloqueiam acesso automatizado -- copie o texto manualmente nesse caso.");
  }
  const contentType = resp.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw new Error("Esse link não parece apontar para uma página web (HTML).");
  }
  const html = await resp.text();
  const texto = htmlParaTexto(html);
  if (!texto || texto.length < 40) {
    throw new Error("Não encontrei texto legível nessa página -- ela pode montar o conteúdo via JavaScript. Copie o texto manualmente.");
  }
  return texto.slice(0, 15000);
}

const HTML_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  atilde: "ã", otilde: "õ", ccedil: "ç", ecirc: "ê", ocirc: "ô",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  Atilde: "Ã", Otilde: "Õ", Ccedil: "Ç", Ecirc: "Ê", Ocirc: "Ô",
};

function htmlParaTexto(html) {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (m, code) => String.fromCodePoint(Number(code)))
    .replace(/&(\w+);/g, (m, name) => (name in HTML_ENTITIES ? HTML_ENTITIES[name] : m));
  text = text.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  return text;
}

async function extrairComIA(textoBruto, linkOrigem) {
  const linkLine = linkOrigem
    ? "Link do anúncio, apenas para referência (o conteúdo da página não pode ser acessado a partir dele): " + linkOrigem + "\n\n"
    : "";
  const prompt =
    "Você é um assistente que extrai dados estruturados de anúncios de imóveis para aluguel no Brasil.\n" +
    "Leia o texto abaixo (pode ser uma descrição de CRM, um anúncio ou o texto de uma página de imóvel) e devolva APENAS um JSON, sem comentários, com exatamente estes campos:\n\n" +
    "{\n" +
    '  "tipo_imovel": string (ex: "Apartamento", "Casa", "Kitnet", "Sobrado"),\n' +
    '  "bairro": string,\n' +
    '  "cidade_estado": string (ex: "Lavras/MG"),\n' +
    '  "numero_quartos": number,\n' +
    '  "numero_banheiros": number,\n' +
    '  "numero_vagas": number,\n' +
    '  "numero_cozinhas": number (quantidade de cozinhas, use 1 se não mencionado),\n' +
    '  "metragem": number (m², apenas o número),\n' +
    '  "valor_aluguel": number (apenas o número em reais, sem R$ e sem separador de milhar, use ponto para centavos),\n' +
    '  "valor_condominio": number (0 se não mencionado),\n' +
    '  "valor_iptu": number (0 se não mencionado),\n' +
    '  "codigo_unico": string (código ou referência do imóvel, "" se não houver)\n' +
    "}\n\n" +
    'Se algum campo não aparecer no texto, use um valor padrão razoável (0 para números, "" para texto). Nunca invente um código.\n\n' +
    "ATENÇÃO: o texto pode conter, além do anúncio principal, trechos de \"imóveis semelhantes\" ou uma lista de resultados de busca. Extraia os dados APENAS do imóvel PRINCIPAL (normalmente o que aparece no título/cabeçalho) e ignore por completo quaisquer outros imóveis listados como sugestão.\n\n" +
    linkLine +
    'TEXTO:\n"""\n' + textoBruto + '\n"""';

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });
  const text = (msg.content || [])
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Resposta da IA sem JSON reconhecível: " + text.slice(0, 200));
  return JSON.parse(match[0]);
}

module.exports = { register };
