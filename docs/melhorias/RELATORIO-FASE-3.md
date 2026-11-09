# Relatório — Fase 3: capas compartilhadas

## Plano da fase

Branch: `feat/melhorias-fase-3` (empilhada sobre `feat/melhorias-fase-2`).

Modelo escolhido: o item continua lendo `itens.capa_url`. Quando a capa vem do catálogo, `capa_url` guarda `pub/<hash>.<ext>` (arquivo no bucket público `capas-publicas`) e `capa_catalogo_id` aponta a linha de `capas_catalogo`. Assim grade, detalhe, ranking e importação continuam usando `urlsDeCapas` sem mudar de consulta; só o mapeamento de URL aprende o prefixo `pub/`.

| Tarefa | Arquivos |
| --- | --- |
| F3.1 | `supabase/migrations/0012_capas_compartilhadas.sql` (`perfis`, `capas_catalogo`, denúncias, bucket `capas-publicas`, `itens.capa_catalogo_id`, `series_busca_global`, funções `security definer`), testes SQL |
| F3.2 | `src/lib/capa-catalogo.ts` (hash SHA-256, upload público, registro), `src/lib/imagem.ts` (tipo por bytes e remoção de metadados), `aplicarCapaEscolhida`, `/api/capa/buscar`, `cadastro-isbn.ts`, importação, `uploadCapaManual` (opt-in) |
| F3.3 | `/api/capa/buscar` e `buscarCandidatos`: catálogo por ISBN → por chave → provedores → só pelo nome; memória global da série |
| F3.4 | `urlsDeCapas` (prefixo `pub/`), `removerCapaAntiga` (não apaga catálogo), CSP em `src/proxy.ts`, queries e telas |
| F3.5 | UI do item (selo, destaque, "Capa errada ou imprópria"), página `/configuracoes` com o opt-in, `perfis` actions |

Ordem: F3.1 → F3.5, um commit por tarefa.

