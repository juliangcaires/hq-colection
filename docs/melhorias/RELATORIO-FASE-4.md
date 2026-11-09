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

## O que foi feito

- **F4.1** `0013_compartilhamento.sql`: escopos (`escopo_valido`), `compartilhamentos` (token de 64 hex gerado pelo banco; um link ativo por pessoa; gerar outro revoga o anterior; o cliente não escreve direto), `critica_privada` em itens e séries (e na cópia da crítica da série para os volumes), `perfis.escopo_amigos`, e a **camada de visibilidade** no schema `privado` (inacessível a `anon`/`authenticated`). As funções públicas `link_resumo/itens/series/capa` aceitam visitante e só resolvem o token. O tipo `vitrine_item` simplesmente não tem preço, loja, data de aquisição, observações nem prioridade. Capa privada sai só como nome do arquivo (a pasta é o id do dono). 11 testes SQL (token revogado/malformado, escopo, crítica privada, ranking sem crítica, capa por escopo, schema fechado, grants por regex).
- **F4.2** `/configuracoes`: apelido e nome (único, `3–30` de `a–z0–9_`, reservados bloqueados), link (gerar, copiar, desativar, escolher seções, "gerar novo" invalida o anterior), e a caixa "Crítica privada" no item lido e na série.
- **F4.3** `src/app/c/[token]/…`: coleção, séries, série, lidos, ranking, desejos; layout próprio sem o shell do app; `noindex` por metadata **e** por cabeçalho (`X-Robots-Tag`, `Cache-Control: private, no-store`); cliente `anon` (sem cookies). Link inválido/revogado = 404. `proxy.ts` agora casa rotas públicas **por segmento** (antes `startsWith('/c')` teria aberto `/colecao` e `/configuracoes` ao público — há teste).
- **F4.4** `/c/[token]/capa/[arquivo]`: só serve se `link_capa` autorizar (item visível no escopo do token); limite por token (90 páginas/min, 900 capas/min) em memória (`limite-taxa.ts`), 429 com `Retry-After`. Capas do catálogo público não passam por aqui (vão direto ao bucket).
- **F4.5** `0014_amigos_presentes_emprestimos.sql`: `amizades` (um registro por par; pendente → aceita), convites por link (7 dias, uso único, gerar outro invalida), solicitar por apelido (pedido cruzado vira amizade), responder/desfazer, `amigo_*` (mesmas regras do link, mas só para amigo aceito e com `escopo_amigos`). Telas `/amigos`, `/amigos/convite/[codigo]`, `/amigos/[apelido]/…`. Desfazer corta o acesso na hora.
- **F4.6** `/amigos/[apelido]/comparar` (`src/lib/comparar.ts`): séries em comum pelo nome normalizado + tipo **ou** pelo ISBN dos livros (catálogo da Fase 2), volumes que cada um tem e o outro não (descontando os que casam por ISBN), nota da série e notas dos volumes lado a lado onde os dois avaliaram.
- **F4.7** Lista de presentes: "Vou dar esse" na lista de desejos do amigo. `presentes` não tem acesso direto para ninguém; o dono nunca vê (nem na tabela, nem no item, nem na lista dele); outros amigos veem "Já tem presente marcado" sem saber por quem; comprar o item ou desfazer a amizade apaga a reserva.
- **F4.8** `/emprestimos`: registrar para quem, quando e prazo (no detalhe do item), marcar devolução, lista de abertos com "atrasado há N dias", aviso na tela inicial. Um empréstimo aberto por item; só item possuído; nunca aparece em link nem para amigos.

## Migrations a aplicar (em ordem)

1. `0010_serie_lida_e_lido_em.sql` (Fase 1)
2. `0011_catalogo_edicoes.sql` (Fase 2)
3. `0012_capas_compartilhadas.sql` (Fase 3)
4. `0013_compartilhamento.sql`
5. `0014_amigos_presentes_emprestimos.sql`

