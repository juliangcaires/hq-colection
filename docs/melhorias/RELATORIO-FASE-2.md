# Relatório — Fase 2: catálogo de edições e cadastro por ISBN

## Plano da fase

Branch: `feat/melhorias-fase-2` (empilhada sobre `feat/melhorias-fase-1`).

| Tarefa | Arquivos |
| --- | --- |
| F2.1 | `supabase/migrations/0011_catalogo_edicoes.sql` (`edicoes`, `editora_apelidos`, `itens.edicao_id`, `edicao_registrar`, `itens_por_isbn`, limite de consultas), testes SQL |
| F2.2 | `src/lib/isbn.ts` + teste |
| F2.3 | `src/lib/texto.ts`, `src/lib/edicao-titulo.ts`, `src/lib/isbn-busca.ts` (catálogo → BrasilAPI → Google Books) + testes com respostas fixas; `capa-busca.ts` exporta o que precisar |
| F2.4 | `src/app/(app)/itens/isbn-actions.ts` (`consultarIsbn`) |
| F2.5 | `src/lib/casamento.ts` + teste (série parecida, editora por apelido, autores) |
| F2.6 | `src/components/quick-add/quick-add-isbn.tsx`, `quick-add-provider.tsx`, `quick-add-form.tsx` (ISBN inicial), action `cadastrarPorIsbn`, `item_salvar` com `edicao_id` |
| F2.7 | `src/components/quick-add/leitor-isbn.tsx`, `next.config.ts` (Permissions-Policy da câmera), dependência de fallback |
| F2.8 | modo prateleira em `src/components/quick-add/prateleira-isbn.tsx`, action `cadastrarLoteDeIsbn` |
| F2.9 | `createItem`/`updateItem` alimentam o catálogo (origem `usuario`) |

Ordem: F2.1 → F2.9, um commit por tarefa.

