-- 0028 — listas curadas para amigos (R9 do estudo do Letterboxd, seções 6 e 12)
--
-- Pré-requisito: 0027 aplicada (usa privado.sao_amigos, privado.feed_autor_visivel e obra_equivalencias).
--
-- Listas feitas pela pessoa ("ordem de leitura de Batman", "melhores de 2026", "para emprestar"), ordenadas ou não,
-- visíveis SÓ para o dono e amigos aceitos. Decisão de 17/11/2026: elas NÃO entram no link público `/c/[token]`
-- (nenhuma função `link_*` toca estas tabelas e as funções daqui são fechadas para anônimo).
--
--  * o item da lista é uma REFERÊNCIA ESTÁVEL: guarda a chave da obra (`obra_chave`), o título, a série, o número, o tipo e
--    a capa NO MOMENTO em que foi adicionado, copiados do item do dono pelo próprio banco. Apagar ou renomear o item da
--    coleção não mexe na lista. Nada disso é editável pelo cliente (evita apontar a capa para o arquivo de outra pessoa);
--  * leitura: o dono lê as próprias listas pela tabela (RLS); amigo aceito lê só pelas funções, que conferem a amizade a
--    CADA chamada, então desfazer a amizade corta o acesso na hora. Quem não é amigo (e anônimo) não vê nada;
--  * escrita: só por funções (o dono é quem chama; a RLS não tem política de escrita);
--  * curtidas e comentários seguem o padrão de `feed_curtidas`/`feed_comentarios` (0018): tabelas sem acesso direto,
--    tudo por função, e o amigo A nunca descobre o amigo B só pelo comentário;
--  * limites no banco: 50 listas por pessoa, 200 itens por lista, comentário de 1 a 500 caracteres e no máximo 10
--    comentários por minuto por pessoa;
--  * a nota do item da lista é um texto curto escrito PARA a lista (até 300 caracteres), com marca de spoiler. Não é a crítica
--    do volume: não depende do escopo `notas_criticas` e a crítica privada do item nunca é lida aqui.

begin;

-- ---------------------------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------------------------
create table listas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  titulo text not null check (char_length(titulo) between 1 and 80),
  descricao text check (descricao is null or char_length(descricao) <= 500),
  ordenada boolean not null default false,
  tipo text check (tipo is null or tipo in ('ordem_leitura', 'arco', 'melhores', 'emprestar', 'outro')),
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
create index idx_listas_user on listas (user_id, atualizada_em desc);

create table lista_itens (
  id uuid primary key default gen_random_uuid(),
  lista_id uuid not null references listas(id) on delete cascade,
  posicao int not null check (posicao >= 1),
  -- Referência estável à obra (copiada do item no momento de adicionar).
  obra_chave text,
  titulo text not null check (char_length(titulo) between 1 and 300),
  serie_nome text,
  numero_volume numeric,
  tipo tipo_obra not null default 'hq',
  -- Caminho completo como em `itens.capa_url` (`pub/<hash>.<ext>` ou `<dono>/<arquivo>`); nunca devolvido assim.
  capa text,
  -- Comentário curto do dono sobre o item, com marca de spoiler.
  nota text check (nota is null or char_length(nota) <= 300),
  spoiler boolean not null default false,
  criado_em timestamptz not null default now(),
  constraint uq_lista_itens_posicao unique (lista_id, posicao) deferrable initially deferred
);
-- A mesma obra não entra duas vezes na mesma lista.
create unique index uq_lista_itens_obra on lista_itens (lista_id, obra_chave) where obra_chave is not null;

create table lista_curtidas (
  lista_id uuid not null references listas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  criada_em timestamptz not null default now(),
  primary key (lista_id, user_id)
);

