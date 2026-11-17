# Estudo: a mesma obra entre usuários (notas, feed, variante)

Data: 17/11/2026 · Só estudo, sem código · Base para as demandas 5 (`feat/capa-variante`), 6 (`feat/feed-de-amigos`) e 7 (`feat/notas-entre-amigos`).

## Decisões já tomadas (Julian)

- Modelo "Letterboxd completo", mas **notas e críticas só entre amigos**. Sem página pública da obra.
- "Média da obra" = **média das notas dos amigos** (nunca de desconhecidos).
- Feed: "leu X" + nota + crítica + capa; amigos curtem e comentam; aba nova **Feed**; compartilhar é automático quando o interruptor geral em Configurações está ligado; resumo semanal só como card no app.
- Variante da capa: conta 2 na estante e 1 em lidos/progresso; variante e normal compartilham lido, nota, crítica e data de leitura.

## Ponto de partida (o que o código já tem)

- `itens` guarda `nota` (0,5 a 5, meia estrela), `critica` (0008), `critica_privada` (0013), `lido_em` (0010, preenchido por trigger quando vira `lido`), `isbn` (texto livre) e `edicao_id` (0011, opcional).
- `series` guarda `nota`/`critica` próprias (0009). Sem nota própria, a exibida é a média dos volumes lidos e avaliados.
- `edicoes` (0011) é catálogo global: `isbn13` único (ou `chave_normalizada` única quando não há ISBN). A chave vem de `chaveEdicao()` em `src/lib/texto.ts`: `série|número|tipo|editora`, tudo normalizado. Escrita só por `edicao_registrar`. Nunca guarda nota, crítica ou preço.
- `capas_catalogo` e `series_busca_global` (0012) já usam `chave_normalizada` e `serie_chave` (`série|tipo`) como identidade entre usuários.
- Amizade (0014): `amizades` (aceite dos dois lados), `privado.sao_amigos(a, b)`. O amigo lê por funções `security definer` (`amigo_*`) que reaproveitam a camada `privado.v_*`. Nota só sai se `perfis.escopo_amigos` contém `notas_criticas`; crítica com `critica_privada` nunca sai. O padrão do repo: **tabelas sem grant de escrita/leitura direta para terceiros; tudo por RPC**.
- `perfis` (0012, 0016) tem apelido, nome, `avatar_url`.
- **Numeração:** o enunciado fala em "migration 0014" para a RLS por amizade, mas a 0014 já existe e é a das amizades. A 0015 e a 0016 também estão usadas. **Próxima livre: 0017.**

---

## 1. Identidade da obra

### Níveis

| Nível | O que é | Chave | Onde já existe |
|---|---|---|---|
| Edição | Um exemplar publicado (ISBN) | `edicoes.id` / `isbn13` | `itens.edicao_id`, `itens.isbn` |
| **Obra (volume)** | O mesmo volume, em qualquer edição/editora | `obra_chave` (nova) | não existe |
| Série | A coleção inteira | `serie_chave` (`série|tipo`) | `capas_catalogo.serie_chave` |

Notas, críticas e feed pertencem à **obra (volume)**, não à edição: quem leu "Berserk #3" pela Panini e quem leu pela edição de luxo avaliaram a mesma história. A edição continua servindo para capa e dados bibliográficos.

### `obra_chave`

`normalizarParaChave(série) | número | tipo`, **sem editora** (a `chaveEdicao` atual inclui editora e por isso separaria edições). Casos:

- Volume de série: `berserk|3|manga`.
- Número ausente (one-shot dentro de série, especial): usar o título normalizado no lugar do número.
- Avulso (sem série): `normalizarParaChave(titulo) || '' || tipo`.

Calculada no app (a normalização depende de `src/lib/texto.ts`, que não existe em SQL) e **gravada em `itens.obra_chave`** por `item_salvar`, igual ao padrão de `edicoes.chave_normalizada`. Equivalente para séries: `series.serie_chave`, gravada por `serie_salvar`. Índices parciais em ambas.

### Ordem de casamento entre usuários

1. **ISBN-13 igual** (`edicoes.isbn13`, ou `itens.isbn` limpo para itens sem `edicao_id`): é a prova mais forte.
2. `edicao_id` igual.
3. `obra_chave` igual (cobre itens sem ISBN e edições diferentes do mesmo volume).

Na prática a consulta usa `obra_chave` e o ISBN só ajuda a **preencher/corrigir** a chave: ao salvar um item com `edicao_id` cujo `edicoes` tem série/número/tipo, a chave sai dos dados do catálogo (mais confiáveis que o texto digitado).

### Exigir ISBN?

