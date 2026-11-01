# Redesign "Minha Coleção" — handoff para implementação

Este documento traduz o redesign feito no canvas de design (claude.ai, privado) para o código deste repositório.
As referências visuais de cada tela estão em `docs/redesign/screens/*.dc.html` (ver "Como ler as referências" no fim).

> Antes de escrever código: leia `AGENTS.md` — este projeto usa **Next 16.4** e a doc da versão instalada está em `node_modules/next/dist/docs/`.

## 0. Regras do redesign

- **Não mudar rotas nem regras de negócio.** O redesign é de layout, navegação e estilo. Server actions, queries, schemas e migrations ficam como estão, exceto onde este documento pede uma consulta nova (marcado como **[dado novo]**).
- Itens marcados como **[opcional — confirmar]** são funcionalidades que o design mostra mas o app ainda não tem. **Não implemente sem confirmar com o usuário.**
- Stack mantida: Tailwind 4 + tokens em CSS variables (`src/app/globals.css`), componentes shadcn sobre Base UI (`src/components/ui`), ícones `lucide-react`, fontes Bricolage Grotesque (`font-heading`) e IBM Plex Sans (`font-sans`).
- Mobile-first. Capas **sempre** `aspect-[2/3]`. Alvos de toque **≥ 44px** (`min-h-11`/`size-11`). Texto sobre violeta, âmbar ou vermelho é sempre escuro (`text-primary-foreground` = `#100d16`): branco nessas cores não passa 4.5:1.
- Breakpoint de navegação: **< `lg`** = header compacto + bottom-nav; **≥ `lg`** = sidebar fixa à esquerda.

## 1. Tokens (`src/app/globals.css`)

As cores-base não mudam. Adicionar os tokens abaixo **em `:root` e em `.dark`** (o arquivo duplica a paleta de propósito) e expor no `@theme inline` como `--color-*`:

| Token | Valor | Uso |
|---|---|---|
| `--surface-2` | `#1b1726` | inputs, tiles internos, barra de seleção, sheet |
| `--border-strong` | `#3a3256` | borda de sheet/dialog/barra flutuante |
| `--link` | `#b9a6ff` | links e botões-texto ("Ver tudo", "Editar", "Cancelar") |
| `--success` | `#2fbf9a` | lido / progresso / "Marcar como lido" (fundo, texto escuro) |
| `--success-text` | `#5fd8b6` | texto verde sobre fundo escuro ("Adquirir" outline) |
| `--warning` | `#e0912a` | furos, desejos, prioridade alta (fundo, texto escuro) |
| `--warning-text` | `#f0c48a` | texto âmbar sobre fundo escuro |
| `--read` | `#d16a5c` | selo "Lido" (= `--destructive`) |
| `--danger-text` | `#e08a7e` | ícone/texto de excluir |
| `--danger-soft-text` | `#f1c1ba` | texto de alertas de erro, "Sair da conta" |
| `--tipo-hq` | `#8fb4f0` | selo HQ (outline) |
| `--tipo-manga` | `#d98ae3` | selo Mangá (outline) |
| `--nav-h` | `84px` | altura da bottom-nav (sem safe-area) |

Fundos "soft" usam opacidade do token: `bg-warning/10`, `bg-success/15`, `bg-primary/20` (item ativo de navegação), `bg-chart-5/15` (tag pessoal).

## 2. Shell da app — `src/app/(app)/layout.tsx`

Hoje: header sticky com nav em texto (2ª linha com scroll no mobile) + FAB `QuickAddButton` fixo no canto.

### Novo shell

