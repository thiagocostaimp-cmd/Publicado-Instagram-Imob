// Servidor estático minúsculo para rodar o front-end sem precisar de nenhum
// pacote (nem "serve", nem "vite", nem "http-server"). Só Node puro.
//
// Uso: node serve.js
// Depois abra http://localhost:5173

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  let reqPath = decodeURIComponent(req.url.split("?")[0]);
  if (reqPath === "/") reqPath = "/index.html";

  const filePath = path.join(ROOT, reqPath);
  // Nunca sair da pasta do front-end (proteção simples contra path traversal).
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Proibido.");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Não encontrado.");
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Front-end do Seu Lugar rodando em http://localhost:${PORT}`);
});
