# 📚 HQ Collection

App pessoal (PWA) pra catalogar coleção de quadrinhos e mangás: itens, séries, tags, lista de desejos e busca automática de capa — com login próprio e dados isolados por usuário.

> Projeto individual, construído pra substituir uma planilha/Notion de controle de coleção física.

**Demo ao vivo:** [myhqcolection.netlify.app](https://myhqcolection.netlify.app) — crie sua conta e catalogue sua própria coleção, os dados ficam isolados por usuário.

## Features

- 📖 **Coleção e desejos** — cada item tem estado (`desejo` / `comprado` / `lido`), prioridade, preço, loja, data de aquisição e nota; filtros por busca, tipo, série e tags.
- 🗂️ **Séries com herança de tags** — tag marcada na série (editora, universo, autor...) aparece automaticamente em todos os volumes dela; tag no item individual continua funcionando à parte.
- 🔢 **Séries numeradas** — ao ligar essa flag, toda inclusão em massa de volumes exige número e não deixa repetir; detecta "furos" (volumes numerados que faltam na coleção).
- 🖼️ **Busca automática de capa em cascata** — tenta ISBN primeiro (Google Books → Open Library), cai para busca por título/série (Google Books → AniList → MangaDex) e guarda o provedor/termo que funcionou por série, pra próximos volumes da mesma série não repetirem a busca do zero.
- 📥 **Importação por CSV** — sobe uma planilha vinda do Notion ou de fotos de prateleira já revisadas (colunas: `titulo, serie, numero_volume, tipo, estado, editora, universo, personagem, selo, autor, isbn, tags_extra, observacoes`); reimportar o mesmo arquivo não duplica.
- ➕ **Inserção rápida** — adiciona item sem sair da tela, com campos essenciais.
- 🔐 **Auth própria** — login/criar conta via Supabase Auth, Row Level Security garantindo que cada usuário só vê a própria coleção.
- 📱 **PWA** — instalável, pensado mobile-first (uso real é catalogar HQ com o celular na mão, em frente à estante).

## Stack

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 + TypeScript |
| UI | Tailwind CSS 4, componentes shadcn-style (Base UI) |
| Dados/Auth | Supabase (Postgres + Auth + RLS) |
| Import | PapaParse (CSV) |
| Validação | Zod |
| APIs externas | Google Books, Open Library, AniList, MangaDex (busca de capa) |

## Modelo de dados

```text
series (nome, tipo hq|manga, tem_numeracao, memória de busca de capa)
  └─ item (titulo, numero_volume, estado, isbn, capa_url, preco, loja, nota...)
tags (tipo: personagem | editora | arco | selo | autor | universo | outro)
  └─ vinculada a série (herdada pelos itens) e/ou a item (direta)
```

Schema versionado em `supabase/migrations/`. Editora nasceu como coluna livre e foi migrada para virar só mais um tipo de tag (evita duplicidade com o sistema de tags já existente).

## Rodando localmente

```bash
npm install
cp .env.local.example .env.local
# preencha NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
# GOOGLE_BOOKS_API_KEY é opcional — sem ela, a busca de capa usa a quota
# anônima compartilhada do Google Books, que satura fácil (HTTP 429)
npm run dev
```

Aplique as migrations em `supabase/migrations/` no seu projeto Supabase (SQL Editor ou CLI) antes do primeiro uso.

Acesse `http://localhost:3000`.

## Status

Em uso pessoal ativo, evoluindo em fases (fundação → CRUD → import CSV → busca de capa → retrofit visual → refinamentos de série/mobile). Histórico de decisões no `CLAUDE.md`/`AGENTS.md` do projeto.