- **< lg — `AppHeader`**: logo "Minha Coleção" (`font-heading font-extrabold text-[22px]`), botão de busca (ícone `Search`, leva a `/colecao` com foco na busca) e avatar 44px com as iniciais do e-mail, que abre o `AccountSheet`. Header **não** sticky no mobile (a bottom-nav já resolve a navegação); opcional manter o blur.
- **< lg — `BottomNav`** (fixa, `h-[var(--nav-h)]` + `pb-[env(safe-area-inset-bottom)]`, `bg-card/90 backdrop-blur border-t`): grid de 5 colunas: **Início · Coleção · [+] · Séries · Desejos**.
  - Item: ícone 22px + label 11px, `min-h-13`, coluna. Ativo: texto `foreground`, ícone dentro de uma pílula `bg-primary/20 rounded-[14px] px-4 py-1`; inativo `muted-foreground`.
  - Centro: botão circular 56px `bg-primary text-primary-foreground`, `-mt-[18px]`, sombra violeta. Abre o quick add. **Remove o FAB atual no mobile.**
  - Ícones lucide: `House`, `LayoutGrid` (ou `LibraryBig`), `Plus`, `Layers`, `Heart`.
- **≥ lg — `AppSidebar`** (`w-[232px]`, `bg-card border-r`, coluna com `gap-5`, `p-6 px-4`): logo; botão "Adicionar item" (primary, h-11, abre o quick add); nav principal (Início, Coleção, Séries, Desejos — item h-11, ativo `bg-primary/20 text-foreground font-semibold`); separador; Tags e Importar CSV; rodapé com avatar + e-mail + "Sair" (form `signOut`). Contadores ao lado de cada item (248, 31, 12) são **[opcional — confirmar]**.
- `main`: mobile `px-5 pt-3 pb-[calc(var(--nav-h)+env(safe-area-inset-bottom)+16px)]`; desktop `px-10 py-7`, conteúdo `max-w-[1160px] mx-auto`.
- **Quick add com dois gatilhos**: mover o `open` de `QuickAddButton` para um provider (`QuickAddProvider` + `useQuickAdd()`), usado pelo `+` da bottom-nav e pelo botão da sidebar. O `QuickAddForm` continua igual.
- **Estado ativo**: extrair `estaAtivo` + `APELIDOS` de `nav-links.tsx` para `src/lib/nav.ts` (ou um hook `useNavAtiva`) e reaproveitar em `BottomNav` e `AppSidebar`. Manter as regras atuais (`/serie/*` acende "Séries"; `/item/*` não acende nada).
- **Tags e Importar no mobile** saem da navegação e vão para o `AccountSheet`.

### `AccountSheet` (mobile) — ref. `MenuConta.dc.html`

Bottom sheet (Dialog do Base UI posicionado embaixo, `rounded-t-3xl`, `bg-card border-t border-border-strong`, alça de 40×4px). Conteúdo:
- Avatar 56px `bg-primary` com iniciais + **e-mail** (não há campo de nome no perfil; o design mostra "[SEU NOME]" como placeholder — usar só o e-mail, ou nome + e-mail se existir).
- Tiles itens/séries/tags **[opcional — confirmar]** (exige contagens no layout).
- Lista com Tags (`/tags`) e Importar CSV (`/importar`): linha 56px, ícone em quadrado 36px colorido, título + descrição, chevron.
- "Sair da conta": botão outline vermelho suave (`border-read/50 text-danger-soft-text`), dentro do `<form action={signOut}>`.

## 3. Componentes compartilhados

