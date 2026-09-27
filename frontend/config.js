// Endereço da API. Em produção (e também rodando "node backend/src/server.js"
// localmente), o backend serve este frontend no mesmo endereço/porta, então
// a API_BASE fica vazia (mesma origem). Só quando este arquivo é aberto pelo
// servidor de desenvolvimento separado (frontend/serve.js, porta 5173) é que
// apontamos para o backend rodando sozinho na porta 4000.
window.API_BASE = window.location.port === "5173" ? "http://localhost:4000" : "";
