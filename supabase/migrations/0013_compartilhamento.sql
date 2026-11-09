-- 0013 — compartilhamento da coleção por link público (Fase 4, degrau 1)
--
-- Pré-requisito: 0012 aplicada.
--
-- A RLS das tabelas atuais NÃO muda. Terceiros leem só por funções `security definer` que devolvem colunas
-- explícitas: preço, loja, data de aquisição, observações e prioridade nunca saem, e crítica marcada como
-- privada nunca sai. As regras de visibilidade ficam numa camada interna (schema `privado`, que os papéis
-- `anon` e `authenticated` não enxergam) e as funções públicas `link_*` só resolvem o token e a chamam.
-- A Fase 4 (amigos) reaproveita a mesma camada em `0014`.

begin;

create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Escopo: quais seções de uma coleção aparecem para quem recebe o acesso.
-- ---------------------------------------------------------------------------------------------
create or replace function escopo_valido(p text[])
returns boolean
language sql
immutable
set search_path = public
as $$
  select p is not null
     and cardinality(p) <= 6
     and p <@ array['colecao', 'series', 'lidos', 'notas_criticas', 'ranking', 'desejos']::text[]
$$;

-- Crítica privada: nunca sai em nenhum compartilhamento (link ou amigos).
alter table itens add column if not exists critica_privada boolean not null default false;
alter table series add column if not exists critica_privada boolean not null default false;

-- Escopo que os amigos aceitos enxergam (separado do escopo do link). Começa conservador.
alter table perfis add column if not exists escopo_amigos text[] not null default array['colecao', 'series', 'lidos']::text[]
  check (escopo_valido(escopo_amigos));

-- ---------------------------------------------------------------------------------------------
-- Link público
-- ---------------------------------------------------------------------------------------------
create table compartilhamentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 2 UUIDs v4 aleatórios sem hífen = 64 hex (244 bits); gerado pelo banco, nunca escolhido pelo cliente
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{32,64}$'),
  escopo text[] not null check (escopo_valido(escopo) and cardinality(escopo) > 0),
  criado_em timestamptz not null default now(),
  revogado_em timestamptz
);
-- Um link ativo por pessoa; gerar outro revoga o anterior.
create unique index uq_compartilhamento_ativo on compartilhamentos (user_id) where revogado_em is null;

alter table compartilhamentos enable row level security;
create policy "compartilhamentos_dono_le" on compartilhamentos for select to authenticated using (user_id = auth.uid());
revoke all on compartilhamentos from public, anon;
revoke insert, update, delete, truncate on compartilhamentos from authenticated;
grant select on compartilhamentos to authenticated;

create or replace function compartilhamento_gerar(p_escopo text[])
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if not escopo_valido(p_escopo) or cardinality(p_escopo) = 0 then
    raise exception 'escopo_invalido';
  end if;
  -- Gerar um novo link invalida o antigo na hora.
  update compartilhamentos set revogado_em = now() where user_id = auth.uid() and revogado_em is null;
  insert into compartilhamentos (user_id, token, escopo) values (auth.uid(), v_token, p_escopo);
  return v_token;
end;
$$;

create or replace function compartilhamento_revogar()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  update compartilhamentos set revogado_em = now() where user_id = auth.uid() and revogado_em is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

