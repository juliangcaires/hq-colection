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

