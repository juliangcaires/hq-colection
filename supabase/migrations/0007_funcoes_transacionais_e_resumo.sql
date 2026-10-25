-- 0007 — operações atômicas (B-10) e resumo de séries no banco (P-04)
--
-- Todas as funções são `security invoker`: rodam com os direitos do usuário logado, então a RLS
-- (inclusive os WITH CHECK da 0006) continua valendo. Se qualquer passo falha, o PostgreSQL desfaz
-- a função inteira — nada de item sem tags, série pela metade ou tags mescladas pela metade.
--
-- Pré-requisito: 0006 aplicada.

begin;

-- ---------------------------------------------------------------------------------------------
-- P-04 · séries com furos e "completa" calculados no banco
--
-- Mesma regra de src/lib/volumes.ts:
--  * só número inteiro positivo conta; `desejo` conhece o volume mas não o possui;
--  * teto da faixa = total_volumes (máx. 5000) ou o maior número conhecido (também limitado a 5000);
--  * série sem nenhum volume inteiro → sem furos;
--  * completa = total declarado, adquiridos >= total e (sem numeração ou sem furos).
-- `p_padrao` é um padrão ILIKE já escapado pelo app (ex.: '%berserk%'); null = todas.
-- ---------------------------------------------------------------------------------------------
create or replace function series_com_resumo(p_padrao text default null)
returns table (
  id uuid,
  nome text,
  tipo tipo_obra,
  total_volumes int,
  em_publicacao boolean,
  tem_numeracao boolean,
  faltantes int[],
  completa boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      s.id, s.nome, s.tipo, s.total_volumes, s.em_publicacao, s.tem_numeracao,
      (select count(*) from itens i where i.serie_id = s.id and i.estado <> 'desejo') as adquiridos,
      (select max(i.numero_volume)::int
         from itens i
        where i.serie_id = s.id and i.numero_volume > 0 and i.numero_volume = trunc(i.numero_volume)) as maximo
    from series s
    where p_padrao is null or s.nome ilike p_padrao
  ),
  calc as (
    select b.*,
      case
        when b.maximo is null then '{}'::int[]
        else array(
          select n
            from generate_series(
                   1,
                   least(case when b.total_volumes > 0 then b.total_volumes else b.maximo end, 5000)
                 ) as n
           where not exists (
             select 1 from itens i
              where i.serie_id = b.id and i.estado <> 'desejo' and i.numero_volume = n
           )
        )
      end as faltantes
    from base b
  )
  select
    c.id, c.nome, c.tipo, c.total_volumes, c.em_publicacao, c.tem_numeracao, c.faltantes,
    (
      coalesce(c.total_volumes, 0) > 0
      and c.adquiridos >= c.total_volumes
      and (not c.tem_numeracao or cardinality(c.faltantes) = 0)
    ) as completa
  from calc c
  order by c.nome, c.id
$$;

-- ---------------------------------------------------------------------------------------------
-- B-10 · salvar item (criar ou editar) com as tags, numa transação
-- ---------------------------------------------------------------------------------------------
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
                       preco, loja, data_aquisicao, nota, observacoes)
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
      (p_dados->>'nota')::int,
      nullif(p_dados->>'observacoes', '')
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
      nota = (p_dados->>'nota')::int,
      observacoes = nullif(p_dados->>'observacoes', '')
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

-- ---------------------------------------------------------------------------------------------
-- B-10 · salvar série (criar ou editar) com as tags, numa transação
-- ---------------------------------------------------------------------------------------------
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
    insert into series (user_id, nome, tipo, total_volumes, em_publicacao, tem_numeracao, observacoes)
    values (
      auth.uid(),
      p_dados->>'nome',
      (p_dados->>'tipo')::tipo_obra,
      (p_dados->>'total_volumes')::int,
      coalesce((p_dados->>'em_publicacao')::boolean, true),
      coalesce((p_dados->>'tem_numeracao')::boolean, false),
      nullif(p_dados->>'observacoes', '')
    )
    returning id into v_id;
  else
    update series set
      nome = p_dados->>'nome',
      tipo = (p_dados->>'tipo')::tipo_obra,
      total_volumes = (p_dados->>'total_volumes')::int,
      em_publicacao = coalesce((p_dados->>'em_publicacao')::boolean, true),
      tem_numeracao = coalesce((p_dados->>'tem_numeracao')::boolean, false),
      observacoes = nullif(p_dados->>'observacoes', '')
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

