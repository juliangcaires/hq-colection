# AUDITORIA — hq-colection

> **Status: DIAGNÓSTICO CONCLUÍDO — nenhum arquivo do projeto foi alterado.** Este arquivo é a única adição (não commitado).
> Aguardando sua aprovação antes de qualquer correção.

- **Data:** 2026-10-19 · **Versão auditada:** `master` @ `983daba` · Next 16.2.11 · React 19.2.4 · @supabase/ssr 0.12.3
- **Legenda:** ✅ **Confirmado** = reproduzi (build de produção local, ou API real do seu Supabase). 🔍 **Suspeito** = só leitura de código / lógica determinística, não reproduzido de ponta a ponta.

## 0. Como o teste foi feito (e o que não foi tocado)

- Servidor: `next build` + `next start` em `localhost:3000` (produção, porque o prefetch do Next só roda em produção). Navegador: Playwright/Chromium headless.
- Supabase: **seu projeto** (o de `.env.local`). Criei **2 usuários descartáveis** pela admin API (um "perf" com dataset sintético do tamanho do seu real — 826 itens / 79 séries / 285 tags / 1093 `item_tags` / 826 capas — e um "atacante"), mais outros 2 no teste de RLS. **Todos foram apagados** (usuários, linhas e objetos de storage). Conferido depois: o banco voltou exatamente a **826 / 79 / 285** e **2 usuários originais**. Seus dados reais **não foram lidos nem alterados** (só contagens agregadas).
- SSRF: o "servidor interno" foi um listener meu em `127.0.0.1`. Nenhum ataque a terceiros. Contra as APIs de capa fiz **uma** busca funcional real ("Berserk") e **uma** requisição com payload grande (a que mostrou a ausência de limite de tamanho no body) — nada de volume/rate-limit contra elas.
- `.env.local` nunca foi exibido. **Resultado sobre segredos:** nenhuma chave no histórico git (23 commits varridos por padrões de JWT/`sb_secret_`/`AIza`), `.env.local` ignorado e nunca commitado, e **nem a service role nem a anon key nem a URL do Supabase aparecem no bundle do cliente** (`.next/static`) nem no do servidor (no caso da service role).
- Não testado: `npm run dev` (tempos de compilação sob demanda), a demo em produção (Netlify), e-mail de confirmação, dispositivo móvel real, instalação do PWA.

### Progresso (task list)

- [x] Fase 1 — mapeamento, lint, tsc, build, audit
- [x] Fase 2 — regras de negócio / fluxos no navegador
- [x] Fase 3 — segurança (RLS com 2 usuários, IDOR, SSRF, XSS, headers, auth, segredos)
- [x] Fase 4 — performance e navegação (baseline medido) + parecer sobre migração
- [x] Fase 5 — este relatório
- [ ] Correções (aguardando aprovação) → depois: medir "depois" e retestar item a item

---

## 1. Resumo executivo — Top 5

> **Contexto que agrava vários itens:** o README aponta a demo em `myhqcolection.netlify.app` com **cadastro aberto** ("crie sua conta"). Ou seja, "usuário autenticado" aqui significa "qualquer pessoa da internet em 30 segundos".

| # | Problema | Por que importa |
|---|---|---|
| **1** | **SSRF com leitura completa em `aplicarCapaEscolhida`** (S-02) ✅ | A Server Action baixa **qualquer URL** que o cliente mandar (inclusive `127.0.0.1`, redirects, sem limite de tamanho) e grava a resposta no bucket do usuário, de onde ele a lê por signed URL. Reproduzido. Com cadastro aberto, qualquer visitante usa o seu servidor como proxy para a rede interna. |
| **2** | **View `v_item_tags_efetivas` vaza dados de todos os usuários para qualquer um, até sem login** (S-03) ✅ | Views do Postgres ignoram a RLS por padrão. Com **só a anon key (pública)** consegui 1000 linhas (teto do PostgREST) — dados reais, incluindo da sua coleção. Só IDs (UUIDs), mas é um bypass total de RLS, não usado pelo app. Correção de 1 linha. |
| **3** | **`next@16.2.11` com 3 CVEs críticos de RCE + SSRF no otimizador de imagens** (S-01) ✅ (versão) | `npm audit`: RCE não autenticado no Image Optimization (AVIF), RCE em `next/og`, SSRF no Image Optimization, cache poisoning. O app usa `next/image` com `remotePatterns`. Corrige com `next@16.4.2` (mesmo major). A exploração real depende do host (Netlify), mas atualizar é barato e elimina a dúvida. |
| **4** | **A coleção será truncada em silêncio a partir de 1000 itens — você tem 826** (B-01) ✅ | O PostgREST corta cada `select` em 1000 linhas e o app não pagina. Reproduzido: 1104 existentes, `select` devolveu 1000. A tela Coleção, o cálculo de "furos" e "série completa" passam a mostrar dados errados **sem erro nenhum**. Você está a ~175 itens disso. |
| **5** | **O "trava e de repente aparece" é real e tem causa clara** (P-01/P-02) ✅ | Não existe `loading.tsx` em lugar nenhum: nenhum feedback visual até o servidor terminar tudo (medi: "primeiro feedback", "URL muda" e "dados visíveis" são **o mesmo instante**). Além disso `/colecao` serializa **1,1 MB** de RSC para 826 cards sem paginação, e as signed URLs mudam a cada render (**0 de 155** imagens reaproveitam o cache do otimizador). |

**Menções honrosas (também confirmadas):** erros de validação do servidor chegam ao usuário como *"An error occurred in the Server Components render…"* em produção (B-02); a importação de CSV **duplica** ao reimportar linhas com `1,5`/valor inválido e converte "Desejo"→`comprado`, "Mangá"→`hq` em silêncio (B-03); **race condition** cria volumes duplicados (B-05); nenhum header de segurança (S-05).

**O que está bom (confirmado):** RLS correta nas 5 tabelas e no storage — usuário B **não** leu, editou, apagou nem plantou nada do usuário A, nem pela API REST com anon key+JWT, nem por Server Actions com ids trocados (IDOR); sem XSS armazenado/refletido (nem via CSV); service role fora do bundle; login com mensagem uniforme; ações sem sessão não executam; duplo clique nos formulários principais não duplica.

