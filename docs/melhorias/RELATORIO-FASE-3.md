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

## O que foi feito

- **F3.1** `0012_capas_compartilhadas.sql`: `perfis` (apelido, nome, avatar, `contribuir_capas` default `false`), `capas_catalogo` + `capas_denuncias` (RLS ligada **sem policy** e sem grant: o cliente não lê nem escreve), `itens.capa_catalogo_id`, `series_busca_global`, bucket público `capas-publicas` (5 MB, só imagens, upload só com nome `<sha256>.<ext>`, sem update/delete). Funções `security definer`: `capa_catalogo_registrar`, `capa_catalogo_aplicar`, `capas_comunidade_buscar`, `capa_denunciar`, `series_busca_global_registrar`. O bucket `capas` continua privado (teste confere). 12 testes SQL novos.
- **F3.2** `src/lib/capa-catalogo.ts`: capa de API é baixada (só hosts permitidos), tem o tipo conferido pelos **bytes**, é publicada com nome = SHA-256 (mesma imagem = mesmo arquivo), registrada e aplicada ao item numa chamada. Passa por esse caminho: escolha na grade, auto-aplicação por ISBN, cadastro por ISBN/prateleira e importação CSV. Foto do usuário só vai ao catálogo com opt-in (o banco também recusa sem ele) e **sem metadados** (`src/lib/imagem.ts` tira Exif/GPS/XMP/comentários de JPEG, PNG e WebP, mantendo só a orientação).
- **F3.3** Ordem da busca: (1) catálogo por ISBN → aplica direto, sem chamada externa; (2) ISBN nos provedores; (3) grade: comunidade destacada (2+ usos na mesma edição) → provedores → comunidade da mesma edição ainda sem 2 usos → capas que só batem no nome da série (nunca aplicadas sozinhas). Candidato `comunidade` carrega `usos`. Memória global da série consultada quando o usuário não tem a própria, e alimentada a cada capa escolhida (votação: confirma, perde uma confirmação com resposta diferente, só troca em zero).
- **F3.4** Item guarda `capa_url = 'pub/<hash>.<ext>'` + `capa_catalogo_id`; `urlsDeCapas` resolve para a URL pública do bucket (só aceita o formato exato do hash) ou para `/api/capa/…` como antes, então grade, detalhe, ranking e séries funcionam sem mudar consulta. `removerCapaAntiga` nunca apaga capa `pub/`. CSP (`src/lib/csp.ts`, extraída do `proxy.ts`) libera só o prefixo `…/object/public/capas-publicas/`, não o Supabase inteiro.
- **F3.5** Grade de candidatos (`candidatos-de-capa.tsx`) com selo "usada por N colecionadores", destaque "Mais usada" a partir de 2 e botão "Capa errada ou imprópria" (3 denúncias de pessoas diferentes tiram a capa das sugestões). Nova página `/configuracoes` com o opt-in (desligado por padrão, texto avisa que apagar a própria capa não apaga a do catálogo), linkada no menu da conta e na barra lateral.

## Migrations a aplicar (em ordem)

1. `0010_serie_lida_e_lido_em.sql` (Fase 1)
2. `0011_catalogo_edicoes.sql` (Fase 2)
3. `0012_capas_compartilhadas.sql` — cria o bucket `capas-publicas` por SQL; se o projeto Supabase restringir `storage.buckets` ao dashboard, crie o bucket manualmente (público, limite 5 MB, MIME `image/jpeg,image/png,image/webp`) e rode só a policy `capas_publicas_insert`.

## Dependências adicionadas

Nenhuma nesta fase.

## Decisões fora do plano

- **`usos` é contado ao vivo** (pessoas diferentes com item apontando para a capa), não um contador gravado: apagar item ou trocar de capa reduz sozinho e não precisa de gatilho. Capa repetida não duplica (hash) e "incrementa" por esse cálculo.
- A tabela do catálogo guarda `chave_normalizada`, `serie_chave` e `isbn13` próprios (com `edicao_id` opcional) para achar capa de item que não tem edição cadastrada.
- Encontrar a capa **por ISBN** no catálogo aplica direto (mesma confiança do ISBN nos provedores); por chave ou só pelo nome vai para a grade.
- Revisão de capas denunciadas: direto no Supabase — para liberar, apagar as linhas de `capas_denuncias` da capa e `update capas_catalogo set oculta = false`.
- O prefixo `pub/` em `itens.capa_url` evita mexer em todas as consultas; quem lê `capa_url` precisa passar por `urlsDeCapas` (já é o padrão do app).
- Limitação conhecida: qualquer usuário logado consegue, falando direto com a API do Storage, enviar um arquivo com nome-hash ao bucket público (o limite de 5 MB e os MIME do bucket valem, mas o conteúdo só é conferido quando passa pelo app). Ele só aparece para outros se for registrado no catálogo, o que exige a função.
- Fotos já enviadas antes do opt-in continuam privadas (não são migradas).

## Pendências

- Verificar em produção que `next/image` com `unoptimized` carrega a URL do bucket público sem configurar `remotePatterns` (a documentação indica que a validação de host é do loader padrão, que o `unoptimized` ignora; o card de item usa `<Image unoptimized>`).
- Sem tela de revisão de denúncias (decisão do plano).

## Roteiro de teste manual no celular

1. Item sem capa → "Buscar capa automática" → escolher uma candidata; abrir o mesmo livro em **outra conta**: a capa deve vir primeiro com "usada por 1 colecionador".
2. Com 2 contas usando a mesma capa: selo "Mais usada" e borda verde na terceira conta.
3. "Capa errada ou imprópria" em 3 contas diferentes: a capa some da grade da quarta.
4. Configurações → ligar "Contribuir com as capas que eu enviar" → enviar uma foto de capa tirada no celular → conferir (sem login, no navegador) que a URL pública abre, que a imagem não está deitada e que não há metadados (ex.: `exiftool`).
5. Desligado (padrão): foto enviada continua só na sua conta (abrir a URL `/storage/v1/object/public/capas-publicas/…` de outra conta não deve existir).
6. Apagar um item que usa capa do catálogo: a capa continua disponível para os outros.
7. Cadastrar por ISBN um livro já cadastrado por outra conta: a capa deve vir do catálogo, sem chamada externa.
