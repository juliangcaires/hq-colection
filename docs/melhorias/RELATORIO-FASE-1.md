# Relatório — Fase 1: série lida com avaliação em cascata

## Plano da fase

Branch: `feat/melhorias-fase-1` (a partir da `master`).

| Tarefa | Arquivos | 
| --- | --- |
| F1.1 | `supabase/migrations/0010_serie_lida_e_lido_em.sql` (coluna `lido_em`, `serie_marcar_lida`, `serie_desfazer_marcacao`), `src/lib/__tests__/migrations-sql.test.ts` |
| F1.2 | mesma migration (`item_salvar`), `itens/actions.ts` (`marcarLidoEmLote`), `importar/actions.ts`, `schemas.ts`, `types.ts`, `queries.ts`, `item-form.tsx` |
| F1.3 | `itens/actions.ts` (`marcarSerieComoLida`, `desfazerMarcacaoSerie`), `schemas.ts`, `rpc.ts` |
| F1.4 | `src/components/series/marcar-serie-lida-dialog.tsx`, `serie/[id]/page.tsx` |
| F1.5 | `avaliar-serie.tsx` + `avaliarSerie` passam a usar a mesma função SQL |
| F1.6 | texto de prévia da crítica no modal |
| F1.7 | `src/lib/volumes.ts` (`serieEstaLida`), card em `series-manager.tsx`, hero da série, `series_com_resumo` não muda |

Ordem: F1.1 → F1.7. Um commit por tarefa.

## O que foi feito

- **F1.1** `0010_serie_lida_e_lido_em.sql`: coluna `itens.lido_em`; `serie_marcar_lida(p_serie, p_nota, p_critica, p_modo, p_marcar_lidos)` e `serie_desfazer_marcacao(p_serie, p_snapshot)`. Transacionais, `security invoker`, com trava por série. Modos `serie`, `serie_e_sem_nota`, `serie_e_todos`. Testes em `migrations-sql.test.ts`.
- **F1.2** `lido_em` preenchido por *trigger* (`trg_itens_lido_em`) quando o estado vira `lido` e limpo ao sair dele. Cobre item individual, lote, CSV e volumes em lote sem mexer em cada caminho. `item_salvar` grava `lido_em` editado; campo "Lido em" na seção "Minha leitura" do item.
- **F1.3** Actions `marcarSerieComoLida` e `desfazerMarcacaoSerie` (Zod com `.max()`, revalida série, listagens, ranking e itens).
- **F1.4** `MarcarSerieLidaDialog` na tela da série (aparece quando há volume comprado): prévia (vira lido / desejos de fora / furos), nota e crítica opcionais, "Pular", três opções de aplicação, toast de 10 s com "Desfazer".
- **F1.5** `avaliarSerie` agora usa a mesma função SQL (com `p_marcar_lidos = false`). Modos `serie` | `serie_e_sem_nota` (padrão) | `serie_e_todos` | `media`. `OpcaoRadio` extraído para componente compartilhado.
- **F1.6** Aviso "A crítica vai para N volumes sem crítica; M mantêm a própria" nos dois modais.
- **F1.7** `serieEstaLida` (TS) e coluna `lida` em `series_com_resumo` (paridade testada); selo "lida" no card e "série lida" no hero.

## Migrations a aplicar (em ordem)

1. `supabase/migrations/0010_serie_lida_e_lido_em.sql` (recria `series_com_resumo` com a coluna `lida`; aplicar antes de subir o código, senão a lista de séries perde o selo e as ações novas falham).

## Dependências adicionadas

Nenhuma.

## Decisões fora do plano

- `lido_em` por trigger em vez de código em cada action (mais simples e cobre CSV/lote). Fuso `America/Sao_Paulo`.
- `serie_marcar_lida` ganhou o 5º parâmetro `p_marcar_lidos` (padrão `true`) para o `AvaliarSerie` reaproveitar a mesma regra sem marcar nada como lido.
- `p_critica = ''` limpa a crítica da série; `null` não mexe. A crítica só vai para volumes lidos com crítica vazia, em todos os modos.
- O "Desfazer" também restaura nota e crítica da própria série.
- Série sem volume comprado não mostra o botão "Marcar série como lida" (a avaliação continua em "Nota da série").
- Itens lidos antes da migration ficam com `lido_em` nulo; editar o item para outro estado e voltar a lido grava a data de hoje.

## Pendências

- `npm run lint`, `tsc`, testes e `build` passaram. Nenhum teste de interface (o projeto não tem).

## Roteiro de teste manual (celular)

1. Abrir uma série com volumes comprados e desejos → "Marcar série como lida": conferir contagens e furos.
2. "Pular": só marca; usar "Desfazer" no toast e ver os volumes voltarem a comprados.
3. Dar nota 4 com "Série + volumes sem nota" num volume que já tinha nota: a nota dele não muda.
4. Escolher "Série + todos os volumes": a nota dos volumes é substituída, a crítica de cada volume continua.
5. Escrever crítica: ver o aviso N/M e conferir nos volumes.
6. Comprar um volume novo na série lida: o selo "série lida" some.
7. Item lido: ver/editar "Lido em".