create or replace function compartilhamento_escopo_atualizar(p_escopo text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if not escopo_valido(p_escopo) or cardinality(p_escopo) = 0 then
    raise exception 'escopo_invalido';
  end if;
  update compartilhamentos set escopo = p_escopo where user_id = auth.uid() and revogado_em is null;
  if not found then
    raise exception 'sem_link_ativo';
  end if;
end;
$$;

-- item_salvar / serie_salvar passam a gravar `critica_privada` (chave ausente mantém o valor atual na edição).
create or replace function item_salvar(p_id uuid, p_dados jsonb, p_tag_ids uuid[])
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_id is null then
    insert into itens (user_id, serie_id, titulo, numero_volume, tipo, isbn, estado, prioridade,
                       preco, loja, data_aquisicao, nota, critica, lido_em, edicao_id, critica_privada)
    values (
      auth.uid(),
      nullif(p_dados->>'serie_id', '')::uuid,
      p_dados->>'titulo',
      (p_dados->>'numero_volume')::numeric,
      (p_dados->>'tipo')::tipo_obra,
      nullif(p_dados->>'isbn', ''),
      (p_dados->>'estado')::estado_item,
      coalesce((p_dados->>'prioridade')::int, 0),
      (p_dados->>'preco')::numeric,
      nullif(p_dados->>'loja', ''),
      nullif(p_dados->>'data_aquisicao', '')::date,
      (p_dados->>'nota')::numeric,
      nullif(p_dados->>'critica', ''),
      nullif(p_dados->>'lido_em', '')::date,
      nullif(p_dados->>'edicao_id', '')::uuid,
      coalesce((p_dados->>'critica_privada')::boolean, false)
    )
    returning id into v_id;
  else
    update itens set
      serie_id = nullif(p_dados->>'serie_id', '')::uuid,
      titulo = p_dados->>'titulo',
      numero_volume = (p_dados->>'numero_volume')::numeric,
      tipo = (p_dados->>'tipo')::tipo_obra,
      isbn = nullif(p_dados->>'isbn', ''),
      estado = (p_dados->>'estado')::estado_item,
      prioridade = coalesce((p_dados->>'prioridade')::int, 0),
      preco = (p_dados->>'preco')::numeric,
      loja = nullif(p_dados->>'loja', ''),
      data_aquisicao = nullif(p_dados->>'data_aquisicao', '')::date,
      nota = (p_dados->>'nota')::numeric,
      critica = nullif(p_dados->>'critica', ''),
      lido_em = nullif(p_dados->>'lido_em', '')::date,
      edicao_id = case when p_dados ? 'edicao_id' then nullif(p_dados->>'edicao_id', '')::uuid else edicao_id end,
      critica_privada = case when p_dados ? 'critica_privada' then coalesce((p_dados->>'critica_privada')::boolean, false) else critica_privada end
    where id = p_id
    returning id into v_id;

    if v_id is null then
      raise exception 'item_nao_encontrado';
    end if;
    delete from item_tags where item_id = v_id;
  end if;

  insert into item_tags (item_id, tag_id)
  select v_id, t from unnest(coalesce(p_tag_ids, '{}')) as t
  on conflict do nothing;

  return v_id;
end;
$$;

create or replace function serie_salvar(p_id uuid, p_dados jsonb, p_tag_ids uuid[])
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_id is null then
    insert into series (user_id, nome, tipo, total_volumes, em_publicacao, tem_numeracao, observacoes, critica_privada)
    values (
      auth.uid(),
      p_dados->>'nome',
      (p_dados->>'tipo')::tipo_obra,
      (p_dados->>'total_volumes')::int,
      coalesce((p_dados->>'em_publicacao')::boolean, true),
      coalesce((p_dados->>'tem_numeracao')::boolean, false),
      nullif(p_dados->>'observacoes', ''),
      coalesce((p_dados->>'critica_privada')::boolean, false)
    )
    returning id into v_id;
  else
    update series set
      nome = p_dados->>'nome',
      tipo = (p_dados->>'tipo')::tipo_obra,
      total_volumes = (p_dados->>'total_volumes')::int,
      em_publicacao = coalesce((p_dados->>'em_publicacao')::boolean, true),
      tem_numeracao = coalesce((p_dados->>'tem_numeracao')::boolean, false),
      observacoes = nullif(p_dados->>'observacoes', ''),
      critica_privada = case when p_dados ? 'critica_privada' then coalesce((p_dados->>'critica_privada')::boolean, false) else critica_privada end
    where id = p_id
    returning id into v_id;

    if v_id is null then
      raise exception 'serie_nao_encontrada';
    end if;
    delete from serie_tags where serie_id = v_id;
  end if;

  insert into serie_tags (serie_id, tag_id)
  select v_id, t from unnest(coalesce(p_tag_ids, '{}')) as t
  on conflict do nothing;

  return v_id;
end;
$$;


-- Marcar série como lida: a crítica da série (se privada) não pode virar pública ao ser copiada para os volumes.
create or replace function serie_marcar_lida(
  p_serie uuid,
  p_nota numeric,
  p_critica text,
  p_modo text,
  p_marcar_lidos boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_serie series%rowtype;
  v_critica text := nullif(btrim(coalesce(p_critica, '')), '');
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_snapshot jsonb;
  v_marcados int;
  v_avaliados int;
  v_criticas int;
  v_desejos int;
  v_comprados int;
begin
  if p_modo not in ('serie', 'serie_e_sem_nota', 'serie_e_todos') then
    raise exception 'modo_invalido';
  end if;
  if char_length(coalesce(p_critica, '')) > 2000 then
    raise exception 'critica_longa';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_serie::text, 1));

  select * into v_serie from series where id = p_serie;
  if not found then
    raise exception 'serie_nao_encontrada';
  end if;

  select count(*) filter (where estado = 'desejo'), count(*) filter (where estado = 'comprado')
    into v_desejos, v_comprados
    from itens where serie_id = p_serie;

  if p_marcar_lidos and v_comprados = 0 and p_nota is null and p_critica is null then
    raise exception 'nada_a_marcar';
  end if;

  with antes as (
    select i.id, i.estado, i.nota, i.critica, i.lido_em, i.critica_privada,
           (p_marcar_lidos and i.estado = 'comprado') as vira_lido,
           (p_nota is not null and (p_marcar_lidos or i.estado = 'lido') and (
              p_modo = 'serie_e_todos' or (p_modo = 'serie_e_sem_nota' and i.nota is null)
            )) as grava_nota,
           (v_critica is not null and (p_marcar_lidos or i.estado = 'lido') and i.critica is null) as grava_critica
      from itens i
     where i.serie_id = p_serie and i.estado in ('comprado', 'lido')
  ),
  afetados as (
    select * from antes where vira_lido or grava_nota or grava_critica
  ),
  atualizados as (
    update itens i set
      estado = case when a.vira_lido then 'lido'::estado_item else i.estado end,
      lido_em = case when a.vira_lido then v_hoje else i.lido_em end,
      nota = case when a.grava_nota then p_nota else i.nota end,
      critica = case when a.grava_critica then v_critica else i.critica end,
      -- crítica que veio de uma série privada não pode virar pública ao ser copiada para os volumes
      critica_privada = case when a.grava_critica and v_serie.critica_privada then true else i.critica_privada end
    from afetados a
    where i.id = a.id
    returning a.*
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'estado', estado, 'nota', nota, 'critica', critica, 'lido_em', lido_em, 'critica_privada', critica_privada
    )), '[]'::jsonb),
    count(*) filter (where vira_lido),
    count(*) filter (where grava_nota),
    count(*) filter (where grava_critica)
  into v_snapshot, v_marcados, v_avaliados, v_criticas
  from atualizados;

  update series set
    nota = coalesce(p_nota, nota),
    critica = case
      when p_critica is null then critica
      else v_critica
    end
  where id = p_serie;

  return jsonb_build_object(
    'marcados', v_marcados,
    'avaliados', v_avaliados,
    'criticas', v_criticas,
    'desejos_ignorados', v_desejos,
    'snapshot', jsonb_build_object(
      'serie', jsonb_build_object('id', p_serie, 'nota', v_serie.nota, 'critica', v_serie.critica),
      'itens', v_snapshot
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- serie_desfazer_marcacao: devolve estado, nota, crítica e lido_em dos itens do snapshot e a
-- avaliação anterior da série. Só mexe em itens da própria série (e a RLS limita ao dono).
-- ---------------------------------------------------------------------------------------------
create or replace function serie_desfazer_marcacao(p_serie uuid, p_snapshot jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_restaurados int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_serie::text, 1));

  if not exists (select 1 from series where id = p_serie) then
    raise exception 'serie_nao_encontrada';
  end if;

  with ant as (
    select (e->>'id')::uuid as id,
           (e->>'estado')::estado_item as estado,
           (e->>'nota')::numeric as nota,
           e->>'critica' as critica,
           (e->>'lido_em')::date as lido_em,
           (e->>'critica_privada')::boolean as critica_privada
      from jsonb_array_elements(coalesce(p_snapshot->'itens', '[]'::jsonb)) e
  ),
  upd as (
    update itens i set estado = a.estado, nota = a.nota, critica = a.critica, lido_em = a.lido_em,
           critica_privada = coalesce(a.critica_privada, i.critica_privada)
      from ant a
     where i.id = a.id and i.serie_id = p_serie
    returning i.id
  )
  select count(*) into v_restaurados from upd;

  if p_snapshot ? 'serie' then
    update series set
      nota = (p_snapshot->'serie'->>'nota')::numeric,
      critica = p_snapshot->'serie'->>'critica'
    where id = p_serie;
  end if;

  return v_restaurados;
end;
$$;




-- ---------------------------------------------------------------------------------------------
-- Camada de visibilidade (schema privado). Recebe o dono e o escopo já decididos por quem chama
-- (token do link ou amizade aceita) e devolve SÓ colunas permitidas.
-- ---------------------------------------------------------------------------------------------

-- Uma linha de item como terceiros a veem. Preço, loja, data de aquisição, observações e prioridade
-- não existem aqui, então nenhuma função consegue devolvê-los por engano.
create type vitrine_item as (
  id uuid,
  titulo text,
  serie_id uuid,
  serie_nome text,
  numero_volume numeric,
  tipo tipo_obra,
  estado text,
  capa text,
  nota numeric,
  critica text,
  lido_em date,
  isbn13 text,
  reservado boolean,
  reservado_por_mim boolean,
  total bigint
);

create type vitrine_serie as (
  id uuid,
  nome text,
  tipo tipo_obra,
  total_volumes int,
  possuidos int,
  lidos int,
  nota numeric,
  critica text,
  capa text
);

create or replace function privado.v_itens(
  p_dono uuid, p_escopo text[], p_secao text, p_serie uuid, p_viewer uuid, p_limite int, p_offset int
)
returns setof vitrine_item
language sql
stable
security definer
set search_path = public, privado
as $$
  with base as (
    select i.*, s.nome as serie_nome
      from itens i
      left join series s on s.id = i.serie_id
     where i.user_id = p_dono
       and (
         (p_secao = 'colecao' and 'colecao' = any (p_escopo) and i.estado in ('comprado', 'lido'))
         or (p_secao = 'lidos' and 'lidos' = any (p_escopo) and i.estado = 'lido')
         or (p_secao = 'desejos' and 'desejos' = any (p_escopo) and i.estado = 'desejo')
         or (p_secao = 'ranking' and 'ranking' = any (p_escopo) and i.estado = 'lido' and i.nota is not null)
         or (p_secao = 'serie' and 'series' = any (p_escopo) and i.serie_id = p_serie
             and (i.estado in ('comprado', 'lido') or ('desejos' = any (p_escopo) and i.estado = 'desejo')))
       )
  )
  select
    b.id,
    b.titulo,
    b.serie_id,
    b.serie_nome,
    b.numero_volume,
    b.tipo,
    -- Sem o escopo "lidos", quem vê não sabe se já li: lido aparece como comprado.
    case
      when p_secao in ('lidos', 'ranking') then 'lido'
      when b.estado = 'lido' and not ('lidos' = any (p_escopo)) then 'comprado'
      else b.estado::text
    end as estado,
    b.capa_url as capa,
    case when b.estado = 'lido' and ('notas_criticas' = any (p_escopo) or p_secao = 'ranking') then b.nota end as nota,
    case when b.estado = 'lido' and 'notas_criticas' = any (p_escopo) and not b.critica_privada then b.critica end as critica,
    case when b.estado = 'lido' and 'lidos' = any (p_escopo) then b.lido_em end as lido_em,
    e.isbn13,
    -- Reserva de presente só existe para amigos (migration 0014 redefine esta função com a tabela `presentes`).
    false as reservado,
    false as reservado_por_mim,
    count(*) over () as total
  from base b
  left join edicoes e on e.id = b.edicao_id
  order by
    case when p_secao = 'ranking' then b.nota end desc nulls last,
    case when p_secao = 'lidos' then b.lido_em end desc nulls last,
    case when p_secao = 'serie' then b.numero_volume end asc nulls last,
    b.created_at desc,
    b.id
  limit least(greatest(coalesce(p_limite, 60), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

create or replace function privado.v_series(p_dono uuid, p_escopo text[], p_serie uuid)
returns setof vitrine_serie
language sql
stable
security definer
set search_path = public, privado
as $$
  select
    s.id,
    s.nome,
    s.tipo,
    s.total_volumes,
    (select count(*)::int from itens i where i.serie_id = s.id and i.estado <> 'desejo') as possuidos,
    case when 'lidos' = any (p_escopo) then (select count(*)::int from itens i where i.serie_id = s.id and i.estado = 'lido') end as lidos,
    case when 'notas_criticas' = any (p_escopo) then s.nota end as nota,
    case when 'notas_criticas' = any (p_escopo) and not s.critica_privada then s.critica end as critica,
    (select i.capa_url from itens i where i.serie_id = s.id and i.estado <> 'desejo' and i.capa_url is not null
      order by i.numero_volume nulls last, i.id limit 1) as capa
  from series s
  where s.user_id = p_dono
    and 'series' = any (p_escopo)
    and (p_serie is null or s.id = p_serie)
    and exists (select 1 from itens i where i.serie_id = s.id and i.estado <> 'desejo')
  order by lower(s.nome), s.id
$$;

create or replace function privado.v_resumo(p_dono uuid, p_escopo text[])
returns jsonb
language sql
stable
security definer
set search_path = public, privado
as $$
  select jsonb_build_object(
    'nome', coalesce(p.nome_exibicao, p.apelido, 'Colecionador'),
    'apelido', p.apelido,
    'escopo', to_jsonb(p_escopo),
    'colecao', case when 'colecao' = any (p_escopo) then (select count(*) from itens i where i.user_id = p_dono and i.estado <> 'desejo') end,
    'lidos', case when 'lidos' = any (p_escopo) then (select count(*) from itens i where i.user_id = p_dono and i.estado = 'lido') end,
    'desejos', case when 'desejos' = any (p_escopo) then (select count(*) from itens i where i.user_id = p_dono and i.estado = 'desejo') end,
    'series', case when 'series' = any (p_escopo) then (select count(*) from series s where s.user_id = p_dono
                 and exists (select 1 from itens i where i.serie_id = s.id and i.estado <> 'desejo')) end
  )
  from (select 1) _
  left join perfis p on p.user_id = p_dono
$$;

-- Arquivo de capa privada (`<dono>/<arquivo>`) que algum item visível usa; null se nenhum item visível a usa.
create or replace function privado.v_capa(p_dono uuid, p_escopo text[], p_arquivo text)
returns text
language sql
stable
security definer
set search_path = public, privado
as $$
  select i.capa_url
    from itens i
   where p_arquivo ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-[0-9]{10,16})?\.(jpg|png|webp)$'
     and i.user_id = p_dono
     and i.capa_url = p_dono::text || '/' || p_arquivo
     and (
       ('colecao' = any (p_escopo) and i.estado in ('comprado', 'lido'))
       or ('lidos' = any (p_escopo) and i.estado = 'lido')
       or ('ranking' = any (p_escopo) and i.estado = 'lido' and i.nota is not null)
       or ('desejos' = any (p_escopo) and i.estado = 'desejo')
       or ('series' = any (p_escopo) and i.serie_id is not null and i.estado <> 'desejo')
     )
   limit 1
$$;

-- Token válido (existe e não foi revogado) → dono e escopo.
create or replace function privado.resolver_token(p_token text)
returns table (dono uuid, escopo text[])
language sql
stable
security definer
set search_path = public, privado
as $$
  select c.user_id, c.escopo
    from compartilhamentos c
   where p_token ~ '^[A-Za-z0-9_-]{32,64}$'
     and c.token = p_token
     and c.revogado_em is null
$$;

revoke all on all functions in schema privado from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Funções públicas por token (aceitam visitante sem login).
-- ---------------------------------------------------------------------------------------------
create or replace function link_resumo(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, privado
as $$
declare
  v record;
begin
  select * into v from privado.resolver_token(p_token);
  if not found then
    return null;
  end if;
  return privado.v_resumo(v.dono, v.escopo);
end;
$$;

create or replace function link_itens(p_token text, p_secao text, p_serie uuid default null, p_limite int default 60, p_offset int default 0)
returns setof vitrine_item
language plpgsql
stable
security definer
set search_path = public, privado
as $$
declare
  v record;
begin
  select * into v from privado.resolver_token(p_token);
  if not found or p_secao not in ('colecao', 'lidos', 'desejos', 'ranking', 'serie') then
    return;
  end if;
  return query select * from privado.v_itens(v.dono, v.escopo, p_secao, p_serie, null, p_limite, p_offset);
end;
$$;

create or replace function link_series(p_token text, p_serie uuid default null)
returns setof vitrine_serie
language plpgsql
stable
security definer
set search_path = public, privado
as $$
declare
  v record;
begin
  select * into v from privado.resolver_token(p_token);
  if not found then
    return;
  end if;
  return query select * from privado.v_series(v.dono, v.escopo, p_serie);
end;
$$;

-- Caminho da capa privada a servir (ou null). A rota usa o resultado, nunca o texto vindo da URL.
create or replace function link_capa(p_token text, p_arquivo text)
returns text
language plpgsql
stable
security definer
set search_path = public, privado
as $$
declare
  v record;
begin
  select * into v from privado.resolver_token(p_token);
  if not found then
    return null;
  end if;
  return privado.v_capa(v.dono, v.escopo, p_arquivo);
end;
$$;

revoke all on function escopo_valido(text[]) from public, anon;
revoke all on function compartilhamento_gerar(text[]) from public, anon;
revoke all on function compartilhamento_revogar() from public, anon;
revoke all on function compartilhamento_escopo_atualizar(text[]) from public, anon;
revoke all on function link_resumo(text) from public;
revoke all on function link_itens(text, text, uuid, int, int) from public;
revoke all on function link_series(text, uuid) from public;
revoke all on function link_capa(text, text) from public;
revoke all on function item_salvar(uuid, jsonb, uuid[]) from public, anon;
revoke all on function serie_salvar(uuid, jsonb, uuid[]) from public, anon;
revoke all on function serie_marcar_lida(uuid, numeric, text, text, boolean) from public, anon;
revoke all on function serie_desfazer_marcacao(uuid, jsonb) from public, anon;
grant execute on function escopo_valido(text[]) to authenticated;
grant execute on function compartilhamento_gerar(text[]) to authenticated;
grant execute on function compartilhamento_revogar() to authenticated;
grant execute on function compartilhamento_escopo_atualizar(text[]) to authenticated;
grant execute on function item_salvar(uuid, jsonb, uuid[]) to authenticated;
grant execute on function serie_salvar(uuid, jsonb, uuid[]) to authenticated;
grant execute on function serie_marcar_lida(uuid, numeric, text, text, boolean) to authenticated;
grant execute on function serie_desfazer_marcacao(uuid, jsonb) to authenticated;
grant execute on function link_resumo(text) to anon, authenticated;
grant execute on function link_itens(text, text, uuid, int, int) to anon, authenticated;
grant execute on function link_series(text, uuid) to anon, authenticated;
grant execute on function link_capa(text, text) to anon, authenticated;

commit;