---

## 2. Mapa do sistema (Fase 1)

**Proxy** (`src/proxy.ts`): roda `supabase.auth.getUser()` (ida à rede) em toda rota exceto estáticos/imagens; públicas = `/login`, `/criar-conta` (`startsWith`). Sem sessão → 307 `/login`.

| Tela | Actions / queries | Tabelas |
|---|---|---|
| `/` (Início) | 3×`count`, `listarUltimosItens`, `listarSeriesComFuros` (lê **todos** os itens com série) | itens, series |
| `/colecao` | `listarItens` (join `*` + tags de item e de série), `series`, `tags`, `getSignedCapaUrls` (serial) | itens, series, serie_tags, item_tags, tags, storage `capas` |
| `/desejos` | idem, ordenado por prioridade; `marcarAdquiriEmLote` | idem |
| `/item/[id]` | `listarItem`, `series`, signed URL; `updateItem`, `deleteItem`, `uploadCapaManual`, `aplicarCapaEscolhida`, `POST /api/capa/buscar` | itens, item_tags, series, storage |
| `/serie/[id]` | `series` + `listarItens(serieId)`, `tags`; `updateSerie`, `deleteSerie`, `criarVolumesEmLote`, `adicionarItensASerie`, `removerItensDaSerie`, `buscarItensParaSerie`, `resumoVolumesDaSerie` | series, serie_tags, itens |
| `/series` | `listarSeries` (lê **todos** os itens com série, a cada tecla), `createSerie` | series, itens |
| `/tags` | `tags`; `createTag`, `updateTag`, `deleteTag`, `mergeTags`, `buscarTags*` | tags, serie_tags, item_tags |
| `/importar` | `importarCsv` (1 chamada, sequencial) | itens, series, tags, serie_tags, item_tags, storage |
| `/login`, `/criar-conta` | `signIn`, `signUp` | auth |
| Quick-add (+) | `createSerie`/`createItem`/`criarVolumesEmLote` + `/api/capa/buscar` | — |
| `api/capa/buscar` | auth ✔, Zod ✔, dono do item ✔; chama Google Books / Open Library / AniList / MangaDex | itens, series, storage |

**Migrations:** `0001` (schema, enums, RLS, view, bucket) · `0002` (editora vira tag) · `0003` (memória de busca de capa) · `0004` (`tem_numeracao`). 26 Server Actions no manifest do build. **0 testes automatizados** no repositório. ~8,5 mil linhas em `src/` (1,6 mil são componentes shadcn).

**Ferramentas:** `eslint` ✅ limpo · `tsc --noEmit` ✅ limpo · `next build` ✅ (14 páginas; apenas avisos de Node 20 do supabase-js — `.nvmrc` pede 22, a máquina local tem 20) · `npm audit` ⚠️ **23 vulnerabilidades (2 críticas, 17 altas, 4 moderadas)**; 21 delas são de produção — ver S-01 e S-12.

---

## 3. Tabela de achados

| ID | Sev. | Status | Onde | Achado |
|---|---|---|---|---|
| S-01 | **Crítica** | ✅ versão / 🔍 exploração | `package.json:19` | `next@16.2.11` com RCE (Image Optimization/AVIF, `next/og`), SSRF no otimizador e cache poisoning |
| S-02 | **Alta** | ✅ | `itens/actions.ts:268`, `capa-busca.ts:350-371` | SSRF com leitura completa (sem allowlist, segue redirect, sem limite de tamanho) |
| S-03 | **Alta** | ✅ | `0001_init.sql:71` | View sem `security_invoker` expõe `item_tags`/`serie_tags` de todos ao `anon` |
| B-01 | **Alta** | ✅ | `queries.ts:78`, `:178`; `series/actions.ts:519`; `tags/actions.ts:82-86` | Truncamento silencioso em 1000 linhas (sem paginação) |
| B-02 | **Alta** | ✅ | todas as actions que dão `throw new Error(msg)` + `toast.error(e.message)` | Mensagens de regra de negócio mascaradas em produção |
| B-03 | **Alta** | ✅ | `importar/actions.ts:140-143, 87-88` | Importação não idempotente (NaN), enums case/acento silenciosos, `ilike` com curinga duplica série |
| P-01 | **Alta** | ✅ | `src/app/(app)/` (sem `loading.tsx`); `colecao-filters.tsx:55` | Zero feedback na navegação e nos filtros (`isPending` descartado) |
| P-02 | **Alta** | ✅ | `queries.ts:5-6`, `colecao/page.tsx`, `supabase/capas.ts` | Payload RSC 1,1 MB, 826 cards sem paginação, signed URLs que invalidam o cache de imagem |
| S-04 | Média | ✅ | `0001_init.sql:130` | Bucket `capas` sem limite de tamanho nem de MIME (SVG/HTML aceitos); `uploadCapaManual` confia no cliente |
| S-05 | Média | ✅ | `next.config.ts` | Nenhum header de segurança; `X-Powered-By` exposto |
| S-06 | Média | ✅ | `route.ts`, `importar/actions.ts:41`, `capa-busca.ts:358` | Sem rate limit nem teto de tamanho (API de capa, import, download) |
| S-07 | Média | ✅ | `criar-conta/actions.ts:14`, `login/page.tsx:29` | Enumeração de e-mail no cadastro; mensagem crua do Supabase refletida na URL; senha mín. 6 |
| S-08 | Média | ✅ | `next.config.ts:5-12`, `proxy.ts:46` | Otimizador de imagens público aceita `*.supabase.co` de qualquer projeto |
| B-04 | Média | ✅ | `0001_init.sql` (sem unique) / `itens/actions.ts:152` | Race cria volumes duplicados; séries sem unique; tags case-sensitive vs. importador case-insensitive |
| B-05 | Média | ✅ | `colecao/page.tsx:37`, `item/[id]/page.tsx:12`, `serie/[id]/page.tsx:24` | Query param/ID inválido → HTTP 500; `/serie/[id]` engole erro como 404; sem `error.tsx` |
| B-06 | Média | ✅ | `quick-add-form.tsx:232`, `item-form.tsx:86` | "1,5" no número do volume → `NaN` → erro mascarado, item não é criado |
| B-07 | Média | 🔍 (lógica determinística) | `itens/actions.ts:124` | Data de aquisição padrão em UTC: após 21h (Brasília) grava o dia seguinte |
| B-08 | Média | ✅ | `importar/actions.ts` + `importar-uploader.tsx:23` | CSV Latin-1 → mojibake gravado; aspas abertas engolem o resto do arquivo; arquivo vazio sem feedback; ~200 ms/linha, 1 chamada |
| P-03 | Média | ✅ | `proxy.ts:28`, `layout.tsx:9`, actions | `getUser()` (rede) em 3 lugares por navegação; `getClaims()` validaria local (JWT é ES256) |
| P-04 | Média | ✅ | `series/actions.ts:504`, `queries.ts:170` | `listarSeries`/`listarSeriesComFuros` baixam todos os itens (a cada tecla na busca de séries) |
| S-09 | Baixa | ✅ | `supabase/server.ts:15` | Cookie de sessão sem `HttpOnly` (e `lib/supabase/client.ts` é código morto) |
| S-10 | Baixa | ✅ | `0001_init.sql:109-127` | Policies só checam o dono do "filho": B vincula item próprio a `serie_id`/`tag_id` de A |
| S-11 | Baixa | ✅ | `package.json:24` | `shadcn` em `dependencies` puxa MCP SDK/express/ts-morph (≈14 CVEs transitivos de produção) |
| S-12 | Baixa | ✅ | `.env.local`, `.env.local.example` | `SUPABASE_SERVICE_ROLE_KEY` definida mas **não usada** no código — reduzir superfície |
| B-09 | Baixa | ✅ | `itens/actions.ts:100`, `capa-busca.ts:361` | Excluir item / trocar formato deixa capa órfã no storage |
| B-10 | Baixa | 🔍 | `updateItem`/`updateSerie`/`mergeTags`/quick-add | Operações multi-passo não atômicas (delete+insert de tags; série criada e item falha) |
| B-11 | Baixa | ✅ | `itens/actions.ts:64,100` | Update/delete de ID alheio ou inexistente "dá sucesso" (0 linhas) e a UI diz "atualizado" |
| B-12 | Baixa | 🔍 | `itens/actions.ts:114`, `tags/actions.ts:76` | `marcarAdquiriEmLote` não exige `estado='desejo'`; `mergeTags` aceita misturar tipos; `marcarLido` é código morto |
| P-05 | Baixa | 🔍 | migrations | Faltam índices em `item_tags(tag_id)`, `serie_tags(tag_id)`, `itens(user_id, created_at/prioridade)`; policies usam `auth.uid()` sem `(select …)` |
| I-01 | Info | ✅ | — | Bundle ≈ 880–916 KB de JS bruto por rota (≈ framework + base-ui); não é o gargalo da navegação |
| I-02 | Info | ✅ | `public/`, `manifest.ts` | PWA = só manifest; sem service worker (instala, mas não funciona offline) |
| I-03 | Info | ✅ | repo | 0 testes automatizados |

