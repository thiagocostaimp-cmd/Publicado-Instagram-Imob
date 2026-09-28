# Seu Lugar &mdash; painel com login por pessoa

Aplicativo web de verdade para o Seu Lugar Imobiliária, com **login e senha
próprios para cada pessoa do time**, para usar no computador de cada um.

- Backend: Node.js (`node:http`, sem framework) + Postgres (via pacote `pg`)
  + `node:crypto` (hash de senha com scrypt + token de sessão assinado com
  HMAC, no mesmo formato de um JWT).
- Frontend: HTML + CSS + JavaScript puro, sem React/Vue/build step.
- Em produção, o backend também serve os arquivos do frontend -- é **um
  único serviço** para hospedar (mais simples e mais barato).

## Como rodar localmente

Precisa do Node.js 22.5+ e de um Postgres (local, ou um gratuito na nuvem
tipo [Neon](https://neon.tech) -- veja "Indo para produção" abaixo).

```bash
cd backend
npm install
cp .env.example .env
# edite o .env e cole sua DATABASE_URL (Neon, Supabase, ou Postgres local)
node src/server.js
# "Seu Lugar rodando em http://localhost:4000"
```

Abra `http://localhost:4000` no navegador -- o próprio backend já serve o
frontend. Na primeira vez, clique em "Criar minha imobiliária" -- essa conta
vira a administradora. Depois, use a aba "Time" para criar o login de cada
pessoa (nome, e-mail e uma senha inicial). Cada pessoa entra pelo próprio
computador, com o próprio e-mail e senha, na tela de "Entrar".

Se preferir editar só o frontend com recarregamento mais rápido, também dá
para rodar `node frontend/serve.js` (porta 5173) num segundo terminal -- ele
detecta sozinho que deve falar com a API em `localhost:4000`.

## Estrutura do projeto

```
backend/
  src/
    server.js             -- servidor HTTP, roteamento e serve o frontend estático
    routes.js              -- rotas da API (registro, login, time...)
    publicador-routes.js   -- rotas do Seu Lugar Publicador (imóveis, config, extração por IA)
    auth-helpers.js         -- verificação de login, compartilhada pelas rotas acima
    db.js                    -- acesso ao banco (Postgres, via pacote "pg")
    auth.js                   -- hash de senha e token de sessão
    http-helpers.js            -- cookies, CORS, leitura do corpo da requisição
    router.js                  -- roteador simples (sem Express)
    config.js                  -- variáveis de ambiente e geração do segredo do JWT
frontend/
  index.html            -- painel principal: login/registro, início, time
  app.js                -- lógica do painel principal
  style.css             -- visual com as cores da marca Seu Lugar
  config.js             -- endereço da API
  serve.js              -- servidor estático simples (só para desenvolvimento)
  publicador.html       -- Seu Lugar Publicador: capa, carrossel e legenda dos imóveis
  publicador.js         -- lógica do Publicador (canvas, upload pro Cloudinary, IA)
  publicador.css        -- visual do Publicador
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
- **"Esqueci minha senha"**: link na tela de login manda um e-mail (via
  Resend) com um link de redefinição, válido por 1 hora e de uso único. O
  token nunca fica salvo em texto puro no banco (mesmo esquema de hash já
  usado pra senha).
- O token de acesso do Instagram (usado para publicar automaticamente) se
  **renova sozinho** -- toda vez que alguém abre Publicador →
  Configurações (ou tenta publicar um imóvel), o servidor verifica se já
  faz tempo desde a última renovação e renova na hora, sem precisar que
  ninguém gere um token novo manualmente.
- **Seu Lugar Publicador** (aba "Publicador"): monta a capa (feed + story),
  o carrossel de fotos e a legenda de cada imóvel, com extração automática
  dos dados por IA (a partir de texto colado ou de um link, lido pelo
  próprio servidor) e publicação automática no Instagram via Instagram
  Graph API. Cada imobiliária (organização) só vê os próprios imóveis.
  Precisa de algumas contas gratuitas/pagas configuradas em
  "Configurações" e nas variáveis de ambiente -- veja "Indo para
  produção" abaixo.
- **Configurações do Publicador é só para administrador**: qualquer
  pessoa do time cria/edita imóveis e publica no Instagram normalmente,
  mas só administrador consegue ver ou alterar o token do Instagram, as
  chaves do Cloudinary e as demais configurações sensíveis (o backend
  recusa a gravação mesmo que alguém tente chamar a rota direto, não é só
  a tela escondendo o botão).

## O que ainda falta (próximos passos naturais)

1. **Trocar a senha do JWT_SECRET / colocar rate limiting** -- veja
   "Segurança" abaixo.
2. **Papéis mais granulares que admin/membro** (ex: corretor só vê os
   próprios imóveis, financeiro), se um dia o time crescer o bastante
   para precisar disso -- hoje qualquer membro vê e edita todos os
   imóveis da imobiliária.

## Indo para produção (Postgres + hospedagem)

O projeto já está pronto para produção: banco de dados Postgres (em vez do
SQLite) e um único servidor Node que serve API + frontend juntos.

- **Banco de dados**: qualquer Postgres funciona -- basta definir
  `DATABASE_URL`. Este projeto foi configurado para [Neon](https://neon.tech)
  (plano gratuito, sem cartão de crédito). Toda a lógica de acesso ao banco
  fica em `backend/src/db.js`.
- **Hospedagem**: `render.yaml`, na raiz do repositório, já descreve o
  serviço pronto para o [Render](https://render.com) (plano gratuito) --
  ele detecta esse arquivo automaticamente ao conectar o repositório
  ("Blueprint"). Só falta configurar a variável `DATABASE_URL` com a string
  de conexão do Neon, direto no painel do Render (não fica no código, por
  segurança).
- **Domínio e HTTPS**: o Render já entrega um endereço `https://` de graça
  (ex: `https://seulugar-saas.onrender.com`). Um domínio próprio
  (`app.seulugar.com.br`) pode ser configurado depois, no mesmo painel.
- **Seu Lugar Publicador** precisa de duas peças extras:
  - **Cloudinary** (guarda as imagens geradas -- capa, carrossel): crie uma
    conta gratuita em [cloudinary.com](https://cloudinary.com), pegue o
    "Cloud name" no painel principal e crie um "Upload preset" com
    "Signing Mode: Unsigned" em Settings → Upload. Cole os dois valores na
    aba "Configurações" do Publicador (fica salvo no banco, não é uma
    variável de ambiente).
  - **ANTHROPIC_API_KEY** (liga o botão "Extrair com IA"): gere uma chave em
    [console.anthropic.com](https://console.anthropic.com) → API Keys, e
    defina como variável de ambiente no Render. Sem ela, o resto do
    Publicador funciona normalmente -- só esse botão mostra um aviso.
  - **API do Instagram** (liga a publicação automática): exige a conta do
    Instagram ser Business/Creator. Em
    [developers.facebook.com](https://developers.facebook.com), crie um
    app tipo "Business" e adicione o produto "API do Instagram" (a versão
    com login direto do Instagram -- endpoints em `graph.instagram.com`,
    tokens começando com `IGAA`; não é a Graph API "clássica" via Página
    do Facebook). A própria tela de configuração do produto, dentro do
    site de desenvolvedores, tem a opção de gerar o token direto. Cole o
    token e o ID da conta comercial do Instagram na aba "Configurações"
    do Publicador -- fica salvo no banco (nunca é reenviado de volta ao
    navegador depois de salvo, por segurança). O token dura cerca de 60
    dias e **se renova sozinho** (o servidor renova automaticamente
    sempre que alguém usa o painel) -- só se ninguém abrir o Publicador
    por mais de ~60 dias seguidos é que ele expira de vez, exigindo gerar
    um novo do mesmo jeito.
  - **Resend** (liga o "Esqueci minha senha"): crie uma conta gratuita em
    [resend.com](https://resend.com) e gere uma API key em API Keys. Sem
    verificar um domínio próprio na conta Resend, o remetente padrão
    (`onboarding@resend.dev`) só consegue entregar e-mail para o endereço
    cadastrado na sua própria conta Resend -- funciona para testar, mas
    não entrega para o time inteiro. Para isso funcionar com todo mundo,
    verifique um domínio seu em Resend (Domains → Add Domain, apontando
    uns registros DNS) e defina `RESEND_FROM` com um remetente desse
    domínio (ex: `Seu Lugar <nao-responda@seulugar.imb.br>`).

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