create table lista_comentarios (
  id uuid primary key default gen_random_uuid(),
  lista_id uuid not null references listas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  texto text not null check (char_length(texto) between 1 and 500),
  criado_em timestamptz not null default now()
);
create index idx_lista_comentarios_lista on lista_comentarios (lista_id, criado_em);
create index idx_lista_comentarios_autor on lista_comentarios (user_id, criado_em desc);

-- RLS: o dono LÊ as próprias listas e itens (nenhuma política de escrita: escrever é só pelas funções). Curtidas e
-- comentários não têm política nenhuma: ninguém acessa a tabela direto.
alter table listas enable row level security;
alter table lista_itens enable row level security;
alter table lista_curtidas enable row level security;
alter table lista_comentarios enable row level security;

create policy "listas_dono_le" on listas for select to authenticated using (user_id = auth.uid());
create policy "lista_itens_dono_le" on lista_itens for select to authenticated
  using (exists (select 1 from listas l where l.id = lista_itens.lista_id and l.user_id = auth.uid()));

revoke all on listas, lista_itens, lista_curtidas, lista_comentarios from public, anon, authenticated;
grant select on listas, lista_itens to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Visibilidade (uma regra só, usada por todas as funções): o dono ou um amigo aceito dele, conferido na hora.
-- ---------------------------------------------------------------------------------------------
create or replace function privado.lista_visivel(p_viewer uuid, p_lista uuid)
returns boolean
language sql
stable
security definer
set search_path = public, privado
as $$
  select p_viewer is not null and exists (
    select 1 from listas l
     where l.id = p_lista
       and (l.user_id = p_viewer or privado.sao_amigos(p_viewer, l.user_id))
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- Escrita do dono
-- ---------------------------------------------------------------------------------------------

-- Cria (p_id nulo) ou edita os dados da lista. Devolve o id.
create or replace function lista_salvar(p_id uuid, p_titulo text, p_descricao text, p_ordenada boolean, p_tipo text)
returns uuid
language plpgsql
security definer
set search_path = public, privado
as $$
declare
  v_titulo text := btrim(coalesce(p_titulo, ''));
  v_descricao text := nullif(btrim(coalesce(p_descricao, '')), '');
  v_tipo text := nullif(btrim(coalesce(p_tipo, '')), '');
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if char_length(v_titulo) = 0 or char_length(v_titulo) > 80 then
    raise exception 'lista_titulo_invalido';
  end if;
  if v_descricao is not null and char_length(v_descricao) > 500 then
    raise exception 'lista_descricao_longa';
  end if;
  if v_tipo is not null and v_tipo not in ('ordem_leitura', 'arco', 'melhores', 'emprestar', 'outro') then
    raise exception 'lista_tipo_invalido';
  end if;

  if p_id is null then
    -- Serializa a criação por pessoa para o limite valer mesmo com duas chamadas ao mesmo tempo.
    perform pg_advisory_xact_lock(hashtextextended('listas:' || auth.uid()::text, 0));
    if (select count(*) from listas where user_id = auth.uid()) >= 50 then
      raise exception 'lista_limite';
    end if;
    insert into listas (user_id, titulo, descricao, ordenada, tipo)
    values (auth.uid(), v_titulo, v_descricao, coalesce(p_ordenada, false), v_tipo)
    returning id into v_id;
  else
    update listas
       set titulo = v_titulo, descricao = v_descricao, ordenada = coalesce(p_ordenada, false), tipo = v_tipo,
           atualizada_em = now()
     where id = p_id and user_id = auth.uid()
    returning id into v_id;
    if v_id is null then
      raise exception 'lista_nao_encontrada';
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function lista_apagar(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  delete from listas where id = p_id and user_id = auth.uid();
  if not found then
    raise exception 'lista_nao_encontrada';
  end if;
end;
$$;

-- Adiciona um item DA PRÓPRIA coleção ao fim da lista. Os dados da referência saem do item, lidos aqui no banco.
create or replace function lista_item_adicionar(p_lista uuid, p_item uuid, p_nota text, p_spoiler boolean)
returns uuid
language plpgsql
security definer
set search_path = public, privado
as $$
declare
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
  v_item itens%rowtype;
  v_serie text;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if v_nota is not null and char_length(v_nota) > 300 then
    raise exception 'lista_nota_longa';
  end if;
  -- Trava a lista (e confere o dono) para posição e limite não correrem com outra chamada.
  perform 1 from listas where id = p_lista and user_id = auth.uid() for update;
  if not found then
    raise exception 'lista_nao_encontrada';
  end if;
  select * into v_item from itens where id = p_item and user_id = auth.uid();
  if not found then
    raise exception 'item_nao_encontrado';
  end if;
  if (select count(*) from lista_itens where lista_id = p_lista) >= 200 then
    raise exception 'lista_cheia';
  end if;
  if v_item.obra_chave is not null
     and exists (select 1 from lista_itens where lista_id = p_lista and obra_chave = v_item.obra_chave) then
    raise exception 'lista_item_repetido';
  end if;
  select s.nome into v_serie from series s where s.id = v_item.serie_id;

  insert into lista_itens (lista_id, posicao, obra_chave, titulo, serie_nome, numero_volume, tipo, capa, nota, spoiler)
  values (p_lista,
          coalesce((select max(posicao) from lista_itens where lista_id = p_lista), 0) + 1,
          v_item.obra_chave, v_item.titulo, v_serie, v_item.numero_volume, v_item.tipo, v_item.capa_url,
          v_nota, coalesce(p_spoiler, false) and v_nota is not null)
  returning id into v_id;
  update listas set atualizada_em = now() where id = p_lista;
  return v_id;
end;
$$;

-- Só a nota e o spoiler do item são editáveis; a referência (obra, título, capa) não.
create or replace function lista_item_editar(p_id uuid, p_nota text, p_spoiler boolean)
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
declare
  v_nota text := nullif(btrim(coalesce(p_nota, '')), '');
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if v_nota is not null and char_length(v_nota) > 300 then
    raise exception 'lista_nota_longa';
  end if;
  update lista_itens li
     set nota = v_nota, spoiler = coalesce(p_spoiler, false) and v_nota is not null
   where li.id = p_id and exists (select 1 from listas l where l.id = li.lista_id and l.user_id = auth.uid());
  if not found then
    raise exception 'lista_item_nao_encontrado';
  end if;
  update listas set atualizada_em = now()
   where id = (select lista_id from lista_itens where id = p_id);
end;
$$;

-- Remove o item e fecha o buraco nas posições.
create or replace function lista_item_remover(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
declare
  v_lista uuid;
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  select li.lista_id into v_lista
    from lista_itens li join listas l on l.id = li.lista_id
   where li.id = p_id and l.user_id = auth.uid();
  if v_lista is null then
    raise exception 'lista_item_nao_encontrado';
  end if;
  perform 1 from listas where id = v_lista for update;
  delete from lista_itens where id = p_id;
  update lista_itens li
     set posicao = n.nova
    from (select id, row_number() over (order by posicao, id)::int as nova from lista_itens where lista_id = v_lista) n
   where li.id = n.id and li.posicao <> n.nova;
  update listas set atualizada_em = now() where id = v_lista;
end;
$$;

-- Grava a ordem recebida (primeiro = posição 1). A lista de ids tem que ser exatamente a dos itens da lista.
create or replace function lista_itens_reordenar(p_lista uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  perform 1 from listas where id = p_lista and user_id = auth.uid() for update;
  if not found then
    raise exception 'lista_nao_encontrada';
  end if;
  if p_ids is null
     or exists (select 1 from unnest(p_ids) x where x is null)
     or (select count(distinct x) from unnest(p_ids) x) <> cardinality(p_ids)
     or cardinality(p_ids) <> (select count(*) from lista_itens where lista_id = p_lista)
     or exists (select 1 from unnest(p_ids) x where not exists (select 1 from lista_itens li where li.id = x and li.lista_id = p_lista))
  then
    raise exception 'lista_ordem_invalida';
  end if;

  update lista_itens li
     set posicao = t.n::int
    from unnest(p_ids) with ordinality as t(id, n)
   where li.id = t.id and li.lista_id = p_lista;
  update listas set atualizada_em = now() where id = p_lista;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Leitura (dono e amigo aceito). `capa` sai só como nome do arquivo (ou `pub/<hash>`): nunca a pasta do dono.
-- ---------------------------------------------------------------------------------------------

-- Listas que o visitante pode ver: as dele e as de amigos aceitos. `p_apelido` filtra por dono (perfil de um amigo).
create or replace function listas_listar(p_apelido text default null)
returns table (
  id uuid,
  dono_id uuid,
  apelido text,
  nome_exibicao text,
  avatar_url text,
  proprio boolean,
  titulo text,
  descricao text,
  ordenada boolean,
  tipo text,
  qtd int,
  capa text,
  capa_item uuid,
  curtidas int,
  curti boolean,
  comentarios int,
  atualizada_em timestamptz
)
language sql
stable
security definer
set search_path = public, privado
as $$
  select l.id,
         l.user_id,
         p.apelido,
         p.nome_exibicao,
         p.avatar_url,
         l.user_id = auth.uid(),
         l.titulo,
         l.descricao,
         l.ordenada,
         l.tipo,
         (select count(*)::int from lista_itens li where li.lista_id = l.id),
         case when c.capa like 'pub/%' then c.capa else regexp_replace(c.capa, '^.*/', '') end,
         c.id,
         (select count(*)::int from lista_curtidas k
           where k.lista_id = l.id and privado.feed_autor_visivel(auth.uid(), l.user_id, k.user_id)),
         exists (select 1 from lista_curtidas k where k.lista_id = l.id and k.user_id = auth.uid()),
         (select count(*)::int from lista_comentarios m
           where m.lista_id = l.id and privado.feed_autor_visivel(auth.uid(), l.user_id, m.user_id)),
         l.atualizada_em
    from listas l
    left join perfis p on p.user_id = l.user_id
    left join lateral (
      select li.id, li.capa from lista_itens li
       where li.lista_id = l.id and li.capa is not null
       order by li.posicao limit 1
    ) c on true
   where auth.uid() is not null
     and (l.user_id = auth.uid() or privado.sao_amigos(auth.uid(), l.user_id))
     and (p_apelido is null or lower(p.apelido) = lower(btrim(p_apelido)))
   order by l.atualizada_em desc, l.id
   limit 200
$$;

-- Uma lista só (cabeçalho). Vazio se não existe ou o visitante não pode ver (sem distinguir os dois casos).
create or replace function lista_detalhe(p_lista uuid)
returns table (
  id uuid,
  dono_id uuid,
  apelido text,
  nome_exibicao text,
  avatar_url text,
  proprio boolean,
  titulo text,
  descricao text,
  ordenada boolean,
  tipo text,
  qtd int,
  curtidas int,
  curti boolean,
  comentarios int,
  atualizada_em timestamptz
)
language sql
stable
security definer
set search_path = public, privado
as $$
  select l.id,
         l.user_id,
         p.apelido,
         p.nome_exibicao,
         p.avatar_url,
         l.user_id = auth.uid(),
         l.titulo,
         l.descricao,
         l.ordenada,
         l.tipo,
         (select count(*)::int from lista_itens li where li.lista_id = l.id),
         (select count(*)::int from lista_curtidas k
           where k.lista_id = l.id and privado.feed_autor_visivel(auth.uid(), l.user_id, k.user_id)),
         exists (select 1 from lista_curtidas k where k.lista_id = l.id and k.user_id = auth.uid()),
         (select count(*)::int from lista_comentarios m
           where m.lista_id = l.id and privado.feed_autor_visivel(auth.uid(), l.user_id, m.user_id)),
         l.atualizada_em
    from listas l
    left join perfis p on p.user_id = l.user_id
   where l.id = p_lista
     and privado.lista_visivel(auth.uid(), l.id)
$$;

-- Itens da lista, na ordem, com a situação do VISITANTE: `tenho` (algum volume dessa obra na minha coleção, fora
-- desejo) e `li` (algum marcado como lido). A obra casa pela chave e pelos vínculos manuais "é a mesma obra" (0020)
-- do visitante. Só dados do próprio visitante entram na conta.
create or replace function lista_itens_listar(p_lista uuid)
returns table (
  id uuid,
  posicao int,
  obra_chave text,
  titulo text,
  serie_nome text,
  numero_volume numeric,
  tipo tipo_obra,
  capa text,
  nota text,
  spoiler boolean,
  tenho boolean,
  li boolean
)
language sql
stable
security definer
set search_path = public, privado
as $$
  select li.id,
         li.posicao,
         li.obra_chave,
         li.titulo,
         li.serie_nome,
         li.numero_volume,
         li.tipo,
         case when li.capa like 'pub/%' then li.capa else regexp_replace(li.capa, '^.*/', '') end,
         li.nota,
         li.spoiler,
         coalesce(m.tenho, false),
         coalesce(m.li, false)
    from lista_itens li
    left join lateral (
      select true as tenho, bool_or(i.estado = 'lido') as li
        from itens i
       where li.obra_chave is not null
         and i.user_id = auth.uid()
         and i.estado <> 'desejo'
         and (i.obra_chave = li.obra_chave
              or i.obra_chave in (select oe.obra_chave from obra_equivalencias oe
                                   where oe.user_id = auth.uid() and oe.obra_chave_amigo = li.obra_chave))
       having count(*) > 0
    ) m on true
   where li.lista_id = p_lista
     and privado.lista_visivel(auth.uid(), p_lista)
   order by li.posicao, li.id
   limit 200
$$;

-- Arquivo da capa de um item da lista (`pub/<hash>` ou `<dono>/<arquivo>`); null se o item não está visível.
create or replace function lista_item_capa(p_item uuid)
returns text
language sql
stable
security definer
set search_path = public, privado
as $$
  select li.capa
    from lista_itens li
   where li.id = p_item
     and li.capa is not null
     and li.capa not like 'pub/%'
     and privado.lista_visivel(auth.uid(), li.lista_id)
$$;

-- ---------------------------------------------------------------------------------------------
-- Curtir e comentar: dono ou amigo aceito dele.
-- ---------------------------------------------------------------------------------------------
create or replace function lista_curtir(p_lista uuid)
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if not privado.lista_visivel(auth.uid(), p_lista) then
    raise exception 'lista_nao_encontrada';
  end if;
  insert into lista_curtidas (lista_id, user_id) values (p_lista, auth.uid()) on conflict do nothing;
end;
$$;

create or replace function lista_descurtir(p_lista uuid)
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  delete from lista_curtidas where lista_id = p_lista and user_id = auth.uid();
end;
$$;

create or replace function lista_comentar(p_lista uuid, p_texto text)
returns uuid
language plpgsql
security definer
set search_path = public, privado
as $$
declare
  v_texto text := btrim(coalesce(p_texto, ''));
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if char_length(v_texto) = 0 then
    raise exception 'comentario_vazio';
  end if;
  if char_length(v_texto) > 500 then
    raise exception 'comentario_longo';
  end if;
  if not privado.lista_visivel(auth.uid(), p_lista) then
    raise exception 'lista_nao_encontrada';
  end if;
  -- Limite de taxa no banco (vale para qualquer caminho de chamada, não só para a tela).
  if (select count(*) from lista_comentarios where user_id = auth.uid() and criado_em > now() - interval '1 minute') >= 10 then
    raise exception 'comentario_rapido';
  end if;
  insert into lista_comentarios (lista_id, user_id, texto) values (p_lista, auth.uid(), v_texto) returning id into v_id;
  return v_id;
end;
$$;

-- Apaga o autor ou o dono da lista.
create or replace function lista_apagar_comentario(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  delete from lista_comentarios m
   where m.id = p_id
     and (m.user_id = auth.uid() or exists (select 1 from listas l where l.id = m.lista_id and l.user_id = auth.uid()));
  if not found then
    raise exception 'comentario_nao_encontrado';
  end if;
end;
$$;

-- Comentários de uma lista visível, só de quem o visitante pode ver (dono, ele mesmo, amigos dele).
create or replace function lista_comentarios_listar(p_lista uuid)
returns table (
  id uuid,
  apelido text,
  nome_exibicao text,
  avatar_url text,
  texto text,
  criado_em timestamptz,
  meu boolean,
  pode_apagar boolean
)
language sql
stable
security definer
set search_path = public, privado
as $$
  select m.id,
         p.apelido,
         p.nome_exibicao,
         p.avatar_url,
         m.texto,
         m.criado_em,
         m.user_id = auth.uid(),
         m.user_id = auth.uid() or l.user_id = auth.uid()
    from lista_comentarios m
    join listas l on l.id = m.lista_id
    left join perfis p on p.user_id = m.user_id
   where m.lista_id = p_lista
     and privado.lista_visivel(auth.uid(), p_lista)
     and privado.feed_autor_visivel(auth.uid(), l.user_id, m.user_id)
   order by m.criado_em, m.id
   limit 200
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissões: tudo exige login; nada é público e a camada interna continua fechada.
-- ---------------------------------------------------------------------------------------------
revoke all on all functions in schema privado from public, anon, authenticated;

revoke all on function lista_salvar(uuid, text, text, boolean, text) from public, anon;
revoke all on function lista_apagar(uuid) from public, anon;
revoke all on function lista_item_adicionar(uuid, uuid, text, boolean) from public, anon;
revoke all on function lista_item_editar(uuid, text, boolean) from public, anon;
revoke all on function lista_item_remover(uuid) from public, anon;
revoke all on function lista_itens_reordenar(uuid, uuid[]) from public, anon;
revoke all on function listas_listar(text) from public, anon;
revoke all on function lista_detalhe(uuid) from public, anon;
revoke all on function lista_itens_listar(uuid) from public, anon;
revoke all on function lista_item_capa(uuid) from public, anon;
revoke all on function lista_curtir(uuid) from public, anon;
revoke all on function lista_descurtir(uuid) from public, anon;
revoke all on function lista_comentar(uuid, text) from public, anon;
revoke all on function lista_apagar_comentario(uuid) from public, anon;
revoke all on function lista_comentarios_listar(uuid) from public, anon;

grant execute on function lista_salvar(uuid, text, text, boolean, text) to authenticated;
grant execute on function lista_apagar(uuid) to authenticated;
grant execute on function lista_item_adicionar(uuid, uuid, text, boolean) to authenticated;
grant execute on function lista_item_editar(uuid, text, boolean) to authenticated;
grant execute on function lista_item_remover(uuid) to authenticated;
grant execute on function lista_itens_reordenar(uuid, uuid[]) to authenticated;
grant execute on function listas_listar(text) to authenticated;
grant execute on function lista_detalhe(uuid) to authenticated;
grant execute on function lista_itens_listar(uuid) to authenticated;
grant execute on function lista_item_capa(uuid) to authenticated;
grant execute on function lista_curtir(uuid) to authenticated;
grant execute on function lista_descurtir(uuid) to authenticated;
grant execute on function lista_comentar(uuid, text) to authenticated;
grant execute on function lista_apagar_comentario(uuid) to authenticated;
grant execute on function lista_comentarios_listar(uuid) to authenticated;

commit;