---

## 4. Achados em detalhe

### S-01 · Next 16.2.11 vulnerável — **Crítica**
- **Evidência:** `npm audit --omit=dev`: `next` 16.2.11 está em faixa vulnerável de: RCE não autenticado em servidores Windows e no **Image Optimization API (AVIF)** (`<16.3.3`), RCE em `next/og` (`<16.3.6`), **SSRF no Image Optimization** (`<16.3.8`), cache poisoning SSG/ISR, vazamento em rotas de metadata. Também `sharp` (libvips/libheif/librsvg) e `postcss` (via `next`).
- **Impacto:** o app usa `next/image` (cards de capa). Quanto da exploração vale na Netlify eu não verifiquei (🔍) — o risco é de quem hospeda o otimizador.
- **Correção:** `npm i next@16.4.2 eslint-config-next@16.4.2` (mesmo major, `fixAvailable.isSemVerMajor=false`), rodar lint/tsc/build e reteste. Ler o changelog 16.2→16.4 em `node_modules/next/dist/docs` antes (AGENTS.md).

### S-02 · SSRF em `aplicarCapaEscolhida` — **Alta** ✅
- **Onde:** `src/app/(app)/itens/actions.ts:268` recebe `candidato: CandidatoCapa` **do cliente**; `src/lib/capa-busca.ts:358` faz `fetch(imageUrl)` sem validação; `:362` `arrayBuffer()` sem limite; `:366` grava no bucket com `contentType` vindo da resposta.
- **Reproduzir:** logado, `POST` na action (header `Next-Action`) com `{url:"http://127.0.0.1:9911/segredo"}` → o listener recebeu `GET /segredo`; `/redir` (302→`/segredo`) foi **seguido**; o conteúdo interno ficou **gravado e legível** via signed URL do próprio usuário; `file://` falhou (500). Download de 120 MB: servidor puxou o stream sem teto.
- **Impacto:** acesso a serviços internos/metadados do host; leitura da resposta; consumo de memória/banda (DoS barato). Agravado pelo cadastro aberto.
- **Correção:** (1) a action **não aceita URL do cliente**: recebe só `{provedor, ref|índice}` e o servidor **reconstrói** a URL a partir dos provedores conhecidos — ou valida `https` + hostname em allowlist (`books.google.com`, `*.googleusercontent.com`, `covers.openlibrary.org`, `s4.anilist.co`, `uploads.mangadex.org`) e bloqueia IP privado/loopback/link-local; (2) `redirect: 'manual'` (re-validar cada salto); (3) teto de tamanho (ex. 5 MB, via `Content-Length` + leitura em stream) e `content-type` ∈ `image/jpeg|png|webp`; (4) `itemId` como `uuid` + checar dono **antes** de baixar; (5) `AbortSignal.timeout`. Mesma função é usada por `importarCsv` e pela rota — a validação fica centralizada em `baixarEPersistirCapa`.
- **Esforço:** 3–4 h.

