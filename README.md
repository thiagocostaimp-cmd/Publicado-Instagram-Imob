# Seu Lugar &mdash; painel com login por pessoa

Ponto de partida de um aplicativo web de verdade para o Seu Lugar Imobiliária,
com **login e senha próprios para cada pessoa do time**, para usar no
computador de cada um. Isto substitui o modelo anterior (um Claude Artifact,
que dependia do login da organização no claude.ai) por um backend e um
frontend que rodam de forma independente, do jeito que um SaaS precisa.

## Por que ficou assim (leia antes de mexer)

Este projeto foi montado dentro de um ambiente de nuvem (sandbox) cuja rede
bloqueia o acesso ao registro do npm e do pip (todo pedido de instalação
retornou "403 Forbidden"). Para conseguir entregar algo que já roda e já foi
testado de ponta a ponta agora -- em vez de código não testado torcendo para
funcionar depois -- o backend e o frontend abaixo usam **só recursos nativos
do Node.js 22**, sem nenhum pacote de terceiros:

- Backend: módulo `node:http` (servidor), `node:sqlite` (banco de dados,
  recurso experimental do Node) e `node:crypto` (hash de senha com scrypt +
  token de sessão assinado com HMAC, no mesmo formato de um JWT).
- Frontend: HTML + CSS + JavaScript puro, sem React/Vue/build step.

Isso foi verificado de verdade nesta sessão: todas as rotas da API foram
testadas via curl (registro, login, sessão, permissões de admin vs. membro,
remoção de conta, logout) e o fluxo completo foi testado clicando na
interface de verdade com um navegador automatizado (Playwright): criar a
imobiliária, criar login para uma pessoa do time, essa pessoa logar com a
própria senha, não ver as opções de administrador, e a sessão persistir
depois de recarregar a página.

Quando você abrir esta pasta em um ambiente com internet normal (seu
computador, ou uma sessão do Claude Code com rede liberada), dá para evoluir
para uma stack mais tradicional -- veja "Migrando para produção" mais abaixo.
Nada aqui te prende a ficar sem dependências para sempre; foi a forma mais
honesta de te entregar algo que já funciona hoje.

## Como rodar

Não precisa de `npm install`. Só precisa do Node.js 22.5 ou mais novo
instalado na máquina.

```bash
# Terminal 1 -- backend (API)
cd backend
cp .env.example .env   # opcional; os padrões já funcionam
node src/server.js
# "API do Seu Lugar rodando em http://localhost:4000"

# Terminal 2 -- frontend
cd frontend
node serve.js
# "Front-end do Seu Lugar rodando em http://localhost:5173"
```

Abra `http://localhost:5173` no navegador. Na primeira vez, clique em
"Criar minha imobiliária" -- essa conta vira a administradora. Depois, use a
aba "Time" para criar o login de cada pessoa (nome, e-mail e uma senha
inicial). Cada pessoa entra pelo próprio computador, com o próprio e-mail e
senha, na tela de "Entrar".

## Estrutura do projeto

```
backend/
  src/
    server.js       -- servidor HTTP e ligação das rotas
    routes.js        -- as rotas da API (registro, login, time...)
    db.js             -- acesso ao banco (SQLite nativo do Node)
    auth.js            -- hash de senha e token de sessão
    http-helpers.js    -- cookies, CORS, leitura do corpo da requisição
    router.js          -- roteador simples (sem Express)
    config.js          -- variáveis de ambiente e geração do segredo do JWT
  data/                 -- onde o banco SQLite fica salvo (não versionado)
frontend/
  index.html            -- as três telas: login/registro, início, time
  app.js                -- toda a lógica (chamadas à API, navegação)
  style.css             -- visual com as cores da marca Seu Lugar
  config.js             -- endereço da API
  serve.js              -- servidor estático simples
```

## O que já funciona

- Cada imobiliária que se cadastra vira uma "organização" isolada das
  outras (o modelo já é multi-tenant, pensando num futuro com mais de um
  cliente usando o mesmo sistema).
- A primeira conta de cada organização é sempre administradora.
- Só administrador cria ou remove login de outras pessoas do time.
- Senhas nunca ficam em texto puro -- são guardadas com hash (scrypt) e sal
  aleatório por senha.
