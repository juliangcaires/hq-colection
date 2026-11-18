# Desejos — grade de capas + "Agrupar por série"

Spec da nova tela `/desejos` (`src/app/(app)/desejos/page.tsx` + `src/components/itens/desejos-lista.tsx` e filtros).
Referências visuais em `referencias/`:

| Modo | Referência |
|---|---|
| Grade (padrão) | `referencias/DesejosOpcaoA.dc.html` |
| Agrupado por série | `referencias/DesejosOpcaoC.dc.html` |

Como ler os `.dc.html`: os estilos inline são a fonte da verdade (medidas, cores, raios, tipografia). `{{…}}` e o `<script type="text/x-dc">` no fim trazem **dados de exemplo**. `<sc-for>` = repetição, `<sc-if>` = condição. Blocos de cor no lugar das capas são placeholders (use `capa_url` com o fallback do `ItemCard`). Não tente rodar os arquivos: dependem de um `support.js` do editor de design.

## Decisões tomadas

1. **Modo padrão = grade de capas** (Opção A). A lista de 1 item por linha some.
2. **Botão "Agrupar por série"** na barra de filtros: alterna para o modo agrupado (Opção C). Não há terceiro modo de lista.
3. O modo fica **na URL** (`?agrupar=serie`), junto com os outros filtros (`lib/filtros-url.ts`), para sobreviver a reload, voltar e compartilhar.
4. **Filtros e busca valem nos dois modos** e são aplicados **antes** do agrupamento.
5. **Resumo compacto**: o card grande "Para completar a lista" vira pílulas ao lado do título.
6. **Os chips de tipo de tag** (Série, Editora, Personagem, Selo, Autor, Universo, Outras tags) e "Sem capa" vão para **um único menu "Filtros ▾"** (Popover). Mostrar o número de filtros ativos no botão ("Filtros · 2") e chips removíveis dos filtros ativos logo abaixo da barra.
7. **Selo de prioridade só aparece quando prioridade > 0.** "Prioridade 0" deixa de ser exibido.
8. **Sem mudança de schema.** "Adquiri" continua usando a ação atual (`AdquirirButton`). Seleção em lote atual (`selecao-itens.tsx`) continua funcionando nos dois modos.

## Cabeçalho (os dois modos)

- Linha 1: `h1` "Desejos" (`font-heading font-extrabold text-[32px]`) + pílulas `h-8 rounded-full text-sm`:
  - "**160** itens" (modo grade) / "**160** itens em **23** séries" (modo agrupado) — `border border-dashed border-warning text-warning-text`;
  - "Total R$ X" — `border border-border text-muted-foreground`. Quando o total é 0 (nenhum preço preenchido), mostrar "Total R$ 0,00 · adicionar preços" com link que filtra os desejos sem preço (**[opcional — confirmar]**; se não houver esse filtro, mostrar só o total).
  - Se houver itens com prioridade > 0, pílula extra "N com prioridade".
- Linha 2 — barra de filtros (`rounded-[14px] bg-card border p-2.5 flex flex-wrap gap-2 items-center`):
  1. Busca (`flex-1 basis-60`, h-11, `bg-surface-2`).
  2. Segmented de tipo **Todos / HQ / Mangá** (h-[38px] dentro de container de 44px).
  3. **Filtros ▾** (Popover com os filtros por tipo de tag + "Sem capa").
  4. **Ordenar ▾** (Prioridade / Preço / Mais recentes / Série) — no modo agrupado a ordenação vale **dentro** de cada grupo.
  5. **Agrupar por série** — toggle (`aria-pressed`), chip `h-11 rounded-full`; ativo = `border-primary bg-primary/15 text-foreground` com ícone `Layers`.
  6. **Selecionar** (botão-texto `text-link`), como hoje.

## Modo grade (padrão) — `DesejosOpcaoA.dc.html`

