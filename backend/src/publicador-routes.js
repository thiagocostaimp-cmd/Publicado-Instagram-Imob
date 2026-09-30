// Rotas do "Seu Lugar Publicador" -- a tela de montar capa, carrossel e
// legenda de cada imóvel. Portado de um Claude Artifact (que rodava dentro
// do claude.ai e usava capacidades exclusivas de lá: banco, armazenamento de
// arquivo, IA e conectores embutidos). Aqui, cada uma dessas capacidades
// virou uma peça real:
//   - banco de dados do Artifact  -> tabelas "imoveis" e "publicador_config" (db.js)
//   - armazenamento de imagens    -> Cloudinary, direto do navegador (não passa por aqui)
//   - IA para extrair dados       -> API da Anthropic, chamada abaixo
//   - publicar no Instagram       -> API do Instagram (login direto do Instagram,
//     graph.instagram.com -- não a Graph API "clássica" via Página do Facebook),
//     chamada abaixo. Antes usava um conector Zapier só disponível dentro do claude.ai.

const GRAPH_API_HOST = "https://graph.instagram.com";
const GRAPH_API_VERSION = "v21.0";
const MAX_MIDIAS_POST_IG = 10; // limite do próprio Instagram por publicação

const Anthropic = require("@anthropic-ai/sdk");
const db = require("./db");
const config = require("./config");
const { requireAuthUser, requireAdmin } = require("./auth-helpers");

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
  // ID da conta comercial do Instagram (Instagram Business Account ID) e o
  // token de acesso (Page Access Token) usados para publicar de verdade via
  // Instagram Graph API. O token nunca é devolvido pelo GET -- veja
  // redactConfig() abaixo.
  instagram_business_account_id: "",
  instagram_access_token: "",
  // Quando o token foi definido/renovado pela última vez -- usado para saber
  // quando é hora de renovar sozinho (ver talvezRenovarTokenInstagram).
  instagram_access_token_updated_at: "",
};

// O token de acesso do Instagram (API "com login do Instagram") dura ~60
// dias e pode ser renovado a qualquer momento depois de passar 24h da
// última renovação, ganhando outros ~60 dias -- sem precisar que ninguém
// gere um token novo na mão. Como este servidor roda no plano gratuito do
// Render (que "dorme" sem uso, então um cron job de verdade não é confiável
// aqui), a renovação acontece de um jeito mais simples: sempre que alguém
// abre a tela de Configurações do Publicador (o que uma equipe de vendas
// ativa faz com frequência de sobra), verificamos se já faz tempo desde a
// última renovação e, se sim, renovamos na hora. Foi escolhida uma margem
// de 45 dias (bem antes dos 60) para sobrar folga mesmo em períodos de
// pouco uso do painel.
const INSTAGRAM_TOKEN_RENOVAR_APOS_DIAS = 45;

async function talvezRenovarTokenInstagram(organizationId, cfg) {
  if (!cfg.instagram_access_token) return cfg;
  const atualizadoEm = cfg.instagram_access_token_updated_at ? new Date(cfg.instagram_access_token_updated_at) : null;
  const dias = atualizadoEm ? (Date.now() - atualizadoEm.getTime()) / 86400000 : Infinity;
  if (dias < INSTAGRAM_TOKEN_RENOVAR_APOS_DIAS) return cfg;

  try {
    const resp = await fetch(
      GRAPH_API_HOST + "/refresh_access_token?grant_type=ig_refresh_token&access_token=" +
      encodeURIComponent(cfg.instagram_access_token)
    );
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.access_token) {
      throw new Error((data.error && data.error.message) || "resposta sem access_token");
    }
    const camposNovos = {
      instagram_access_token: data.access_token,
      instagram_access_token_updated_at: new Date().toISOString(),
    };
    const novaConfig = Object.assign({}, cfg, camposNovos);
    // Merge parcial (só esses 2 campos), não um save da config inteira --
    // isso roda como efeito colateral de um GET, então não pode arriscar
    // apagar por cima uma mudança de verdade que alguém salvou (POST) bem
    // nesse meio-tempo.
    await db.mergePublicadorConfig(organizationId, camposNovos);
    console.log("[instagram] token renovado automaticamente para a organização", organizationId);
    return novaConfig;
  } catch (err) {
    // Não derruba a tela por causa disso -- só loga. Se o token realmente
    // tiver expirado (ninguém abriu o painel por mais de 60 dias seguidos),
    // a publicação volta a falhar com uma mensagem clara, e alguém precisa
    // gerar um token novo manualmente (mesmo processo do guia inicial).
    console.error("[instagram] falha ao renovar token automaticamente:", err.message);
    return cfg;
  }
}

