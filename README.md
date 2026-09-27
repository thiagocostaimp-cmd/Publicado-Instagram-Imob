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
- **Seu Lugar Publicador** (aba "Publicador"): monta a capa (feed + story),
  o carrossel de fotos e a legenda de cada imóvel, com extração automática
  dos dados por IA a partir do texto de um anúncio. Cada imobiliária
  (organização) só vê os próprios imóveis. Precisa de duas contas gratuitas
  configuradas em "Configurações" e nas variáveis de ambiente -- veja
  "Indo para produção" abaixo.

## O que ainda falta (próximos passos naturais)

1. **Trocar a senha / "esqueci minha senha"**: hoje só o administrador
   define a senha inicial de cada pessoa. Depois, dá para adicionar uma
   tela de "trocar minha senha" (rota autenticada) e um fluxo de
   recuperação por e-mail (precisa de um serviço de envio de e-mail, tipo
   Resend ou SendGrid).
2. **Publicar direto no Instagram**: hoje o Publicador só gera o conteúdo
   para baixar e postar manualmente. Publicar automático exige a API do
   Instagram (Meta Graph API) -- uma conta de desenvolvedor Meta, ligar a
   Página do Facebook à conta comercial do Instagram, e implementar a
   renovação do token de acesso.
3. **Papéis mais específicos**, se um dia precisar de mais que só
   "admin" e "membro" (ex: financeiro, corretor).
4. **Trocar a senha do JWT_SECRET / colocar rate limiting** -- veja
   "Segurança" abaixo.

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