| Componente | Onde | Especificação |
|---|---|---|
| `ItemCard` (atualizar `components/itens/item-card.tsx`) | Coleção, Início | Capa `rounded-lg ring-1 ring-white/10`. Sem capa: fundo `bg-card`, título em `font-heading font-extrabold` alinhado embaixo/esquerda (não centralizado). **Lido**: selo `rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-read text-primary-foreground` no canto superior direito. **Desejo**: `border-2 border-dashed border-warning opacity-60` + selo "Desejo" `bg-warning`. Legenda: `#N` em semibold + nome da série em muted (só `#N` em série numerada, regra atual). |
| `SegmentedControl` | tipo (Todos/HQ/Mangá), estado (Desejo/Comprado/Lido), abas de login | Container `p-1 rounded-xl bg-card border`; botões iguais `h-10`/`h-11`, `aria-pressed`; ativo `bg-foreground text-background font-semibold` (ou a cor do estado: Lido = `bg-read`, Comprado = `bg-primary`, sempre texto escuro). |
| `FilterChip` | filtros da Coleção/Séries/Desejos | `h-11 px-3.5 rounded-full border`; ativo com valor: `border-primary bg-primary/15` + `X` para limpar; "Com furos": `border-dashed border-warning text-warning-text`. |
| `StatTile` | Início, Importar | `rounded-[14px] border bg-card p-3/p-4`; número em `font-heading font-extrabold text-[26px]/text-[34px]`; legenda 12–13px muted. Desejos: borda tracejada âmbar. |
| `SectionHeader` | Início | `h2` `font-heading text-[19px] font-bold` + link "Ver tudo" (`text-link`, área de toque 44px). |
| `ProgressBar` | Início (lidos), Séries | `h-2 rounded bg-border` + preenchimento `bg-success`. |
| `SerieProgress` | detalhe da série | barra segmentada: lidos (`success`), na fila/comprados (`primary`), faltando (contorno tracejado `warning`) + legenda com bolinhas. |
| `TipoBadge` | séries, detalhe | `text-[10px] font-bold uppercase tracking-[0.06em] border rounded px-1.5`; HQ = `tipo-hq`, Mangá = `tipo-manga`. |
| `CoverStack` | lista de séries | 3 capas sobrepostas (offset 6–9px, opacidades .45/.7/1) — usar as 3 primeiras capas reais da série; sem capa, blocos `bg-card`. |
| `VolumeSlot` | `components/series/volumes-grid.tsx` | Volume presente: capa 2:3 com número no canto inferior esquerdo (`bg-background/70 font-heading font-extrabold`) e pontinho verde se lido (ou selo "Lido" no desktop). **Faltando**: slot vazio `border-2 border-dashed border-warning` com "#N" + "falta" em `warning-text`. Selecionado: anel `0 0 0 2px bg, 0 0 0 4px primary` + check circular 22px no canto. |
| `SelectionBar` | detalhe da série | Mobile: flutuante sobre a bottom-nav (`fixed inset-x-3 bottom-6 rounded-[18px] bg-surface-2 border-border-strong shadow`), contador + ações. Desktop: barra inline acima da grade. **Hoje a ação existente é "Remover"** — manter; "Marcar como lido" e "Editar tags" em massa são **[opcional — confirmar]**. |
| `BottomSheet` | quick add, conta | Se `sheet` não existir em `components/ui`, criar sobre o Dialog do Base UI (ou `npx shadcn add sheet` se houver variante Base UI). |

## 4. Telas

Mobile = 390px, desktop = 1440px. Arquivos de referência entre parênteses.

### Início — `(app)/page.tsx` (`Main.dc.html`, `DesktopInicio.dc.html`)
- Stat tiles: **na estante** (= comprado + lido, como hoje), **lidos** (verde), **desejos** (tracejado âmbar). Desktop acrescenta **séries com furos** e subtítulos (ex. "142 HQs · 106 mangás" **[dado novo]**, opcional).
- Barra "Progresso de leitura" = lidos / (comprado + lido).
- **"Na fila de leitura"** — carrossel horizontal (mobile, cards de 112px) / grade (desktop) com itens `estado = 'comprado'`, mais recentes primeiro. **[dado novo]**: reaproveitar `listarItensPagina`/`listarItens` com filtro de estado ou criar `listarFilaDeLeitura(supabase, 8)`; precisa de `capa_url`.
- **"Furos nas séries"** — lista em card com capa 30px, nome e texto âmbar. Usa `listarSeriesComFuros`. **Manter a regra de texto atual** ("falta o #4" com um furo; "faltam N" com vários) — o design mostra "Faltam #4, #17 e #22", que pode ser usado quando houver até 3 faltantes.
- **"Chegaram agora"** — grade de capas (4 colunas mobile). Usa `listarUltimosItens`, que hoje **não traz capa** → **[dado novo]** acrescentar `capa_url, capa_origem` ao select.
- Remover o parágrafo "Use o botão + …".