// O token de acesso do Instagram é um segredo (quem tiver ele consegue
// publicar na conta de verdade) -- nunca devolvemos o valor guardado para o
// navegador, só um sinalizador dizendo se já está configurado. Assim, o
// campo na tela de Configurações fica sempre em branco por padrão (troca
// exige digitar um valor novo; deixar em branco no salvamento mantém o
// token que já estava guardado -- ver rota POST /api/publicador/config).
function redactConfig(cfg) {
  const out = Object.assign({}, cfg);
  out.instagram_access_token_configurado = !!cfg.instagram_access_token;
  delete out.instagram_access_token;
  return out;
}

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
    let merged = Object.assign({}, DEFAULT_CONFIG, saved || {});
    merged = await talvezRenovarTokenInstagram(user.organizationId, merged);
    return res.json(200, { config: redactConfig(merged) });
  });

  router.post("/api/publicador/config", async (req, res) => {
    const user = await requireAuthUser(req, res);
    if (!user) return;
    if (!requireAdmin(user, res)) return;
    const body = Object.assign({}, req.body || {});
    delete body.instagram_access_token_configurado; // campo só de leitura, nunca deve ser salvo
    const existing = await db.getPublicadorConfig(user.organizationId);
    if (!body.instagram_access_token) {
      // Não veio um token novo no formulário -- preserva o que já estava
      // guardado, em vez de apagar (o navegador nunca recebe o valor real
      // de volta, então "em branco" aqui normalmente só significa "a pessoa
      // não mexeu nesse campo", não "quero remover o token").
      body.instagram_access_token = (existing && existing.instagram_access_token) || "";
      body.instagram_access_token_updated_at = (existing && existing.instagram_access_token_updated_at) || "";
    } else {
      // Token novo digitado por alguém -- reinicia a contagem dos 45 dias
      // para a renovação automática.
      body.instagram_access_token_updated_at = new Date().toISOString();
    }
    await db.savePublicadorConfig(user.organizationId, body);
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
    if (!ehUrlPublicaSegura(link)) {
      return res.json(400, { error: "Esse link não pode ser lido automaticamente. Copie o texto da página e cole manualmente." });
    }
    try {
      // Links do próprio sistema da imobiliária (app.seulugar.imb.br/property/<código>)
      // têm uma API pública por trás que devolve os dados já estruturados --
      // muito mais rápido e confiável que ler a página (que nesse site é só
      // uma casca em branco montada via JavaScript) e mandar pra IA adivinhar.
      const direto = await buscarDadosEstruturadosSeuLugar(String(link));
      if (direto) return res.json(200, direto);

      const texto = await lerConteudoDaPagina(String(link));
      return res.json(200, { texto });
    } catch (err) {
      console.error("Erro ao ler link:", err);
      return res.json(502, { error: err.message || "Não foi possível ler essa página." });
    }
  });

  /* ---- Publicar no Instagram ---- */
  router.post("/api/imoveis/:id/publicar-instagram", async (req, res) => {
    const user = await requireAuthUser(req, res);
    if (!user) return;
    const imovel = await db.getImovel(user.organizationId, req.params.id);
    if (!imovel) return res.json(404, { error: "Imóvel não encontrado." });

    const saved = await db.getPublicadorConfig(user.organizationId);
    let cfg = Object.assign({}, DEFAULT_CONFIG, saved || {});
    cfg = await talvezRenovarTokenInstagram(user.organizationId, cfg);
    if (!cfg.instagram_access_token || !cfg.instagram_business_account_id) {
      return res.json(400, {
        error: "Configure o token de acesso e o ID da conta do Instagram em Configurações antes de publicar.",
      });
    }

    const midias = [];
    if (imovel.capa_feed_url) midias.push(imovel.capa_feed_url);
    (imovel.fotos_carrossel || []).forEach((f) => { if (f && f.url) midias.push(f.url); });
    if (!midias.length) {
      return res.json(400, { error: "Gere a capa (e o carrossel, se quiser) antes de publicar." });
    }
    if (midias.length > MAX_MIDIAS_POST_IG) {
      return res.json(400, {
        error: "O Instagram aceita no máximo " + MAX_MIDIAS_POST_IG + " fotos por publicação, e este imóvel tem " + midias.length + ". Remova algumas fotos do carrossel e gere novamente.",
      });
    }

    const legenda = (imovel.legenda || "") + "\n\n" + (imovel.hashtags_selecionadas || []).join(" ");

    // Reivindicação atômica: se duas requisições chegarem quase juntas (dois
    // cliques, duas abas, duas pessoas), só a primeira consegue marcar como
    // "publicando" -- a segunda recebe 409 em vez de publicar o mesmo
    // imóvel duas vezes no Instagram.
    const reivindicado = await db.claimImovelForInstagramPublish(user.organizationId, req.params.id);
    if (!reivindicado) {
      return res.json(409, { error: "Esse imóvel já está sendo publicado agora (por você ou outra pessoa) -- aguarde terminar." });
    }

    try {
      const resultado = await publicarNoInstagram(cfg, midias, legenda);
      const camposStory = { instagram_story_status: "nenhum", instagram_story_post_id: null, instagram_story_erro_msg: "" };
      // O Story é publicado à parte, depois do carrossel -- se faltar a
      // capa do story ou essa chamada falhar, o post principal (já
      // publicado) não é desfeito; só registramos o erro do story.
      if (imovel.capa_story_url) {
        try {
          const resultadoStory = await publicarStoryNoInstagram(cfg, imovel.capa_story_url);
          camposStory.instagram_story_status = "publicado";
          camposStory.instagram_story_post_id = resultadoStory.mediaId;
        } catch (errStory) {
          console.error("Erro ao publicar Story no Instagram:", errStory);
          camposStory.instagram_story_status = "erro";
          camposStory.instagram_story_erro_msg = errStory.message || "Não foi possível publicar o story.";
        }
      }
      const atualizado = await db.saveImovel(user.organizationId, req.params.id, Object.assign({}, imovel, {
        instagram_status: "publicado",
        instagram_post_id: resultado.mediaId,
        instagram_permalink: resultado.permalink,
        instagram_erro_msg: "",
        instagram_publicado_em: new Date().toISOString(),
      }, camposStory));
      return res.json(200, { imovel: atualizado });
    } catch (err) {
      console.error("Erro ao publicar no Instagram:", err);
      const msg = err.message || "Não foi possível publicar no Instagram.";
      await db.saveImovel(user.organizationId, req.params.id, Object.assign({}, imovel, {
        instagram_status: "erro",
        instagram_erro_msg: msg,
      })).catch(() => {});
      return res.json(502, { error: msg });
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

// URL de um imóvel no próprio backoffice da Seu Lugar (app.seulugar.imb.br/
// property/<código>). Essa página é montada inteira por JavaScript (React) --
// um fetch simples só pega a casca vazia, sem nenhum dado do imóvel. Só que
// por trás existe uma API pública (sem login) que devolve o imóvel já
// estruturado, encontrada olhando o próprio código-fonte do site (arquivo
// static/js/*.chunk.js, função "getPropertyPublicByCode"). Usar essa API
// direto é bem mais rápido e confiável que ler o texto da página e mandar
// pra IA tentar adivinhar os números -- e não gasta chamada de IA nenhuma.
const SEULUGAR_PROPERTY_URL_RE = /^https?:\/\/app\.seulugar\.imb\.br\/property\/([a-zA-Z0-9._-]+)/i;
const SEULUGAR_API_BASE = "https://api.seulugar.imb.br/stage/api/v1/real-estate/get/public";

// Amostra pequena de valores já vistos no campo "type" da API, para quando o
// início do título (mais confiável -- é texto em português de verdade,
// escrito por alguém do time) não bater com nenhum dos nossos tipos.
const SEULUGAR_TYPE_MAP = {
  HOUSE: "Casa", APARTMENT: "Apartamento", KITNET: "Kitnet", STUDIO: "Kitnet",
  SOBRADO: "Sobrado", COMMERCIAL_ROOM: "Sala Comercial", STORE: "Loja", LAND: "Terreno",
};

async function buscarDadosEstruturadosSeuLugar(url) {
  const m = url.match(SEULUGAR_PROPERTY_URL_RE);
  if (!m) return null;
  const codigo = m[1];

  let resp;
  try {
    resp = await fetch(SEULUGAR_API_BASE + "/code/" + encodeURIComponent(codigo));
  } catch (e) {
    return null; // API fora do ar ou inacessível -- cai no scraping genérico
  }
  if (!resp.ok) return null; // ex: código não encontrado -- cai no fallback também
  let data;
  try {
    data = await resp.json();
  } catch (e) {
    return null;
  }
  if (!data || !data.features) return null;

  const f = data.features;
  const addr = data.address || {};
  const titulo = String(data.title || "");
  // O início do título já vem em português, escrito por gente da equipe
  // ("Casa com 3 dormitórios...", "Apartamento no..."), o que costuma ser
  // mais confiável que o enum interno do sistema (data.type).
  const tipoPorTitulo = Object.keys(SEULUGAR_TYPE_MAP)
    .map((k) => SEULUGAR_TYPE_MAP[k])
    .find((rotulo) => titulo.toLowerCase().startsWith(rotulo.toLowerCase()));
  const tipo_imovel = tipoPorTitulo || SEULUGAR_TYPE_MAP[data.type] || "Apartamento";

  const dados = {
    tipo_imovel,
    bairro: addr.district || "",
    cidade_estado: addr.city ? addr.city + (addr.state ? "/" + addr.state : "") : "",
    numero_quartos: Number(f.rooms) || 0,
    numero_banheiros: Number(f.bathrooms) || 0,
    numero_vagas: Number(f.parkingSpaces) || 0,
    numero_cozinhas: Number(f.kitchens) || 1,
    metragem: Number(f.usefulArea || f.footage) || 0,
    valor_aluguel: Number(f.rentPrice) || 0,
    valor_condominio: Number(f.condominiumValue) || 0,
    valor_iptu: Number(f.iptu) || 0,
    codigo_unico: data.code || data.codigoImovel || codigo,
  };

  const descricaoTexto = data.description ? htmlParaTexto(data.description) : "";
  const texto = [titulo, descricaoTexto].filter(Boolean).join("\n\n").slice(0, 15000);

  return { texto, dados };
}

// Busca a página do anúncio e devolve só o texto visível (sem tags, script,
// style etc.), pronto para a IA ler. Não usa nenhum serviço pago -- é um
// fetch simples com um User-Agent de navegador de verdade (muitos sites
// bloqueiam o User-Agent padrão de bibliotecas/robôs). Funciona bem em sites
// que renderizam o conteúdo no servidor; sites que só montam a página via
// JavaScript no navegador (client-side rendering) não vão funcionar aqui --
// nesse caso, a pessoa ainda pode copiar e colar o texto manualmente.
// Quem usa "Ler automaticamente" é sempre uma pessoa autenticada do time
// (não um estranho da internet), mas mesmo assim o servidor não deveria
// aceitar buscar qualquer endereço que alguém cole -- sem essa checagem,
// esse campo vira um jeito de fazer o próprio servidor consultar endereços
// internos da rede onde ele roda. Bloqueia localhost, IPs privados/de
// metadados de nuvem e qualquer coisa que não seja http(s) (a checagem já
// feita antes disso cobre o esquema; aqui é só o host). Não resolve DNS
// para checar o IP de verdade (isso pegaria também um domínio que só
// aponta pra um IP privado) -- suficiente para o nível de risco aqui
// (equipe já autenticada, não acesso anônimo), não para um cenário de
// múltiplos clientes desconhecidos usando o mesmo servidor.
function ehUrlPublicaSegura(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch (e) { return false; }
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "::1") return false;
  const partesIPv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (partesIPv4) {
    const [a, b] = partesIPv4.slice(1, 3).map(Number);
    if (a === 127 || a === 10 || a === 0) return false;
    if (a === 169 && b === 254) return false; // link-local -- inclui metadados de nuvem (ex: 169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  return true;
}

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

// Uma chamada POST à Graph API da Meta, com os parâmetros como querystring
// (é assim que a Graph API espera, mesmo em POST) -- devolve o JSON já
// decodificado, ou lança um erro com a mensagem que a própria Meta devolveu
// (geralmente já explica o problema: token expirado, mídia inválida etc.).
async function chamarGraphAPI(path, params) {
  const url = GRAPH_API_HOST + "/" + GRAPH_API_VERSION + path + "?" + new URLSearchParams(params).toString();
  const resp = await fetch(url, { method: "POST" });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.error) {
    const msg = (data.error && data.error.message) || ("HTTP " + resp.status);
    throw new Error("Instagram: " + msg);
  }
  return data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Publica uma ou várias fotos (carrossel) no Instagram, na ordem em que
// aparecem em midias -- a capa do feed sempre entra primeiro (ver a rota
// acima). Como as imagens já estão hospedadas de forma durável no
// Cloudinary (diferente do fluxo antigo via Zapier, que precisava de uma
// hospedagem pública TEMPORÁRIA só pra esse momento), não há necessidade de
// re-hospedar nada aqui -- é só apontar a Graph API para a URL de cada uma.
async function publicarNoInstagram(cfg, midias, legenda) {
  const igId = cfg.instagram_business_account_id;
  const token = cfg.instagram_access_token;

  let creationId;
  if (midias.length === 1) {
    const r = await chamarGraphAPI("/" + igId + "/media", {
      image_url: midias[0],
      caption: legenda,
      access_token: token,
    });
    creationId = r.id;
  } else {
    // Carrossel: primeiro cria um "item" por foto (sem legenda), depois um
    // container do tipo CAROUSEL referenciando todos os itens, com a legenda.
    const itemIds = [];
    for (const url of midias) {
      const r = await chamarGraphAPI("/" + igId + "/media", {
        image_url: url,
        is_carousel_item: "true",
        access_token: token,
      });
      itemIds.push(r.id);
    }
    const r = await chamarGraphAPI("/" + igId + "/media", {
      media_type: "CAROUSEL",
      children: itemIds.join(","),
      caption: legenda,
      access_token: token,
    });
    creationId = r.id;
  }

  // A Meta processa cada mídia de forma assíncrona antes de poder publicar
  // -- na prática costuma estar pronta na hora (as imagens já são públicas
  // no Cloudinary), mas uma retentativa curta cobre o caso raro de demora.
  let publishResult;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      publishResult = await chamarGraphAPI("/" + igId + "/media_publish", {
        creation_id: creationId,
        access_token: token,
      });
      break;
    } catch (err) {
      if (tentativa === 3) throw err;
      await sleep(3000 * tentativa);
    }
  }

  const mediaId = publishResult.id;
  let permalink = null;
  try {
    const info = await fetch(
      GRAPH_API_HOST + "/" + GRAPH_API_VERSION + "/" + mediaId + "?fields=permalink&access_token=" + encodeURIComponent(token)
    ).then((r) => r.json());
    permalink = info.permalink || null;
  } catch (e) { /* link não é essencial -- segue sem ele se falhar */ }

  return { mediaId, permalink };
}

// Publica a capa no formato Story (1080x1920, gerada à parte da capa do
// feed -- ver composeCapa("story", ...) no frontend). Stories não aceitam
// legenda nem múltiplas fotos via API, então é sempre uma imagem única, sem
// caption. Reaproveita o mesmo container -> media_publish da Graph API,
// só trocando media_type para STORIES.
async function publicarStoryNoInstagram(cfg, storyUrl) {
  const igId = cfg.instagram_business_account_id;
  const token = cfg.instagram_access_token;

  const container = await chamarGraphAPI("/" + igId + "/media", {
    image_url: storyUrl,
    media_type: "STORIES",
    access_token: token,
  });

  let publishResult;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      publishResult = await chamarGraphAPI("/" + igId + "/media_publish", {
        creation_id: container.id,
        access_token: token,
      });
      break;
    } catch (err) {
      if (tentativa === 3) throw err;
      await sleep(3000 * tentativa);
    }
  }

  return { mediaId: publishResult.id };
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
