const http = require("http");
const url = require("url");
const config = require("./config");
const { createRouter } = require("./router");
const {
  parseCookies,
  readJsonBody,
  sendJson,
  applyCors,
  SESSION_COOKIE,
} = require("./http-helpers");
const routes = require("./routes");

const router = createRouter();
routes.register(router);

const server = http.createServer(async (req, res) => {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  const match = router.match(req.method, pathname);
  if (!match) {
    return sendJson(res, 404, { error: "Rota não encontrada." });
  }

  // Monta um objeto "res" com o mesmo formato usado em routes.js (res.json,
  // e res.raw para quem precisa setar cookies diretamente).
  const jsonRes = {
    raw: res,
    json(status, body) {
      sendJson(res, status, body);
    },
  };

  try {
    const cookies = parseCookies(req);
    const reqCtx = {
      params: match.params,
      query: parsed.query,
      sessionToken: cookies[SESSION_COOKIE],
      body: undefined,
    };

    if (req.method === "POST" || req.method === "DELETE") {
      try {
        reqCtx.body = await readJsonBody(req);
      } catch (e) {
        return sendJson(res, 400, { error: "Corpo da requisição inválido." });
      }
    }

    for (const handler of match.handlers) {
      await handler(reqCtx, jsonRes);
    }
  } catch (err) {
    console.error("Erro não tratado:", err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: "Erro interno. Tente novamente em instantes." });
    }
  }
});

server.listen(config.port, () => {
  console.log(`API do Seu Lugar rodando em http://localhost:${config.port}`);
  console.log(`Aceitando pedidos do front-end em: ${config.frontendOrigin}`);
});