### S-03 · View `v_item_tags_efetivas` ignora a RLS — **Alta** ✅
- **Onde:** `supabase/migrations/0001_init.sql:71` (`create view …` sem `with (security_invoker = true)`), exposta no schema `public` ao PostgREST.
- **Reproduzir:** `GET /rest/v1/v_item_tags_efetivas?select=item_id,tag_id,origem` com **apenas a anon key** → 1000 linhas (teto de linhas). Usuário B enxergou linhas de A. Foi isso que me mostrou que há dados reais no banco (1000 = teto, não total).
- **Impacto:** vaza o grafo item↔tag de todos os usuários para qualquer pessoa com a anon key (que é pública por design). Hoje são só UUIDs; vira vazamento sério se alguém adicionar uma coluna à view.
- **O app não usa a view** (grep: 0 usos). **Correção:** migration `0005` com `drop view v_item_tags_efetivas;` (ou `alter view … set (security_invoker = true)` + `revoke all … from anon`). Verificar também o painel *Security Advisor* do Supabase.
- **Esforço:** 0,5 h.

### B-01 · Truncamento em 1000 linhas — **Alta** ✅
- **Reproduzido:** inseri 1100 itens de um usuário → `select` sem `range` devolveu **1000 de 1104**.
- **Afeta:** `listarItens` (Coleção, Desejos, Série), `listarSeriesComFuros` (Início), `listarSeries` (Séries — "completa"/furos errados), `mergeTags` (`item_tags` com 1093 vínculos no seu banco já passa de 1000), `idsPorTags`.
- **Correção:** paginação de verdade (`.range()` + contagem exata), e mover os agregados (contagem por estado, furos por série, "completa") para SQL (view `security_invoker` / RPC). Casa com P-02 e P-04.
- **Esforço:** 6–10 h (junto com paginação da lista).

### B-02 · Mensagens de erro mascaradas em produção — **Alta** ✅
- **Reproduzido:** série numerada + volume que já existe (criado em outro dispositivo) → toast: *"An error occurred in the Server Components render. The specific message is omitted in production builds…"*. Idem para preço 1e12 e "1,5". Next não envia o `message` de erros lançados por Server Actions em produção; só um `digest`.
- **Impacto:** o design do app depende dessas mensagens ("Esta série já tem #3 — desmarque ou renumere", "Número já usado…"). Em produção o usuário nunca as lê.
- **Correção:** para erros **esperados**, retornar resultado tipado `{ ok: false, erro: string }` em vez de `throw` (e `throw` só para o inesperado). Atualizar os ~12 call sites.
- **Esforço:** 5–7 h.

### B-03 · Importação CSV: corrompe/duplica sem avisar — **Alta** ✅
Reproduzido pela UI, com o arquivo real subindo no navegador:
| Entrada | Resultado |
|---|---|
| `numero_volume = "1,5"` ou `abc` | `Number()` → `NaN` → vira `null`; a checagem de duplicata (`.eq('numero_volume', NaN)`) nunca casa → **reimportar cria duplicata** (contradiz o texto da tela "não duplica nada") |
| `estado = "Desejo"` | cai no default `comprado` (lista de desejos vira "tenho") — `:142` |
| `tipo = "Mangá"` | vira `hq` — `:140` |
| série `CSV_Wild` (com `_`) | `.ilike('nome', …)` trata `_`/`%` como curinga → 2 séries casam → `maybeSingle()` dá erro **ignorado** → cria **série duplicada** (`:87-88`) |
- **Também (B-08, Média):** Latin-1 → `CSV-Cole��o` gravado (irreversível, sem aviso); uma aspa aberta engole o resto do arquivo (1 "linha" no preview); arquivo vazio/só cabeçalho → nada acontece, sem mensagem; **~200 ms/linha** (120 linhas = 24 s; 800 ≈ 2,7 min) numa **única** Server Action sem progresso — numa função serverless com timeout curto 🔍 (a Netlify costuma limitar funções síncronas a poucos segundos; **confira o timeout configurado**) a importação morre no meio e o resumo se perde. BOM UTF-8, `;` como separador e vírgula/aspas/quebra de linha em campos funcionaram corretamente.
- **Correção:** validar as linhas com Zod no servidor (teto de linhas e de tamanho, enums normalizados sem caixa/acento, número em formato pt-BR), tratar `NaN` explicitamente, escapar curingas (`\%`/`\_`) ou comparar por `lower(nome)`, detectar encoding (UTF-8 vs Windows-1252 via `TextDecoder`) e avisar, enviar em **lotes** de ~50 linhas com barra de progresso e resumo acumulado, e mostrar mensagem para arquivo vazio.
- **Esforço:** 6–8 h.

### P-01 / P-02 · Navegação "trava" — **Alta** ✅ (ver §5)

### S-04 · Storage sem limites — **Média** ✅
- `getBucket('capas')`: `file_size_limit=null`, `allowed_mime_types=null`. Aceitei `text/html` e `image/svg+xml` na própria pasta. `uploadCapaManual` (`itens/actions.ts:242-251`) só confere `file.type.startsWith('image/')` (informado pelo cliente) e usa a extensão do nome do arquivo; não valida `itemId` nem o dono do item antes do upload (cria órfão e devolve "sucesso" porque o `update` afeta 0 linhas).
- As signed URLs ficam em outro domínio (`*.supabase.co`), então não é XSS no app, mas é abuso de armazenamento.
- **Correção:** `file_size_limit` 5 MB e `allowed_mime_types` `{jpeg,png,webp}` no bucket; extensão de allowlist derivada do MIME validado (magic bytes); `itemId` `uuid` + dono; usar caminho fixo `${uid}/${itemId}.webp|jpg`. **Esforço:** 1–2 h.

### S-05 · Sem headers de segurança — **Média** ✅
`curl -I` em `/login`: sem `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`; `X-Powered-By: Next.js` exposto. **Correção:** `headers()` no `next.config.ts` (CSP começando em modo `Report-Only`, `frame-ancestors 'none'`, `nosniff`, `strict-origin-when-cross-origin`) e `poweredByHeader: false`. **Esforço:** 2–3 h. (HSTS: confira o que a Netlify já injeta.)