Antes de subir o código da Fase 4: aplicar `0013` e `0014` (as telas de amigos/empréstimos e a tela de configurações dependem delas).

## Dependências e variáveis novas

- Nenhuma dependência nova.
- `SUPABASE_SERVICE_ROLE_KEY` (**opcional**, só servidor, documentada em `.env.local.example`): necessária **apenas** para mostrar, em link público e na página de amigos, as capas que você enviou como foto (bucket privado). Sem ela, essas capas aparecem como "sem capa" para quem visita; as capas do catálogo público e todo o resto funcionam. A chave só é usada depois que uma função do banco autorizou o acesso e devolveu o caminho exato do arquivo. **É uma chave de projeto já existente no Supabase; ela não foi criada nem colocada em nenhum arquivo.** Para ativar: Vercel/ambiente → adicionar a variável (Project Settings → API → `service_role`).

## Decisões fora do plano

- Amigos e link têm **escopos separados**: o do link fica em `compartilhamentos.escopo`; o dos amigos em `perfis.escopo_amigos` (padrão conservador: coleção, séries e lidos).
- Seção "Lidos" ganhou página própria (`/lidos`); sem o escopo `lidos`, um item lido aparece como "comprado". "Notas e críticas" mostra a nota de itens lidos mesmo sem `lidos` (a nota implica leitura).
- Convite por link = consentimento de quem gerou + confirmação de quem abre; convite por apelido = pedido pendente até o aceite.
- Quem não tem apelido não envia nem aceita pedido (a outra pessoa não teria como abrir a coleção por apelido).
- Apelidos `convite`, `comparar` e `capa` são reservados (colidiriam com rotas).
- O limite de requisições é por instância (memória do processo), não global; em hospedagem sem servidor o teto efetivo pode ser maior. A segurança real vem do token de 244 bits e da regra de visibilidade no banco.
- Presente: o amigo só reserva desejo do dono se o escopo de amigos incluir `desejos`.
- Empréstimo atrasado: só indicação na tela (lista e Início); não há notificação push.
- Pontos de privacidade deixados de fora de propósito: `series.observacoes`, `prioridade`, preço, loja e data de aquisição não existem em nenhum tipo devolvido a terceiros.

## Pendências

- Páginas públicas e de amigos não foram abertas num navegador real aqui (build e testes passam). Conferir no celular com um link de verdade.
- Sem aviso por e-mail/push para pedido de amizade ou empréstimo atrasado.
- O link público vale para quem tem o endereço; não há senha opcional.
- Enumeração de apelidos: `amizade_solicitar` revela se um apelido existe. Aceitável para o uso entre conhecidos; vale um limite por usuário se o app abrir ao público.

## Roteiro de teste manual no celular

1. Configurações → definir apelido → "Gerar link" com Coleção + Séries → abrir o link numa **janela anônima**: vê a coleção, nenhuma loja/preço, nada de crítica.
2. Marcar uma crítica como privada, liberar "Notas e críticas" no link: a crítica privada não aparece; a pública aparece.
3. "Gerar novo link": o endereço antigo passa a dar 404 na hora. "Desativar link": idem.
4. Conferir que `/colecao` continua pedindo login numa janela anônima (rota privada).
5. Capa enviada como foto aparece no link só com a chave de serviço configurada; sem ela, aparece sem capa (sem erro).
6. Duas contas: A pede amizade por apelido, B aceita → cada um vê a coleção do outro só nas seções liberadas. B desfaz → A perde o acesso na hora.
7. Convite por link (A gera, B abre e aceita); abrir de novo o mesmo convite → "não vale mais".
8. B marca "Vou dar esse" num desejo de A: A não vê nada; uma terceira conta amiga vê "Já tem presente marcado"; A marca o item como comprado → a reserva some.
9. Comparar: duas contas com a mesma série (nomes diferentes, mesmo ISBN) → aparece em comum, com "ele tem e você não".
10. Emprestar um item com prazo de ontem → aparece "atrasado há 1 dia" em Empréstimos e no Início; "Devolvido" tira da lista.