- Grade `grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-4 gap-y-5` (desktop ≈ 7–8 por linha); mobile `grid-cols-3 gap-3`.
- Card de desejo (pode ser uma variante do `ItemCard`: `variant="desejo"`):
  - capa `aspect-[2/3] rounded-lg border-2 border-dashed border-warning` (sem a opacidade reduzida da Coleção — aqui todos são desejos, então a capa fica legível);
  - selo "Prio N" no canto superior esquerdo (`bg-warning text-primary-foreground text-[10px] font-bold uppercase rounded px-1.5`) **só se prioridade > 0**;
  - título (14px semibold, truncado) + série (12px muted, truncado); preço em 12px muted ao lado da série quando existir;
  - botão **Adquiri** em largura total, `h-9` (desktop) / `h-11` (mobile), `border border-success/60 text-success-text rounded-[9px]`.
- Clique na capa/título → `/item/[id]`.
- Paginação: mantém `CarregarMais`.
- Modo seleção: anel violeta + check no canto (mesmo visual do `VolumeSlot` selecionado); o botão Adquiri some enquanto seleciona.

## Modo agrupado — `DesejosOpcaoC.dc.html`

- Grade de grupos `grid-cols-[repeat(auto-fill,minmax(480px,1fr))] gap-4 items-start` (2 colunas no desktop, 1 no mobile).
- Cada grupo = card `rounded-2xl bg-card border p-4`:
  - cabeçalho: nome da série (link para `/serie/[id]`, `font-heading font-bold text-lg`), `TipoBadge`, "N desejos" em `text-warning-text`, botão-texto "Ver série" à direita;
  - linha de volumes: até **4 capas** de 96px (desktop) com o número no canto inferior esquerdo e o botão **Adquiri** (h-8) embaixo de cada uma; se houver mais, um último tile "+N" (`border rounded-md text-link`) que **expande o grupo** mostrando todos em grade (estado local; colapsa de volta);
  - mobile: a linha de volumes vira scroll horizontal (`overflow-x-auto snap-x`), sem limite de 4.
- **Ordem dos grupos**: pela série com mais desejos primeiro; empate → nome A–Z. **Avulsos** (itens sem série) sempre por último, num grupo chamado "Avulsos" sem link nem badge de tipo.
- **Ordem dentro do grupo**: `numero_volume` crescente (série numerada); senão, a ordenação escolhida no menu Ordenar.
- **Dados**: o agrupamento precisa de todos os desejos filtrados de uma vez (a paginação de "Carregar mais" não combina com grupos). Opções, em ordem de preferência:
  1. no modo agrupado, buscar os desejos filtrados **sem paginação** (são ~160; colocar um teto, ex. 1000) com `serie:series(id, nome, tipo, tem_numeracao)` e agrupar no servidor (função pura em `src/lib/`, com teste em `src/lib/__tests__/`);
  2. se ficar pesado, uma RPC `desejos_por_serie` — **[opcional — confirmar]**, porque exige migration.
- Modo seleção funciona igual (check nas capas); a barra de ações em lote é a mesma.

## Estados vazios

- Nenhum desejo: ilustração simples + "Sua lista de desejos está vazia" + botão "Adicionar item" (abre o quick add).
- Filtro sem resultado: "Nenhum desejo com esses filtros" + "Limpar filtros".

## Acessibilidade

- Toggle "Agrupar por série" com `aria-pressed`; ao alternar, anunciar via `aria-live="polite"` ("Agrupado por série · 23 séries").
- Botões "Adquiri" com `aria-label="Marcar {título} como adquirido"`.
- Tile "+N" é um `<button>` com `aria-expanded`.
- Alvos ≥ 44px no mobile; texto sobre âmbar/verde/violeta sempre `text-primary-foreground`.

## Aceite

- [ ] Grade é o padrão; `?agrupar=serie` abre agrupado; o toggle troca o modo sem perder busca/filtros/ordenação.
- [ ] Contagem do cabeçalho bate com o filtro aplicado nos dois modos.
- [ ] "Prioridade 0" não aparece em lugar nenhum.
- [ ] "Adquiri" funciona nos dois modos e o item some da lista (ou do grupo; grupo vazio some).
- [ ] Avulsos aparecem por último; séries ordenadas por nº de desejos.
- [ ] 390px e 1440px conferidos; `npm run lint` e `vitest` passando (inclui teste da função de agrupamento).
