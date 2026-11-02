# Detalhe do item — layout "Ficha com capa fixa" (Opção A)

Spec da nova tela `/item/[id]` (`src/app/(app)/item/[id]/page.tsx` + `src/components/itens/item-form.tsx`).
Substitui a seção "Item" do `docs/redesign/HANDOFF.md`. As referências visuais estão nesta pasta:

| Estado | Referência |
|---|---|
| Lido | `ItemOpcaoA.dc.html` |
| Desejo | `ItemOpcaoADesejo.dc.html` |
| Comprado | `ItemOpcaoAComprado.dc.html` |

Como ler os `.dc.html`: seção 7 do `HANDOFF.md` (estilos inline = medidas/cores; `{{…}}` e o `<script>` no fim = dados de exemplo; a capa aparece como bloco de cor porque é placeholder).

## Regras

- **Nenhuma mudança de dados, schema ou server action.** Só layout e exibição condicional. Os campos continuam todos no mesmo `<form>` e são enviados como hoje — campos escondidos pelo estado mantêm o valor (renderizar `hidden`/não montar, mas **não zerar** no submit, a menos que já seja o comportamento atual).
- Reaproveitar o que já existe: `Estrelas` (meia estrela), `critica`, `marcar-lido-dialog.tsx`, `AdquirirButton`, combobox de tags por tipo (`tag-type-combobox`, `TIPOS_TAG_DEDICADOS`), botões de capa (buscar / enviar foto).
- Tokens do `globals.css` (`surface-2`, `warning`, `success`, `read`, `link`, `border-strong`…). Alvos ≥ 44px.

## Layout (≥ lg)

Duas colunas dentro do `main` (`max-w-[1120px] mx-auto`), `flex flex-wrap gap-9 items-start`:

**Barra do topo**: link "← Coleção" (ou "← Desejos" quando o item é desejo / veio de lá) à esquerda; à direita botão `⋯` 44px (DropdownMenu) com **Excluir item** (abre o `ConfirmDialog` atual). O botão "Excluir item" sai do rodapé do formulário.

**Coluna esquerda** (`flex: 0 1 300px; min-w-[240px]`, `lg:sticky lg:top-5`):
1. Capa `aspect-[2/3] rounded-xl` com sombra. Selo no canto conforme o estado (abaixo).
2. Dois botões lado a lado, h-11: **Buscar capa** · **Enviar foto**. O texto "Cobertura automática de edição brasileira é irregular…" vira `title`/tooltip do botão Buscar capa (não fica mais visível o tempo todo).
3. **Resumo** (`dl` em card `rounded-[14px] bg-card border p-3.5`, linhas `flex justify-between`, rótulo muted): muda conforme o estado (abaixo). Só leitura.

**Coluna direita** (`flex: 1 1 520px; min-w-0`, `flex-col gap-[18px]`):
1. `h1` título — `font-heading font-extrabold text-[40px] leading-[1.05] tracking-tight`; abaixo `TipoBadge` + "Série · #N" (ou "Avulso (sem série) · #N"), muted.
2. `SegmentedControl` de estado (máx. 460px). Cor do botão ativo: Desejo `bg-warning`, Comprado `bg-primary`, Lido `bg-read` — sempre `text-primary-foreground`.
3. **Bloco de estado** (muda conforme o estado — abaixo).
4. **Tags** (card): só os tipos que têm tag, como chips (`h-8 rounded-full bg-primary/20`, rótulo do tipo em 12px muted antes, `×` para remover; herdadas da série = chip tracejado com ícone `Layers`, sem `×`). Embaixo, um botão tracejado `+ {Tipo}` para cada tipo **sem** tag (`h-9 rounded-full border-dashed border-input text-link`), que abre o combobox daquele tipo. Some a grade fixa de 7 inputs.
5. **Dados** e **Compra** (cards) lado a lado em `grid-cols-[repeat(auto-fit,minmax(300px,1fr))]`:
   - Dados: Título; Série (select atual) + Nº (2fr/1fr); Tipo + ISBN (1fr/2fr).
   - Compra: Preço + Data de aquisição; Loja.
6. **Barra de salvar fixa** (`sticky bottom-0`, `bg-card/95 backdrop-blur border-t border-border-strong`, ocupa a largura do `main`): aparece **só quando o formulário está alterado** (dirty): "● Alterações não salvas" em `text-warning-text` + **Descartar** (reset do form) + **Salvar alterações** (primary). Sem alterações, a barra não aparece.