**Não.** Muitos itens não têm (HQ antiga, importada, sem código legível) e exigir quebraria o cadastro manual. Sem ISBN a obra casa pela `obra_chave`; ISBN só melhora a precisão. Itens sem série e sem ISBN casam por título normalizado, o que erra mais; o app deve **mostrar na página do item quem foi casado e por quê** ("mesmo ISBN" / "mesmo nome e volume") e aceitar que o amigo fique de fora quando o nome for muito diferente.

### Série x volume

- Volume: nota/crítica do item.
- Série: `series.nota`/`critica` (já existem). A página da série mostra a média dos amigos usando a regra da 0009: a nota da série do amigo, ou, se não tiver, a média dos volumes lidos e avaliados dele.
- Casamento de séries por `serie_chave`. **Risco:** homônimas de editoras diferentes (mesmo nome, outro selo) caem juntas. Aceito no v1; o desempate futuro é incluir a editora, não agora.

### Quando a chave falha

Falsos positivos (títulos iguais de obras distintas) e falsos negativos (grafias diferentes). Como só amigos veem, o dano é pequeno. Não há UI de "corrigir vínculo" no v1.

### Backfill

Itens existentes não têm `obra_chave`. Script/rota única (administrativa, em lote) calcula com `chaveEdicao`-like e grava. Sem isso a média dos amigos só enxerga itens salvos depois da migration.

---

## 2. Notas e críticas entre amigos

### Princípio: não criar tabela de avaliações

A avaliação **já é** `itens.nota` / `itens.critica` (e `series.*`). Duplicar numa tabela nova criaria dois lugares para editar e sincronizar. O que falta é só **consultar por obra entre amigos**.

### O que reaproveitar

- `itens.nota`, `critica`, `critica_privada`, `lido_em`: sem mudança.
- `privado.sao_amigos` e `perfis.escopo_amigos`: mesma porta de acesso.
- Regra de visibilidade: **a mesma de `privado.v_itens`** (nota só se `lido` e escopo tem `notas_criticas`; crítica só se não for `critica_privada`). Extrair para uma função interna única (`privado.v_avaliacao`) usada por `v_itens`, pelas notas e pelo feed. Assim há uma regra só.

### Funções novas (leitura)

- `obra_amigos(p_obra_chave text)` → uma linha por amigo que tem item **lido** dessa obra: `apelido`, `nome_exibicao`, `avatar_url`, `nota`, `critica` (respeitando as regras acima), `lido_em`, `item_id`. Mais o agregado `media` e `qtd` calculados sobre as notas visíveis. Se o amigo tem normal + variante, **conta uma vez por pessoa** (ver seção 4).
- `serie_amigos(p_serie_chave text)` → o mesmo para série, com a regra da 0009.
- Ambas: `security definer`, `search_path` fixo, `auth.uid()` obrigatório, só amigos aceitos (checado a cada chamada, então desfazer amizade corta o acesso na hora), sem escrita.

### Escopo (dúvida registrada)

Hoje o padrão de `escopo_amigos` **não** inclui `notas_criticas` (começa conservador). Se a média depender dele, quase ninguém aparece. Decisão conservadora adotada no estudo: **manter `notas_criticas` como a porta única** de nota e crítica, e na D6/D7 o interruptor do feed em Configurações oferece ligar os dois juntos (texto claro: "amigos veem suas notas e críticas"). Não mudar o padrão de quem já tem conta. Se o Julian preferir que o padrão novo inclua, é só mudar o default nas contas novas; **fica para ele decidir**.

### O que aparece na tela

- **Item:** bloco "Amigos": média (ex.: 4,2 · 3 amigos), lista com avatar, apelido, nota, crítica e data; sua própria nota continua separada.
- **Série:** idem, com a nota da série.
- Sem nenhum amigo com nota: o bloco não aparece (sem "0 amigos").
- Sem página pública da obra, sem ranking global, sem busca por obra de desconhecido.

### Privacidade

- Desconhecido nunca vê nada. Ex-amigo deixa de ver na hora.
- Crítica privada nunca sai, nem no feed.
- O amigo A **não** vê que o amigo B existe só por causa da média: a média é anônima; a lista mostra só quem é amigo **de quem está olhando** (todos os listados já são amigos do viewer, pois a consulta parte das amizades dele).

---

## 3. Modelo de dados do feed (compartilhado com as notas)

### Proposta: o feed é uma projeção de `itens`, sem tabela de eventos

Cada "leu X" é um item `lido` de um amigo. Tabela de eventos copiaria título/nota/crítica/capa (e ficaria desatualizada ao editar a nota ou marcar a crítica como privada). Em vez disso:

- `feed_listar(p_limite, p_antes)`: itens `lido` dos **amigos aceitos** com feed ligado, ordenados por `lido_marcado_em desc`, lendo título, capa, nota e crítica **ao vivo** pela mesma `privado.v_avaliacao` das notas. Mudou a nota ou ligou "crítica privada": o feed muda junto, sem job de limpeza.
- Coluna nova `itens.lido_marcado_em timestamptz`, preenchida pelo mesmo trigger de `lido_em` (0010) quando o item vira `lido` (instante exato; `lido_em` é só data e editável). Limpa ao deixar de ser lido.
- Só entram itens com `lido_marcado_em` recente (janela de 90 dias) e não ocultos. **Não há backfill do passado**: itens já lidos têm `lido_marcado_em` nulo e ficam de fora, para o feed não nascer despejando a estante inteira.
- Marcação em lote (série inteira, CSV, volumes em lote) gera N itens: a consulta **agrupa por pessoa + série + dia** ("leu 12 volumes de Berserk").
- Coluna `itens.feed_oculto boolean default false` permite o dono tirar um item do feed sem mexer em nota.

### Interruptor geral

`perfis.feed_ativo boolean not null default false` (conservador: nada compartilhado até a pessoa ligar) e `perfis.feed_visto_em timestamptz` (para o selo de "novidades" e o card semanal). Quem desliga some do feed dos amigos imediatamente, inclusive o histórico.

### Curtidas e comentários

Alvo = **o item** (a avaliação), não um evento. Assim a conversa vale tanto no feed quanto na lista de críticas da obra, e sobrevive se o item sair e voltar ao feed.

```
feed_curtidas    (item_id → itens on delete cascade, user_id → auth.users on delete cascade, created_at, PK(item_id, user_id))
feed_comentarios (id, item_id → itens on delete cascade, user_id → auth.users on delete cascade,
                  texto (1..500), created_at)
```

Escrita só por RPC (`feed_curtir`, `feed_descurtir`, `feed_comentar`, `feed_apagar_comentario`), todas `security definer`, nenhuma com grant direto de tabela (padrão do repo). Quem pode agir: **dono do item ou amigo aceito dele**, e só se o item está visível para o viewer (lido, feed ligado, não oculto).

### RLS por amizade

- Tabelas com RLS ligada, `revoke all` de `anon` e `authenticated`, sem policy de leitura ampla; leitura só pelas funções.
- Leitura de curtidas/comentários de um item: o viewer vê as do **dono**, as **próprias** e as de **pessoas que são amigas dele**. Não aparece desconhecido (amigo do dono que não é amigo do viewer). Regra conservadora que evita vazar quem conhece quem.
- Apagar comentário: o autor ou o dono do item.
- Item deixa de ser lido: some do feed, curtidas e comentários ficam guardados (voltam se ele for relido). Item apagado ou conta apagada: cascade.
- `feed_resumo_semana()`: contagem e destaques (quantos amigos leram, mais bem avaliados) dos últimos 7 dias, calculado ao abrir o app. Sem e-mail, sem push.
- Limite de taxa nos comentários (`src/lib/limite-taxa.ts`) e texto sempre renderizado como texto puro (nada de HTML).

### Estrutura compartilhada com as notas

Uma função interna `privado.v_avaliacao(p_viewer, p_item)` decide **o que do item o viewer enxerga** (nota, crítica, capa, data). `obra_amigos`, `serie_amigos`, `feed_listar` e `v_itens` a usam. As curtidas/comentários da D6 também aparecem na lista de críticas da D7, sem tabela nova.

---

## 4. Impacto na capa variante

- **Variante não é uma obra nova.** É outro exemplar da mesma obra (capa/edição diferente). Modelo: `itens.variante_de uuid references itens(id) on delete set null` (D5). A variante herda a `obra_chave` do item principal.
- **Sincronização** (decisão 8.2): lido, nota, crítica, `lido_em` e `critica_privada` espelham do principal; editar em qualquer um propaga. Isso evita variante com nota diferente.
- **Média e feed contam uma vez por pessoa:** `obra_amigos` e `feed_listar` ignoram itens com `variante_de is not null` (o principal basta). Estante conta 2, lidos/progresso/ranking contam 1: a D5 precisa ajustar `privado.v_itens` (seções `lidos` e `ranking`) e as estatísticas.
- **Cadeia:** variante de variante é proibida (a variante aponta sempre para um principal; trigger/validação).
- **Edição e ISBN:** a variante pode ter ISBN próprio (vira outra `edicoes`) ou nenhum. Sem ISBN, a `chave_normalizada` da edição (inclui editora) tende a ser a mesma do principal e as duas **compartilham a mesma linha de `edicoes`**; `itens.edicao_id` não é único, então não quebra.
- **Risco de capa (verificar na D5):** a capa da variante não pode virar a "capa da obra" no catálogo comunitário (`capas_catalogo` por `chave_normalizada`), senão outro usuário recebe a variante como sugestão da edição normal. Recomendação: contribuir a capa da variante ao catálogo **só se tiver ISBN próprio**, ou não contribuir.
- **Vínculo no cadastro e depois** (8.3): o vínculo é só `variante_de`; a escolha do principal usa a busca da própria coleção do usuário (a obra casada por `obra_chave` sugere o candidato).