### S-06 · Sem rate limit / sem teto de tamanho — **Média** ✅/🔍
`/api/capa/buscar` aceitou `titulo` de 100 KB e `isbn` de 5 KB (`route.ts:13-18`: Zod sem `.max()`), e cada chamada dispara 2–4 requisições a terceiros (e queima a quota do Google Books); `importarCsv` aceita até 10 MB (`bodySizeLimit`) sem validar nada; `buscarCapasEmLote` pode disparar centenas de buscas. **Correção:** `.max()` em todos os campos; limite por usuário (ex.: janela deslizante) nas rotas que chamam terceiros e no import; teto de linhas. **Esforço:** 3–4 h.

### S-07 · Auth — **Média** ✅
- `signUp` com e-mail já cadastrado responde **"User already registered"** (enumeração) e a mensagem crua do Supabase vai na URL (`?error=…`) e é exibida (`login/page.tsx:29`) — qualquer pessoa monta um link `/login?error=<texto qualquer>` e o app exibe no tom de erro oficial (spoofing/phishing). Em inglês.
- Login: mensagem **uniforme** ("Invalid login credentials") ✅. 12 tentativas erradas seguidas **não** bloquearam (o limite do Supabase é por IP e mais alto).
- Senha mínima 6 (`minLength={6}`, e "Password should be at least 6 characters").
- **Correção:** mensagens próprias e neutras via código (não refletir texto livre), política ≥ 8–10 caracteres + *leaked password protection* (painel Supabase), CAPTCHA (Turnstile/hCaptcha) no cadastro, e decidir se o cadastro **deve** ficar aberto. **Esforço:** 2–3 h.

### S-08 · Otimizador público + wildcard — **Média** ✅
`/_next/image` está fora do matcher do proxy (público) e `remotePatterns` aceita `*.supabase.co/storage/v1/object/sign/**` de **qualquer** projeto: URL de projeto alheio → o servidor tenta buscar e otimizar (HTTP 500 no teste; host fora do padrão → 400). Proxy aberto de imagens/consumo de CPU. **Correção:** `hostname` exato (`<ref>.supabase.co`), tamanhos permitidos (`images.deviceSizes/imageSizes` enxutos). **Esforço:** 0,25 h.

### B-04 · Duplicidades — **Média** ✅
- **Race:** 2 chamadas simultâneas de `criarVolumesEmLote` na mesma série numerada geraram `[7,7,8,8,9,9]` (check-then-insert, sem constraint — `0004` registra a decisão). Gatilho realista: duas abas/aparelhos ou retry de rede.
- `series` sem unique `(user_id, lower(nome))`; `tags` com `unique(user_id, nome, tipo)` **case-sensitive** (`Dup` e `dup` coexistem), enquanto o importador compara sem caixa.
- **Correção:** unique parcial/índice `lower(nome)` (após script de deduplicação); para volumes, função SQL/RPC transacional `criar_volumes` com `pg_advisory_xact_lock(serie_id)` (ou unique `(serie_id, numero_volume)` condicionado via trigger). **Esforço:** 4–6 h (inclui migração de dados existentes).

### B-05 · Robustez de rotas — **Média** ✅
`/colecao?estado=foo`, `?tipo=foo`, `?serie=abc`, `/desejos?tipo=xx` → **500**; `/item/abc` → **500** (`listarItem` lança no `uuid` inválido; deveria ser 404); `/serie/abc` → 404 porque `serie/[id]/page.tsx:20-26` ignora o `error` (uma falha real do banco também viraria 404). Não há `error.tsx`, `global-error.tsx` nem `not-found.tsx` próprio → tela genérica "This page couldn't load". **Correção:** validar `searchParams`/`params` com Zod (valor inválido = ignorar o filtro/404), checar `error`, criar `error.tsx`/`not-found.tsx` com a identidade do app. **Esforço:** 2–3 h.

### B-06 · "1,5" no número do volume — **Média** ✅
`inputMode="decimal"` no teclado pt-BR mostra vírgula; `Number("1,5")` = `NaN` → Zod rejeita → (por B-02) erro genérico e **nada é criado**. Reproduzido: `1,5` falha, `1.5` funciona. **Correção:** parser pt-BR único (`lib/numeros.ts`) usado em quick-add, item-form e importador. **Esforço:** 1 h.

### B-07 · Data em UTC — **Média** 🔍
`itens/actions.ts:124`: `new Date().toISOString().slice(0, 10)` roda no servidor (UTC). Compras marcadas entre 21h e 24h (Brasília) recebem a data de amanhã. Determinístico pela leitura do código; não reproduzi de ponta a ponta porque depende do horário em que o teste roda (no teste de adquirir a data saiu certa). **Correção:** usar `America/Sao_Paulo` (`Intl`/`toLocaleDateString('sv', {timeZone})`) ou enviar a data do cliente. **Esforço:** 0,5 h.

### P-03 · `getUser()` em toda requisição — **Média** ✅
Medido: `auth.getUser` ≈ 60–73 ms (rede, dos meus testes), `getClaims` ≈ 1 ms depois da 1ª chamada (baixa o JWKS uma vez). O projeto assina com **ES256** (`/.well-known/jwks.json` tem chave EC), então `getClaims()` valida assinatura e expiração **localmente**. Hoje: proxy + layout + cada action chamam `getUser()` (3 idas por navegação). **Segurança:** `getClaims` não percebe revogação de sessão (logout em outro lugar) até o JWT expirar (padrão 1 h); mantenha `getUser()` nas ações sensíveis (excluir, importar) se isso importar. **Esforço:** 1–2 h.