- A sessão de login usa um cookie `HttpOnly` (o JavaScript da página não
  consegue ler o token, o que dificulta um ataque de roubo de sessão via
  script malicioso).
- Um administrador não consegue remover a própria conta por acidente pela
  tela de time (evita a organização ficar sem nenhum admin).

## O que ainda falta (próximos passos naturais)

1. **Trocar a senha / "esqueci minha senha"**: hoje só o administrador
   define a senha inicial de cada pessoa. Depois, dá para adicionar uma
   tela de "trocar minha senha" (rota autenticada) e um fluxo de
   recuperação por e-mail (precisa de um serviço de envio de e-mail, tipo
   Resend ou SendGrid).
2. **Portar as telas do Seu Lugar Publicador** (extração por IA, geração de
   capas, carrossel, publicação no Instagram) para dentro deste painel,
   como novas páginas que só aparecem para quem está logado.
3. **Papéis mais específicos**, se um dia precisar de mais que só
   "admin" e "membro" (ex: financeiro, corretor).
4. **Migrar para produção** -- veja a seção abaixo.

## Migrando para produção

Este ponto de partida é sólido para começar e validar o produto com o seu
próprio time. Antes de vender para outras imobiliárias com uso simultâneo
pesado, ou de rodar em mais de um servidor ao mesmo tempo, vale trocar duas
peças (nenhuma delas exige reescrever as telas ou as regras de negócio --
só a camada de infraestrutura):

- **Banco de dados**: trocar o SQLite nativo por Postgres (ex: Supabase,
  Neon ou Railway têm planos gratuitos/baratos para começar). O arquivo
  `backend/src/db.js` concentra todo o acesso ao banco -- é o único lugar
  que precisa mudar, o resto do código chama só as funções que ele exporta.
  Com Postgres instalado, vale considerar também o Prisma
  (`npm install prisma @prisma/client`) para não escrever SQL na mão.
- **Framework HTTP**: o servidor manual em `server.js`/`router.js` funciona
  bem, mas o Express (`npm install express cookie-parser cors`) tem mais
  gente testando e mais middlewares prontos (rate limiting, logs,
  validação). Trocar é direto: as funções em `routes.js` já recebem
  `(req, res)` e devolvem JSON, é só adaptar a assinatura ao Express.
- **Hospedagem**: Railway, Render ou Fly.io para o backend; Vercel,
  Netlify ou o mesmo Railway para o frontend (ou sirva os arquivos
  estáticos do frontend a partir do próprio backend, para simplificar).
- **Domínio e HTTPS**: qualquer uma dessas hospedagens dá um domínio com
  HTTPS de graça; aponte `FRONTEND_ORIGIN` (no backend) e `API_BASE` (no
  `frontend/config.js`) para os endereços de produção.

## Continuando com o Claude Code

Este zip contém só o código (o histórico do git foi mantido apenas na
sessão em que este projeto foi criado, não dentro do arquivo baixado). Para
continuar o desenvolvimento:

1. Extraia esta pasta no seu computador (ou numa pasta que o Claude Code
   consiga acessar).
2. Transforme em repositório e suba para o GitHub:
   ```bash
   cd seulugar-saas
   git init
   git add -A
   git commit -m "Scaffold inicial do Seu Lugar SaaS"
   git remote add origin <url-do-seu-repositorio-vazio-no-github>
   git push -u origin main
   ```
3. Abra a pasta com o Claude Code (`claude` no terminal, dentro da pasta) e
   siga pedindo as próximas mudanças -- ele já vai entender a estrutura
   pelo que está aqui e pode instalar pacotes normalmente (num ambiente
   com internet liberada, `npm install` volta a funcionar sem problema).

## Segurança -- pontos de atenção antes de ir ao ar com clientes reais

- Troque o `JWT_SECRET` gerado automaticamente por um valor fixo definido
  como variável de ambiente em produção (senão, reiniciar o servidor sem
  essa variável derruba a sessão de todo mundo, e rodar mais de uma
  instância do servidor ao mesmo tempo quebra, porque cada uma geraria um
  segredo diferente).
- Ative `NODE_ENV=production` em produção -- isso faz o cookie de sessão
  exigir HTTPS.
- Considere um limite de tentativas de login (rate limiting) para
  dificultar tentativas de adivinhar senha.