---

## 5. Fases de implementação

Ordem: **D5 → D6 → D7**. O estudo não exige reordenar; a D6 e a D7 dependem da D4 (este documento), e a D7 reaproveita a D6.

### D5 · `feat/capa-variante` — migration `0017_capa_variante.sql`

- `itens.variante_de` (auto-referência, `check (variante_de <> id)`), índice parcial, validação de "principal não é variante".
- Sincronização do lido/nota/crítica/`lido_em`/`critica_privada` (em `item_salvar` e/ou trigger). Redefinir `item_salvar` copiando o corpo **atual** (última versão em 0013) e acrescentar o campo; teste em `migrations-sql.test.ts`.
- Ajustar `privado.v_itens` (lidos/ranking ignoram variantes) e estatísticas (1 em lidos/progresso; 2 na estante).
- UI: vincular no cadastro e na página do volume; desvincular.
- Riscos: capa da variante no catálogo (seção 4); regressão em `item_salvar`; contagens divergentes entre estante, progresso e ranking.

### D6 · `feat/feed-de-amigos` — migration `0018_feed_amigos.sql`

- `perfis.feed_ativo`, `perfis.feed_visto_em`; `itens.lido_marcado_em` (trigger estendido a partir de `itens_definir_lido_em`) e `itens.feed_oculto`.
- Tabelas `feed_curtidas` e `feed_comentarios` (RLS ligada, sem grant); RPCs `feed_listar`, `feed_curtir/descurtir`, `feed_comentar/apagar_comentario`, `feed_resumo_semana`, `feed_marcar_visto`.
- Extrair `privado.v_avaliacao` e fazer `v_itens` usá-la **sem mudar o resultado** (teste de regressão).
- UI: aba Feed, interruptor em Configurações (texto sobre nota/crítica visíveis), card semanal, curtir/comentar, agrupamento por série/dia, foto de perfil (D2) nos cards.
- Riscos: feed enchendo com marcação em lote (agrupar); privacidade de comentários entre amigos que não se conhecem (regra da seção 3); custo da consulta (índice `itens (user_id, lido_marcado_em desc) where estado = 'lido'`, ok para dezenas de amigos); spam de comentário (limite de taxa).

### D7 · `feat/notas-entre-amigos` — migration `0019_notas_entre_amigos.sql`

- `itens.obra_chave` e `series.serie_chave` (+ índices parciais); `item_salvar`/`serie_salvar` gravam a chave (app calcula com `src/lib/texto.ts`; criar `chaveObra()` ao lado de `chaveEdicao()`).
- Backfill das chaves dos itens/séries existentes (script único, em lotes; sem derrubar o app).
- RPCs `obra_amigos` e `serie_amigos` (usam `privado.v_avaliacao` da D6).
- UI: bloco "Amigos" no item e na série (média, lista com nota/crítica/data/curtir/comentar, que reaproveita as tabelas da D6).
- Riscos: falso positivo/negativo de casamento (seção 1); backfill incompleto deixa média vazia; escopo `notas_criticas` desligado deixa o bloco vazio (explicar na UI); homônimos de série.

### Testes obrigatórios (RLS)

Cenários com 4 contas: dono, amigo, desconhecido, ex-amigo.
- Desconhecido e ex-amigo: zero linhas em `obra_amigos`, `serie_amigos`, `feed_listar`, curtidas e comentários; amigo vê.
- `critica_privada` e escopo sem `notas_criticas` não vazam em nenhuma função.
- Comentário de amigo A não aparece para amigo B do dono que não é amigo de A.
- `feed_ativo = false` tira o item do feed na hora.
- Variante não duplica média nem feed.

### Dúvidas em aberto (decisão conservadora adotada)

1. `notas_criticas` fica como porta única da nota/crítica; o padrão das contas existentes **não muda**. Mudar o padrão das contas novas é decisão do Julian.
2. `feed_ativo` começa **desligado** (nada compartilhado sem ação da pessoa).
3. Itens já lidos antes da D6 **não** entram no feed.
4. Série homônima de outra editora cai junta no v1.
