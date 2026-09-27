const http = require("http");
const url = require("url");
const fs = require("fs");
const path = require("path");
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
const db = require("./db");

const router = createRouter();
routes.register(router);

// Em produção, o frontend (HTML/CSS/JS estático) é servido pelo mesmo
// servidor da API -- assim só existe UM serviço para hospedar, sem CORS
// entre domínios diferentes. Veja frontend/config.js: em produção, API_BASE
// fica vazio ("") porque a API está no mesmo endereço que a página.
const FRONTEND_DIR = path.join(__dirname, "..", "..", "frontend");
const STATIC_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(req, res, pathname) {
  let reqPath = pathname === "/" ? "/index.html" : pathname;
  let filePath = path.join(FRONTEND_DIR, reqPath);

  // Nunca sair da pasta do frontend (proteção contra path traversal).
  if (!filePath.startsWith(FRONTEND_DIR)) {
    res.writeHead(403);
    return res.end("Proibido.");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Sem build step / sem rotas no frontend além da raiz -- qualquer
      // caminho não encontrado cai de volta no index.html.
      return fs.readFile(path.join(FRONTEND_DIR, "index.html"), (err2, indexData) => {
        if (err2) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          return res.end("Não encontrado.");
        }
        res.writeHead(200, { "Content-Type": STATIC_MIME[".html"] });
        res.end(indexData);
      });
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": STATIC_MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

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
    if (req.method === "GET" && !pathname.startsWith("/api/")) {
      return serveStatic(req, res, pathname);
    }
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

db.init()
  .then(() => {
    server.listen(config.port, () => {
      console.log(`Seu Lugar rodando em http://localhost:${config.port}`);
    });
  })
  .catch((err) => {
    console.error("Não consegui conectar ao banco de dados:", err);
    process.exit(1);
  });