-- ---------------------------------------------------------------------------------------------
-- B-10 · mesclar tags: reaponta os vínculos e apaga as de origem, numa transação
-- ---------------------------------------------------------------------------------------------
create or replace function tags_mesclar(p_origens uuid[], p_destino uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_origens uuid[] := array(select o from unnest(p_origens) as o where o <> p_destino);
begin
  if not exists (select 1 from tags where id = p_destino) then
    raise exception 'tag_nao_encontrada';
  end if;
  if cardinality(v_origens) = 0 then
    return;
  end if;
  -- Origem que o usuário não enxerga (de outro usuário ou inexistente) não pode passar em silêncio.
  if (select count(*) from tags where id = any (v_origens)) <> (select count(distinct o) from unnest(v_origens) as o) then
    raise exception 'tag_nao_encontrada';
  end if;

  insert into serie_tags (serie_id, tag_id)
  select serie_id, p_destino from serie_tags where tag_id = any (v_origens)
  on conflict do nothing;

  insert into item_tags (item_id, tag_id)
  select item_id, p_destino from item_tags where tag_id = any (v_origens)
  on conflict do nothing;

  delete from tags where id = any (v_origens);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- B-04/B-10 · criar vários volumes de uma série: trava por série (sem corrida), checa repetidos,
-- insere itens e tags na mesma transação. Substitui a checagem "ler e depois inserir" do app.
-- Série numerada: repetir número é erro; sem numeração, o repetido é pulado.
-- ---------------------------------------------------------------------------------------------
create or replace function volumes_criar_em_lote(
  p_serie uuid,
  p_numeros numeric[],
  p_dados jsonb,
  p_tag_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_serie series%rowtype;
  v_ocupados numeric[];
  v_numeros numeric[];
  v_repetidos numeric[];
  v_criados jsonb;
  v_ids uuid[];
begin
  perform pg_advisory_xact_lock(hashtextextended(p_serie::text, 0));

  select * into v_serie from series where id = p_serie;
  if not found then
    raise exception 'serie_nao_encontrada';
  end if;

  select coalesce(array_agg(numero_volume), '{}') into v_ocupados
    from itens where serie_id = p_serie and numero_volume is not null;

  v_numeros := array(select distinct n from unnest(p_numeros) as n order by n);
  v_repetidos := array(select n from unnest(v_numeros) as n where n = any (v_ocupados));

  if v_serie.tem_numeracao and cardinality(v_repetidos) > 0 then
    raise exception 'volumes_repetidos:%', array_to_string(v_repetidos, ',');
  end if;

  -- Dois comandos (e não um CTE só): a policy de item_tags confere o dono do item consultando
  -- `itens`, e um comando não enxerga as linhas que ele mesmo acabou de inserir.
  with novos as (
    insert into itens (user_id, serie_id, titulo, numero_volume, tipo, estado, prioridade,
                       preco, loja, data_aquisicao)
    select
      auth.uid(), p_serie, v_serie.nome || ' #' || n::text, n, v_serie.tipo,
      (p_dados->>'estado')::estado_item,
      coalesce((p_dados->>'prioridade')::int, 0),
      (p_dados->>'preco')::numeric,
      nullif(p_dados->>'loja', ''),
      nullif(p_dados->>'data_aquisicao', '')::date
    from unnest(v_numeros) as n
    where n <> all (v_ocupados)
    returning id, titulo, tipo
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'titulo', titulo, 'tipo', tipo)), '[]'::jsonb),
         coalesce(array_agg(id), '{}')
    into v_criados, v_ids
    from novos;

  insert into item_tags (item_id, tag_id)
  select i, t from unnest(v_ids) as i, unnest(coalesce(p_tag_ids, '{}')) as t;

  return jsonb_build_object('criados', v_criados, 'ignorados', to_jsonb(v_repetidos));
end;
$$;

-- Só usuário logado executa (a RLS já impediria o resto, mas não precisa nem chegar lá).
revoke all on function series_com_resumo(text) from public, anon;
revoke all on function item_salvar(uuid, jsonb, uuid[]) from public, anon;
revoke all on function serie_salvar(uuid, jsonb, uuid[]) from public, anon;
revoke all on function tags_mesclar(uuid[], uuid) from public, anon;
revoke all on function volumes_criar_em_lote(uuid, numeric[], jsonb, uuid[]) from public, anon;
grant execute on function series_com_resumo(text) to authenticated;
grant execute on function item_salvar(uuid, jsonb, uuid[]) to authenticated;
grant execute on function serie_salvar(uuid, jsonb, uuid[]) to authenticated;
grant execute on function tags_mesclar(uuid[], uuid) to authenticated;
grant execute on function volumes_criar_em_lote(uuid, numeric[], jsonb, uuid[]) to authenticated;

commit;