### Baixas e informativas (resumo de correção)
- **S-09:** em `lib/supabase/server.ts:15`, `setAll` com `httpOnly: true` (o client de browser nunca é usado — apagar `lib/supabase/client.ts`). Sem XSS achado, então é defesa em profundidade. 0,5 h.
- **S-10:** `WITH CHECK` com `exists` no pai: `itens.serie_id` ∈ séries do usuário; `item_tags/serie_tags.tag_id` ∈ tags do usuário. Hoje B consegue vincular item próprio à série/tag de A (aceito pela API) — mas **não** consegue ler nada de A pelo join (retorna `null`). 2 h.
- **S-11/S-12:** mover `shadcn` para `devDependencies` (só `globals.css` importa `shadcn/tailwind.css`; remove ~14 CVEs transitivos de produção: `@modelcontextprotocol/sdk`, `express`→`proxy-addr`, `ts-morph`, `fast-glob`, `undici`…) e `npm audit fix`; remover `SUPABASE_SERVICE_ROLE_KEY` do `.env.local`/Netlify/exemplo (não é usada). 0,5 h.
- **B-09:** apagar o objeto do storage em `deleteItem` e ao trocar de capa; fixar extensão. 1–2 h. **B-10/11/12:** mover os fluxos multi-passo para RPC transacional; checar `count` afetado e devolver erro de "não encontrado"; `eq('estado','desejo')` em `marcarAdquiriEmLote`; remover `marcarLido`. 3–4 h.
- **P-04:** `listarSeries` baixa todos os itens a cada tecla digitada em `/series` (e o Início também) → agregar em SQL. Entra em B-01.
- **P-05:** índices `item_tags(tag_id)`, `serie_tags(tag_id)`, `itens(user_id, created_at desc)`, `itens(user_id, prioridade desc)`, unique `lower(nome)`; policies com `(select auth.uid())`. Irrelevante com 826 linhas; barato e vale antes de crescer. 1 h.
- **I-01:** ~880 KB de JS bruto/rota, quase tudo compartilhado (React 19 + base-ui + cmdk + sonner); `/login` 610 KB. Não é o gargalo.
- **I-02:** PWA sem service worker — sem cache/offline.

---

## 5. Performance e navegação (Fase 4)

### 5.1 Medição "antes" (build de produção local, 826 itens, Supabase ≈ 60 ms de RTT)

Mediana de 5 navegações por cliques em `<Link>` (script Playwright):

| Navegação | 1º feedback visual | URL muda | Dados visíveis |
|---|---|---|---|
| Início → Coleção | **1075 ms** | 1075 ms | 1099 ms (min 980 / máx 1621) |
| Coleção → Desejos | 415 ms | 415 ms | 425 ms |
| Séries → Série `[id]` | 296 ms | 296 ms | 301 ms |
| Coleção → Item `[id]` | 292 ms | 292 ms | 296 ms |
| Coleção → Séries | 147 ms | 147 ms | 151 ms |

**Leitura:** as 3 colunas são praticamente **iguais** — durante todo o tempo do servidor a tela fica parada e depois troca de uma vez. É exatamente o sintoma descrito. (Os tempos reais no seu uso são **maiores**: eu medi com latência de 60 ms até o Supabase; se a função da Netlify e o projeto Supabase estiverem em regiões distantes, cada ida e volta custa 10× isso. Região de ambos: **não verifiquei**.)

Decomposição do servidor (RSC, mediana de 4):

| Rota | Tempo | Payload RSC |
|---|---|---|
| `/colecao` | **612 ms** | **1148 KB** |
| `/desejos` | 250 ms | 385 KB |
| `/` | 211 ms | 17 KB |
| `/series` | 143 ms | 21 KB |
| `/tags` | 115 ms | 63 KB |
| `/importar` | 104 ms | 11 KB |

`/colecao` = `getUser` (proxy) ≈ 60 ms → `itens` com joins ≈ **289 ms / 1,2 MB de JSON** → `createSignedUrls(826)` ≈ **267 ms, em série depois** → ≈ 612 ms; depois ainda há ~460 ms de parse do RSC + render de 826 cards no navegador (1075 − 612).

### 5.2 Hipóteses do seu briefing

| Hipótese | Veredito |
|---|---|
| Sem `loading.tsx` → só troca quando o servidor termina tudo | ✅ **Confirmada.** Doc instalado (`prefetching.md`): página dinâmica **sem** `loading.js` não é prefetchada ("Prefetched: No, unless `loading.js`") e "Server roundtrip on click: Yes". Medido acima. Atenção: o próprio doc de `loading.js` avisa que ele "does not guarantee instant client-side navigations"; para garantia total existe `unstable_instant` (exige Cache Components) — avaliar depois. |
| `getUser()` no proxy a cada requisição | ✅ **Confirmada**, mas não é o maior custo local (60 ms × 3). `getClaims()` resolve (P-03). |
| Waterfalls | ✅ Um: `getSignedCapaUrls` roda **depois** das queries (+267 ms). O resto já usa `Promise.all`. N+1: **nenhum** achado. |
| `select('*')` / listas sem paginação | ✅ `ITEM_SELECT` usa `*` + tags de item **e** de série com objetos completos (`user_id`, `created_at`…) duplicados em `tagsItem`/`tagsSerie`/`tagsEfetivas`; zero paginação. |
| Índices | ⚪ Faltam alguns (P-05) mas **não** pesam com 826 linhas. |
| `<Link>`/prefetch | ✅ Os links existem e há ~265 prefetches, mas para rotas dinâmicas eles não trazem dados (ver 1ª linha). |
| Bundle | ⚪ ~900 KB bruto/rota, quase igual em todas — não explica a diferença entre `/colecao` (lenta) e `/series` (rápida). |

**Achado extra (P-02):** as signed URLs mudam a cada render (token novo), então **0 de 155** imagens têm a mesma `url` entre duas cargas da Coleção → o cache do `/_next/image` e do navegador **nunca** é reaproveitado, cada visita reotimiza as capas, e cada URL tem 474 caracteres (826 × ~0,5 KB só em URL dentro do RSC). Em plano com cota de otimização de imagens, isso consome a cota rápido 🔍 (verifique o limite do seu plano).

### 5.3 Plano de performance (impacto esperado)