### Coleção — `(app)/colecao/page.tsx` + `colecao-filters.tsx` (`Colecao.dc.html`, `DesktopColecao.dc.html`)
- Título com contagem ("Coleção · 248 itens").
- Busca `h-12 rounded-xl bg-surface-2` com ícone; `SegmentedControl` de tipo; linha de `FilterChip` com scroll horizontal (Série, Tags por tipo, Estado, Ordenar) — a lógica de URL em `filtros-url.ts`/`opcao-filter.tsx` continua; só muda a apresentação.
- Desktop: busca + segmented + chips numa única barra (`rounded-[14px] bg-card border p-3 flex-wrap`), toggle grade/lista **[opcional — confirmar]**.
- Grade: mobile `grid-cols-3 gap-x-3 gap-y-3.5`; desktop `grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-[18px] gap-y-5`. `CarregarMais` mantido.

### Séries — `(app)/series/page.tsx` + `series-manager.tsx` (`Series.dc.html`, `DesktopSeries.dc.html`)
- Lista (mobile) / grade `minmax(320px,1fr)` (desktop) de cards: `CoverStack`, nome, `TipoBadge`, "34 de 37 na estante · 21 lidos", `ProgressBar` de lidos, selo âmbar "3 furos". Dados vêm de `series_com_resumo` (já tem `faltantes`); contagens de lidos/na estante podem exigir **[dado novo]**.
- Busca + chips Todas/HQ/Mangá/"Com furos" (o filtro "Com furos" é **[opcional — confirmar]** se não existir).
- Desktop: botão "+ Nova série" no topo (abre o `serie-form` atual).

### Detalhe da série — `(app)/serie/[id]/page.tsx` + `volumes-grid.tsx` (`Serie.dc.html`, `DesktopSerie.dc.html`)
- Hero: capa (92px mobile / 168px desktop), `TipoBadge` (+ "numerada"), nome `font-heading font-extrabold text-[28px]/[44px]`, resumo, `SerieProgress`, tags da série (desktop).
- Card de furos (`bg-warning/10 border-warning/45`): "3 furos na série" + "Faltam #4, #17 e #22" + botão âmbar "+ Desejos" — adicionar os furos como desejos em lote é **[opcional — confirmar]** se o `adicionar-volumes-dialog` não cobrir.
- Grade: mobile `grid-cols-5 gap-2.5`; desktop `minmax(88px,1fr) gap-3.5`. Furos aparecem **dentro da grade**, na posição numérica, como `VolumeSlot` vazio.
- Seleção em massa: manter o fluxo atual (`selecionando`, `Checkbox`); trocar o visual pelo anel + check e pela `SelectionBar`. Dica no desktop: "Shift+clique seleciona intervalo" **[opcional — confirmar]**.

### Desejos — `(app)/desejos/page.tsx` + `desejos-lista.tsx` (`Desejos.dc.html`, `DesktopDesejos.dc.html`)
- Card de total (`border-dashed border-warning bg-warning/8`): "Para completar a lista" + soma dos preços em `font-heading` âmbar, e "12 itens · 5 de alta prioridade".
- Chips de ordenação (Prioridade / Preço / Série).
- Mobile: lista de cards (capa 52px tracejada, título, selo de prioridade, preço, botão "Adquirir" outline verde 44px — `AdquirirButton` existente). Desktop: tabela (`overflow-x-auto`, `min-w-[720px]`) com Item, Série, Prioridade, Preço (tabular-nums), Ação.
- **Prioridade é um inteiro** (`schemas.ts`, default 0). O design mostra Alta/Média/Baixa — o mapeamento número → rótulo é decisão de produto: **confirmar** antes; enquanto isso, exibir o número no selo. Cores do selo: alta `bg-warning text-primary-foreground`, média `bg-warning/15 text-warning-text`, baixa `bg-border text-muted-foreground`.

