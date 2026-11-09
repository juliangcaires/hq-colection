# Relatório — Fase 4: compartilhamento

## Plano da fase

Branch: `feat/melhorias-fase-4` (empilhada sobre `feat/melhorias-fase-3`).

Arquitetura: a RLS das tabelas atuais **não muda**. Terceiros só leem por funções `security definer` que devolvem colunas explícitas (nunca preço, loja, data de aquisição, observações, prioridade). A lógica de visibilidade fica numa só camada interna (schema `privado`, sem acesso para os papéis do app) e dois conjuntos de funções públicas a envolvem: `link_*` (por token, aceitam `anon`) e `amigo_*` (por apelido, só `authenticated` e só se a amizade foi aceita). Assim o link público e a página de amigo mostram exatamente as mesmas regras.

| Tarefa | Arquivos |
| --- | --- |
| F4.1 | `supabase/migrations/0013_compartilhamento.sql` (escopos, `compartilhamentos`, `critica_privada`, schema `privado`, `link_*`), testes SQL |
| F4.2 | `/configuracoes` (apelido, nome, link: gerar/revogar/copiar/escopo), `critica_privada` nos formulários de item e série |
| F4.3 | `src/app/c/[token]/…` (layout próprio, `noindex`), `src/proxy.ts` (rota pública, correção do casamento de prefixo) |
| F4.4 | `src/app/c/[token]/capa/[arquivo]/route.ts`, `src/lib/limite-taxa.ts` |
| F4.5 | migration `0014_amigos_presentes_emprestimos.sql` (`amizades`, convites), `/amigos`, `/amigos/[apelido]` |
| F4.6 | `src/lib/comparar.ts`, `/amigos/[apelido]/comparar` |
| F4.7 | `presentes` (mesma migration 0014), botão "Vou dar esse" na lista de desejos do amigo |
| F4.8 | `emprestimos` (mesma migration 0014), `/emprestimos`, ação "Emprestar" no item |

Ordem: F4.1 → F4.8, um commit por tarefa.