1. `loading.tsx` genérico em `(app)/` + específicos (colecao, desejos, item, serie, series, tags) com skeletons; `isPending` visível nos filtros (`colecao-filters.tsx:55`). → feedback imediato (~0 ms) mesmo sem mudar o servidor.
2. Paginar/“carregar mais” (ex.: 60 cards) e mandar só o necessário por card (`id, titulo, numero_volume, estado, capa, serie.nome`); tags como dicionário. → `/colecao` de 1,1 MB para algumas dezenas de KB.
3. Capas com URL **estável** (rota autenticada `/api/capa/[id]` com `Cache-Control` imutável, ou bucket público com caminho imprevisível) — **decisão sua** (privacidade vs. cache). Elimina os 267 ms seriais e o cache-miss do otimizador.
4. `getClaims()` no proxy/layout (ver ressalva de revogação).
5. Agregados em SQL (contagens, furos, “completa”) para Início e Séries.
6. `staleTimes.dynamic` de ~30 s para voltar para uma lista sem refazer tudo (`experimental`, doc `staleTimes.md`; hoje o `ScrollRestore` existe justamente para contornar `dynamic = 0`).

**Meta realista:** feedback visual < 100 ms em todas as trocas; `/colecao` < 250 ms de servidor e < 100 KB de RSC na 1ª página. Vou **medir de novo com o mesmo script** depois das correções.

### 5.4 Parecer honesto: migrar para Vite + React SPA?

**Não recomendo — não achei motivo técnico concreto.** Os problemas medidos (payload de 1,1 MB, 826 cards sem paginação, URLs de imagem instáveis, ausência de skeleton, limite de 1000 linhas) **migrariam junto**: numa SPA o mesmo `select` iria do navegador ao Supabase com o mesmo volume. O que já funciona e seria reescrito: ~8,5 mil linhas, 26 Server Actions viram chamadas diretas/RPC, `proxy` + validação de sessão no servidor, signed URLs, importador.

| | Vite SPA | Ficar no Next 16 (com as correções) |
|---|---|---|
| Sensação de instantâneo | ➕ troca de rota é local; skeleton é natural; cache do cliente (TanStack Query) | ➖ precisa de `loading.tsx` + paginação (resolve a maior parte) |
| SEO/SSR | ➖ não usa (app 100 % logado) — **o principal ganho do Next não é aproveitado hoje** | — |
| Segurança | ➖ toda regra passa a morar só na RLS/RPC do banco (já é a barreira real hoje, mas perde a camada de validação do servidor) | ➕ validação + `getClaims`/`getUser` no servidor |
| Custo | ➖ semanas de reescrita + regressão, 0 testes automatizados | ➕ dias |
| Risco | ➖ introduz bugs novos num app que hoje funciona | ➕ incremental |

Só reconsideraria se, **depois** de `loading.tsx` + paginação + capas estáveis, a navegação ainda passar de ~300 ms com a rede real. Uma opção intermediária barata: manter o Next e usar cache de cliente nas listas (SWR/TanStack Query) onde fizer sentido.

---

## 6. Plano de correção (ordem de prioridade)

> Um commit por correção, `lint` + `tsc` + `build` a cada etapa e reteste do item corrigido (os scripts de ataque/medição que usei ficam disponíveis para virar testes de regressão — posso adicioná-los ao repo se você aprovar).

**Fase A — Segurança crítica/alta** (≈ 5–7 h)
| # | Item | Esforço |
|---|---|---|
| A1 | S-01 · `next@16.4.2` (+ `eslint-config-next`), `npm audit fix`, mover `shadcn` p/ dev (S-11), retirar service role não usada (S-12) | 1–2 h |
| A2 | S-03 · migration `0005`: remover (ou `security_invoker`) a view `v_item_tags_efetivas` | 0,5 h |
| A3 | S-02 · SSRF: validação de URL/host/redirect/tamanho/MIME em `baixarEPersistirCapa`; action sem URL do cliente; `itemId` uuid + dono | 3–4 h |

**Fase B — Bugs que corrompem/perdem dado ou escondem erro** (≈ 25–35 h)
| # | Item | Esforço |
|---|---|---|
| B1 | B-01/P-04 · paginação real + agregados em SQL (também resolve parte da Fase C) | 6–10 h |
| B2 | B-02 · resultado tipado `{ok, erro}` nas actions + toasts | 5–7 h |
| B3 | B-03/B-08 · importador: Zod, enums, números pt-BR, curingas, encoding, lotes + progresso, mensagens | 6–8 h |
| B4 | B-04 · unique/lock p/ volumes, séries e tags (com deduplicação prévia dos dados) | 4–6 h |
| B5 | B-05 · validação de `searchParams`/`params`, `error.tsx`/`not-found.tsx` | 2–3 h |
| B6 | B-06 + B-07 · parser pt-BR e data local | 1,5 h |
| B7 | B-09/10/11/12 · storage órfão, atomicidade, no-op silencioso, pequenos ajustes | 4–6 h |

**Fase C — Performance/navegação** (≈ 12–18 h, sobrepõe B1)
| # | Item | Esforço |
|---|---|---|
| C1 | P-01 · `loading.tsx` + skeletons + feedback nos filtros | 3–4 h |
| C2 | P-02 · payload enxuto + paginação na UI + capas com URL estável (decisão) | 5–8 h |
| C3 | P-03 · `getClaims()` no proxy/layout | 1–2 h |
| C4 | P-05 · índices + `(select auth.uid())`, `staleTimes` | 1,5 h |
| C5 | Re-medir (mesmo script) e registrar antes/depois | 1 h |

**Fase D — Hardening e melhorias** (≈ 15–22 h)
| # | Item | Esforço |
|---|---|---|
| D1 | S-05 · headers de segurança (CSP em Report-Only primeiro), `poweredByHeader:false` | 2–3 h |
| D2 | S-04 · limites/MIME do bucket + `uploadCapaManual` | 1–2 h |
| D3 | S-06 · rate limit e `.max()` nos inputs (API de capa, import, ações de capa) | 3–4 h |
| D4 | S-07 · auth: mensagens neutras por código, política de senha, CAPTCHA, decisão sobre cadastro aberto | 2–3 h |
| D5 | S-08 · `remotePatterns` com host exato | 0,25 h |
| D6 | S-09/S-10 · cookie HttpOnly, remover `client.ts`; `WITH CHECK` com dono do pai | 2,5 h |
| D7 | I-03 · testes: `vitest` nas libs puras (`volumes`, `faixas-volumes`, `capa-termo`), teste de RLS e Playwright dos fluxos principais | 6–8 h |

**Total estimado:** ≈ 60–85 h. Se quiser só o essencial, **A + B1 + B2 + C1 + C3 (~25–30 h)** fecha os 5 itens do resumo executivo.