### Item — `(app)/item/[id]/page.tsx` + `item-form.tsx` (`Item.dc.html`, `DesktopItem.dc.html`)
- Mobile: faixa de fundo no topo, botões redondos "voltar" e "mais" (44px, `bg-background/55`), capa grande centralizada (168px, sombra), título "Série #N", link para a série. Desktop: capa 280px à esquerda + formulário à direita, trilha "Coleção / Série / #N".
- `SegmentedControl` de estado (Desejo / Comprado / Lido) ligado ao campo `estado` do formulário.
- Mobile mostra um `dl` 2×2 (Editora, Volume, Pago, Lido em) em modo leitura; desktop mostra os inputs do `item-form` em grade de 2 colunas. **Todos os campos atuais do `item-form` continuam** (ISBN, loja, nota, observações etc.) — o design mostra só um recorte.
- **Tags**: `tagsSerie` (herdadas) em chip **tracejado** com ícone `Layers`; `tagsItem` em chip preenchido. Legenda "Tags tracejadas são herdadas da série". Agrupar por tipo com `agruparTagsPorTipo`/`TIPOS_TAG_DEDICADOS`.
- Barra fixa "Salvar alterações" (primary, h-13) no rodapé no mobile; no desktop, Cancelar + Salvar no fim do formulário.

### Tags — `(app)/tags/page.tsx` + `tags-manager.tsx` (`Tags.dc.html`, `DesktopTags.dc.html`)
- ⚠️ **Correção ao canvas**: as telas de Tags do canvas agrupam por HQ/Mangá — **isso está errado**. No app, tags são agrupadas por **`TipoTag`** (`editora`, `personagem`, `arco`, `selo`, `autor`, `universo`, `outro` — ver `lib/tags-por-tipo.ts`). Use o **visual** do canvas com o **agrupamento real**:
  - Mobile: chips/segmented com scroll horizontal, um por tipo (labels de `TIPOS_TAG_DEDICADOS`), e a lista do tipo selecionado.
  - Desktop: grade `minmax(380px,1fr)` com um card por tipo.
- Cada card/lista: campo "Nova tag de {tipo}" + botão "Criar"; linhas de 52–56px com bolinha da cor da tag (`tag.cor`), nome, uso (contagem **[dado novo]** opcional), editar e excluir (ícones 40–44px com `aria-label`). Mantém `tags-manager`/`tag-type-combobox` e o `ConfirmDialog` de exclusão.
- Nota fixa: "Tags aplicadas a uma série são herdadas por todos os volumes dela."

### Importar CSV — `(app)/importar/page.tsx` + `importar-uploader.tsx` (`Importar.dc.html`, `DesktopImportar.dc.html`)
- Passos 1. Arquivo · 2. Revisar · 3. Importar (barra segmentada no mobile, círculos numerados no desktop).
- Card do arquivo (ícone, nome, "128 linhas · 6 colunas", "Trocar"), tiles novos / já na coleção / com erro, alerta de linhas com erro, botão "Importar N itens" (fixo no rodapé no mobile).
- Mapeamento de colunas e tabela de prévia por linha (desktop): **implementar só o que `csv-importacao.ts` já suporta**. Se o mapeamento manual de colunas não existir, é **[opcional — confirmar]**.

### Inserção rápida — `quick-add-button.tsx` + `quick-add-form.tsx` (`InsercaoRapida.dc.html`, `DesktopInsercaoRapida.dc.html`)
- Mobile: bottom sheet sobre a tela escurecida; desktop: dialog centralizado `max-w-[560px] rounded-[20px]`.
- **Hoje o quick add cria um item em "desejo"** ("Adicionar à lista de desejos"). Manter esse comportamento. O design mostra a mais:
  - campo Série com resumo ("Mangá · numerada · último na estante: #25");
  - sugestões de volume (próximo da sequência + furos em slots tracejados, e "Intervalo 26–30" no desktop usando `parseFaixasDeVolumes`);
  - seletor de estado e "Adicionar e continuar".
  Tudo isso é **[opcional — confirmar]**; a primeira entrega é só o novo visual do formulário atual.

### Login / Criar conta — `login/page.tsx`, `criar-conta/page.tsx`, `components/auth/auth-shell.tsx` (`Login.dc.html`, `DesktopLogin.dc.html`)
- São **duas rotas** (`/login`, `/criar-conta`). As "abas" do design são dois `Link` estilizados como `SegmentedControl` (aba ativa = rota atual).
- Mobile: mosaico decorativo de capas no topo (blocos de cor `aria-hidden`, girados −6°, sem gradiente), marca + subtítulo, campos `h-12 rounded-xl bg-surface-2`, botão primary h-13 no fim.
- Desktop: tela dividida — mosaico + frase "Saiba o que tem na estante — e o que falta nela." à esquerda, formulário `max-w-[400px]` à direita.
- Manter `SubmitButton`, mensagens de `auth-mensagens.ts` e as server actions.