## Por estado

### Lido (`ItemOpcaoA.dc.html`)
- Selo da capa: "Lido" (`bg-read`). 
- Resumo: Estado **Lido** (cor `danger-text`) · Nota **★ 4,5** (`warning-text`) · Adquirido (data ou —) · ISBN.
- Bloco de estado = **"Minha leitura"**: título + `Estrelas` (30px) com o valor numérico ao lado em `font-heading` âmbar, na mesma linha; abaixo `Textarea` da crítica, **5 linhas**, `bg-surface-2`.
- Ordem: Minha leitura → Tags → Dados | Compra.

### Desejo (`ItemOpcaoADesejo.dc.html`)
- Capa com `border-2 border-dashed border-warning` e fundo esmaecido; selo "Desejo" (`bg-warning`). Link de volta: "← Desejos". Na sidebar, "Desejos" ativo.
- Resumo (card com borda tracejada âmbar): Estado **Desejo** · Prioridade · Preço esperado · ISBN.
- Bloco de estado = **"Na lista de desejos"** (`bg-warning/7 border border-dashed border-warning/60 rounded-2xl`):
  - no cabeçalho, à direita: **Adquirir** (verde `bg-success`, ícone check) — usa a ação do `AdquirirButton`;
  - grade `auto-fit minmax(200px,1fr)`: **Prioridade** como stepper `− N +` (h-11, botões 44px, dica "Maior número = comprar antes."), **Preço esperado** (= campo `preco`), **Onde encontrar** (= campo `loja`).
- **Não mostrar** o card Compra (data de aquisição). Dados fica em largura total (grade de 4 campos `auto-fit minmax(200px,1fr)`).
- Nota e crítica **não aparecem**; no fim, uma linha discreta tracejada com ícone de estrela: "Nota e crítica aparecem quando você marcar como lido."
- Ordem: Na lista de desejos → Tags → Dados → aviso.

### Comprado (`ItemOpcaoAComprado.dc.html`)
- Selo da capa: "Na fila" (`bg-primary`).
- Resumo: Estado **Comprado** (`text-link`) · Adquirido · Pago · ISBN.
- Bloco de estado = card **"Ainda não lido"**: 5 estrelas vazias (contorno `border-input`, decorativas), título + "Está na sua fila de leitura. Ao terminar, dê uma nota e escreva a crítica." e botão **Marcar como lido** (`bg-success`) — abre o `marcar-lido-dialog` existente (nota + crítica).
- Prioridade **não aparece**.
- Ordem: Ainda não lido → Tags → **Compra | Dados** (Compra primeiro, rótulo "Preço pago").

### Tabela-resumo

| | Desejo | Comprado | Lido |
|---|---|---|---|
| Selo da capa | Desejo (âmbar), capa tracejada | Na fila (violeta) | Lido (vermelho) |
| 1º bloco | Na lista de desejos + Adquirir | Ainda não lido + Marcar como lido | Minha leitura (nota + crítica) |
| Prioridade | ✅ stepper | — | — |
| Nota / crítica | — (aviso) | — (via dialog) | ✅ |
| Card Compra | — (preço/loja no 1º bloco) | ✅ primeiro | ✅ |
| Resumo | estado, prioridade, preço esperado, ISBN | estado, adquirido, pago, ISBN | estado, nota, adquirido, ISBN |

Trocar o estado no `SegmentedControl` troca os blocos na hora (estado local do form); só persiste ao salvar. Ao passar de Comprado → Lido pelo segmented, mostrar o bloco "Minha leitura" vazio para preencher.

## Mobile (< lg)

Mesma ordem em uma coluna: capa (centralizada, ~200px) com os botões de capa → título → segmented → bloco de estado → Tags → Dados e Compra como `<details>` recolhidos (abertos se tiverem erro de validação). Resumo da capa vira uma linha de chips abaixo do título. Barra de salvar fixa acima da bottom-nav (`bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom))]`), só quando dirty.

## Aceite

- [ ] Os 3 estados batem com as referências em 1440px; em 390px seguem a ordem do mobile.
- [ ] Nenhum campo perdeu valor ao alternar estados e salvar.
- [ ] Excluir só pelo menu `⋯`, com confirmação.
- [ ] Barra de salvar só aparece com alterações; Descartar volta aos valores do banco.
- [ ] `npm run lint` e `vitest` passando.