---

## 7. Decisões que dependem de você

1. **Capas:** manter privadas e trocar signed URL por rota proxy autenticada com cache (recomendado), tornar o bucket público com caminhos imprevisíveis, ou manter como está?
2. **Cadastro aberto** na demo da Netlify: manter (com CAPTCHA e limites) ou fechar/convidar?
3. **`getClaims()`:** aceita que logout/revogação só valha após o JWT expirar (1 h padrão) nas telas de leitura, mantendo `getUser()` nas ações destrutivas?
4. **Paginação:** “carregar mais” ou rolagem infinita?
5. **Quais são a região do projeto Supabase e a região/timeout das funções na Netlify?** Isso muda a leitura de P-01 (latência real) e de B-03 (timeout do import). Não consegui verificar sem tocar na produção, que você pediu para não tocar.
6. Posso adicionar os scripts de teste (RLS, IDOR/SSRF, navegação) ao repositório como testes de regressão?

> **Próximo passo:** diga quais fases/itens aprovar (ou “tudo na ordem acima”). Só então eu começo a alterar arquivos, um commit por correção.

---

## 8. Status das correções (branch `auditoria-correcoes`)

Legenda: ✅ corrigido e retestado · 🟡 corrigido no código, **falta você rodar o SQL** · ◐ parcial · ⏳ não feito.

| ID | Status | Como ficou |
|---|---|---|
| S-01 | ✅ | `next` 16.4.2; `npm audit` de produção = 0 |
| S-02 | ✅ | Allowlist de hosts, `https` só, redirect revalidado, 5 MB, timeout, MIME. Ataque retestado: 0 acessos ao servidor interno |
| S-03 | 🟡 | Migration `0005` (`drop view`). **Ainda não aplicada**: a view segue legível com a anon key |
| S-04 | 🟡 | Código: jpeg/png/webp até 5 MB. Bucket: migration `0006` |
| S-05 | ✅ | CSP com nonce, nosniff, X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS; sem `x-powered-by` |
| S-06 | ◐ | Tetos de tamanho nas entradas e no CSV. **Sem rate limit próprio** |
| S-07 | ✅ | Códigos de erro fixos na URL, mensagem neutra, Zod, senha 8–72 |
| S-08 | ✅ | `remotePatterns` removido; capas não passam mais pelo otimizador |
| S-09 | ✅ | Cookies HttpOnly (+Secure em produção); `client.ts` removido |
| S-10 | 🟡 | Policies com `WITH CHECK` nos pais: migration `0006` |
| S-11 | ✅ | `shadcn` em devDependencies |
| S-12 | ◐ | Removida do `.env.local.example`. **Você** remove do `.env.local` e da Netlify |
| B-01 | ✅ | Leitura em páginas de 1000; 1126 itens de teste aparecem todos |
| B-02 | ✅ | `{ok, erro}` nas 18 actions de escrita |
| B-03 / B-08 | ✅ | Importador valida, normaliza, não duplica; encoding, aspas, vazio, lotes de 15 com progresso |
| B-04 | ◐ | Volumes: race resolvida (4 requisições simultâneas → 1 linha por número). Tags: índice único na `0006` 🟡. Séries: **sem** unique, por decisão (homônimas de editoras diferentes) |
| B-05 | ✅ | Filtros inválidos ignorados, ids inválidos → 404, `error.tsx`/`not-found.tsx`/`global-error.tsx` |
| B-06 | ✅ | `lib/numeros.ts` (vírgula decimal) |
| B-07 | ✅ | "Hoje" em `America/Sao_Paulo` |
| B-09 | ✅ | Capa antiga removida ao trocar/excluir; nome de arquivo único por gravação |
| B-10 | ⏳ | Precisa de função SQL transacional (sugestão: `0007`) |
| B-11 | ✅ | Update/delete de algo alheio/inexistente → "não encontrado" |
| B-12 | ◐ | `marcarAdquiriEmLote` só em desejos; `marcarLido` removido. `mergeTags` entre tipos diferentes ficou como está |
| P-01 | ◐ | Barra de carregamento nos filtros. `loading.tsx` global foi **testado e descartado** (o React segura a troca ~300 ms: 143 → 333 ms) |
| P-02 | ✅ | Consulta enxuta, "carregar mais" (60), rota `/api/capa/<arquivo>` com cache imutável |
| P-03 | ✅ | `getClaims()` no proxy e no layout; actions seguem com `getUser()` |
| P-04 | ⏳ | Busca de séries e Início ainda leem todos os volumes (agora paginado). Solução: agregado em SQL |
| P-05 | 🟡 | Índices e `(select auth.uid())`: migration `0006` |
| I-03 | ◐ | 27 testes unitários (`npm test`). Faltam testes de integração/RLS no repositório |

### Medição antes → depois (mesmos dados: 1262 itens, 79 séries)

| | Antes | Depois |
|---|---|---|
| RSC da Coleção | 634 ms / ~1,1 MB | 78 ms / 91 KB |
| Início → Coleção | 964 ms | 117 ms |
| Coleção → Séries | 143 ms | 87 ms |
| Coleção → Item | 205 ms | 132 ms |
| Séries → Série | 234 ms | 149 ms |
| Coleção → Desejos | 431 ms | 123 ms |

Descoberta durante a correção: com mais de ~1000 itens a Coleção não exibia **nenhuma** capa (`createSignedUrls` falhava em silêncio). Resolvido pela rota estável de capas.

### Pendências

1. **Rodar no SQL Editor do Supabase, nesta ordem:** `supabase/migrations/0005_remove_view_tags_efetivas.sql` e `0006_integridade_indices_e_limites.sql`.
2. Remover `SUPABASE_SERVICE_ROLE_KEY` do `.env.local` e das variáveis da Netlify.
3. Decidir o cadastro aberto: Turnstile (precisa de chaves) ou fechar a criação de contas.
4. Opcional: B-10 (RPC transacional) e P-04 (agregados em SQL) numa migration `0007`.
5. Depois do passo 1: reteste de RLS e limpeza dos usuários `audit-*` de teste.