## 5. Ordem sugerida de PRs

1. **Tokens** (`globals.css`) + `ItemCard` + componentes base (`SegmentedControl`, `FilterChip`, `StatTile`, `TipoBadge`, `ProgressBar`).
2. **Shell**: `QuickAddProvider`, `BottomNav`, `AppSidebar`, `AppHeader`, `AccountSheet`, remoção da nav em texto e do FAB no mobile.
3. **Coleção** e **Detalhe da série** (`VolumeSlot`, `SelectionBar`).
4. **Início** (com os [dados novos] de fila de leitura e capas recentes).
5. **Desejos**, **Item**.
6. **Séries**, **Tags** (com o agrupamento por `TipoTag`), **Importar**.
7. **Quick add** (visual) e **Login/Criar conta**.

Cada PR: rodar `npm run lint`, os testes (`vitest`) e conferir em 390px e 1440px.

## 6. Checklist de acessibilidade

- [ ] Contraste ≥ 4.5:1 em todo texto (o `--muted-foreground #a89cc4` sobre `#100d16` passa; não usar opacidades que o derrubem).
- [ ] Texto sobre `primary`, `warning`, `read`, `success` sempre `text-primary-foreground` (#100d16).
- [ ] Alvos de toque ≥ 44px (botões de ícone, chips, itens de nav, links "Ver tudo").
- [ ] Botões só de ícone com `aria-label`; SVGs decorativos `aria-hidden`.
- [ ] `aria-current="page"` na nav; `aria-pressed` em segmented/chips; `role="dialog"` + `aria-modal` + foco preso nos sheets.
- [ ] Estados não dependem só de cor: "Lido"/"Desejo" têm texto; furos têm borda tracejada + "falta".
- [ ] `padding-bottom` do `main` considera bottom-nav + `env(safe-area-inset-bottom)` (PWA no iPhone).

## 7. Como ler as referências (`screens/*.dc.html`)

- São artboards de um editor de design: HTML com **estilos inline**, que são a fonte da verdade para medidas, cores, raios e tipografia. Não tente rodá-los (dependem de um `support.js` do editor que não está aqui).
- `{{algo}}` são lacunas preenchidas pelo `renderVals()` do `<script type="text/x-dc">` no fim de cada arquivo — esse script tem os **dados de exemplo** (títulos, contagens, cores das capas). Os dados são fictícios; use os do banco.
- `<sc-for>` = repetição, `<sc-if>` = condição.
- Blocos de cor no lugar das capas são placeholders: no app, use `capa_url` e caia no fallback do `ItemCard` quando não houver capa.
- Traduza cores literais para os tokens da seção 1 (ex.: `#8b6cf5` → `primary`, `#e0912a` → `warning`, `#1b1726` → `surface-2`).

| Tela | Mobile | Desktop |
|---|---|---|
| Início | `Main.dc.html` | `DesktopInicio.dc.html` |
| Coleção | `Colecao.dc.html` | `DesktopColecao.dc.html` |
| Detalhe da série | `Serie.dc.html` | `DesktopSerie.dc.html` |
| Séries | `Series.dc.html` | `DesktopSeries.dc.html` |
| Desejos | `Desejos.dc.html` | `DesktopDesejos.dc.html` |
| Item | `Item.dc.html` | `DesktopItem.dc.html` |
| Inserção rápida | `InsercaoRapida.dc.html` | `DesktopInsercaoRapida.dc.html` |
| Tags | `Tags.dc.html` ⚠️ ver correção | `DesktopTags.dc.html` ⚠️ ver correção |
| Importar CSV | `Importar.dc.html` | `DesktopImportar.dc.html` |
| Login / Criar conta | `Login.dc.html` | `DesktopLogin.dc.html` |
| Menu da conta | `MenuConta.dc.html` | (sidebar, seção 2) |
