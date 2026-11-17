-- 0017 — capa variante (D5 do estudo ESTUDO-OBRA-ENTRE-USUARIOS)
-- Uma variante é outro exemplar da MESMA obra (capa/edição diferente): `itens.variante_de` aponta para o
-- volume normal (o "principal"). Normal e variante compartilham estado de leitura, nota, crítica,
-- crítica privada e data de leitura; editar um reflete no outro.
-- Contagem: 2 na estante; 1 em lidos, progresso de leitura, ranking e posse da série (sem furo nem duplicidade).

begin;

alter table itens add column variante_de uuid references itens(id) on delete set null;
alter table itens add constraint itens_variante_nao_propria check (variante_de is null or variante_de <> id);
create index idx_itens_variante_de on itens (variante_de) where variante_de is not null;

-- ---------------------------------------------------------------------------------------------
-- Validação e herança no vínculo (BEFORE): o principal é do mesmo dono, não é variante, e a variante
-- não tem variantes próprias (sem cadeia). Ao vincular — ou ao adquirir uma variante que era desejo —
-- ela assume o que o principal já tem (estado, nota, crítica, data). Desejo não sincroniza.
-- ---------------------------------------------------------------------------------------------
create or replace function itens_validar_variante()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  p itens%rowtype;
  vinculando boolean;
begin
  if new.variante_de is null then
    return new;
  end if;

  vinculando := tg_op = 'INSERT' or old.variante_de is distinct from new.variante_de;

  if vinculando then
    select * into p from itens where id = new.variante_de;
    if not found then
      raise exception 'variante_principal_nao_encontrado';
    end if;
    if p.user_id <> new.user_id then
      raise exception 'variante_principal_nao_encontrado';
    end if;
    if p.variante_de is not null then
      raise exception 'variante_de_variante';
    end if;
    if tg_op = 'UPDATE' and exists (select 1 from itens v where v.variante_de = new.id) then
      raise exception 'variante_com_variantes';
    end if;
  elsif tg_op = 'UPDATE' and old.estado = 'desejo' and new.estado <> 'desejo' then
    select * into p from itens where id = new.variante_de;
    if not found then
      return new;
    end if;
  else
    return new;
  end if;

  if p.estado <> 'desejo' and new.estado <> 'desejo' then
    new.estado := p.estado;
    new.nota := p.nota;
    new.critica := p.critica;
    new.lido_em := p.lido_em;
    new.critica_privada := p.critica_privada;
  end if;
  return new;
end;
$$;

-- Nome depois de `trg_itens_lido_em` (ordem alfabética): a herança do principal vale por último.
create trigger trg_itens_variante_validar before insert or update on itens
  for each row execute function itens_validar_variante();

-- ---------------------------------------------------------------------------------------------
-- Sincronização (AFTER): editar o principal ou qualquer variante espalha estado/nota/crítica/lido_em/
-- crítica privada para o resto do grupo. O trigger aninhado (UPDATE dos irmãos) não se repete.
-- ---------------------------------------------------------------------------------------------
create or replace function itens_sincronizar_variantes()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_grupo uuid;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;
  -- Desejo não é leitura (nada a espalhar); item que acabou de sair de desejo herda no BEFORE, não impõe.
  if new.estado = 'desejo' or old.estado = 'desejo' then
    return null;
  end if;

  v_grupo := coalesce(new.variante_de, new.id);
  update itens i set
    estado = new.estado,
    nota = new.nota,
    critica = new.critica,
    lido_em = new.lido_em,
    critica_privada = new.critica_privada
  where i.id <> new.id
    and i.estado <> 'desejo'
    and (i.id = v_grupo or i.variante_de = v_grupo)
    and (i.estado, i.nota, i.critica, i.lido_em, i.critica_privada)
        is distinct from (new.estado, new.nota, new.critica, new.lido_em, new.critica_privada);
  return null;
end;
$$;

create trigger trg_itens_variante_sincronizar after update on itens
  for each row
  when (old.estado is distinct from new.estado
     or old.nota is distinct from new.nota
     or old.critica is distinct from new.critica
     or old.lido_em is distinct from new.lido_em
     or old.critica_privada is distinct from new.critica_privada)
  execute function itens_sincronizar_variantes();

-- ---------------------------------------------------------------------------------------------
-- item_salvar grava `variante_de` (chave ausente mantém o valor atual na edição; null desvincula).
-- Corpo da versão da 0013, só com o campo novo.
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
                       preco, loja, data_aquisicao, nota, critica, lido_em, edicao_id, critica_privada, variante_de)
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
      coalesce((p_dados->>'critica_privada')::boolean, false),
      nullif(p_dados->>'variante_de', '')::uuid
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
      critica_privada = case when p_dados ? 'critica_privada' then coalesce((p_dados->>'critica_privada')::boolean, false) else critica_privada end,
      variante_de = case when p_dados ? 'variante_de' then nullif(p_dados->>'variante_de', '')::uuid else variante_de end
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
-- Vincular/desvincular só o vínculo (página do volume), sem reenviar o formulário inteiro.
-- p_principal null desvincula. As validações ficam no trigger.
-- ---------------------------------------------------------------------------------------------
create or replace function item_definir_variante(p_item uuid, p_principal uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update itens set variante_de = p_principal where id = p_item;
  if not found then
    raise exception 'item_nao_encontrado';
  end if;
end;
$$;

revoke all on function item_salvar(uuid, jsonb, uuid[]) from public, anon;
grant execute on function item_salvar(uuid, jsonb, uuid[]) to authenticated;
revoke all on function item_definir_variante(uuid, uuid) from public, anon;
grant execute on function item_definir_variante(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Contagens: a posse da série (completa/lida/furos) e "lidos" contam a obra uma vez.
-- series_com_resumo: mesmo corpo da 0010, `adquiridos` e `na_fila` ignoram variantes.
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
  completa boolean,
  lida boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      s.id, s.nome, s.tipo, s.total_volumes, s.em_publicacao, s.tem_numeracao,
      (select count(*) from itens i where i.serie_id = s.id and i.estado <> 'desejo' and i.variante_de is null) as adquiridos,
      (select count(*) from itens i where i.serie_id = s.id and i.estado = 'comprado' and i.variante_de is null) as na_fila,
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
    ) as completa,
    (c.adquiridos > 0 and c.na_fila = 0) as lida
  from calc c
  order by c.nome, c.id
$$;

revoke all on function series_com_resumo(text) from public, anon;
grant execute on function series_com_resumo(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Vitrine (link público e amigos): coleção/série mostram os dois exemplares; lidos e ranking, só o principal.
-- ---------------------------------------------------------------------------------------------
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
         or (p_secao = 'lidos' and 'lidos' = any (p_escopo) and i.estado = 'lido' and i.variante_de is null)
         or (p_secao = 'desejos' and 'desejos' = any (p_escopo) and i.estado = 'desejo')
         or (p_secao = 'ranking' and 'ranking' = any (p_escopo) and i.estado = 'lido' and i.nota is not null and i.variante_de is null)
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
    case
      when p_secao in ('lidos', 'ranking') then 'lido'
      when b.estado = 'lido' and not ('lidos' = any (p_escopo)) then 'comprado'
      else b.estado::text
    end as estado,
    case when b.capa_url like 'pub/%' then b.capa_url else regexp_replace(b.capa_url, '^.*/', '') end as capa,
    case when b.estado = 'lido' and ('notas_criticas' = any (p_escopo) or p_secao = 'ranking') then b.nota end as nota,
    case when b.estado = 'lido' and 'notas_criticas' = any (p_escopo) and not b.critica_privada then b.critica end as critica,
    case when b.estado = 'lido' and 'lidos' = any (p_escopo) then b.lido_em end as lido_em,
    e.isbn13,
    (p_viewer is not null and b.estado = 'desejo' and pr.item_id is not null) as reservado,
    (p_viewer is not null and b.estado = 'desejo' and pr.amigo = p_viewer) as reservado_por_mim,
    count(*) over () as total
  from base b
  left join edicoes e on e.id = b.edicao_id
  left join presentes pr on pr.item_id = b.id
  order by
    case when p_secao = 'ranking' then b.nota end desc nulls last,
    case when p_secao = 'lidos' then b.lido_em end desc nulls last,
    case when p_secao = 'serie' then b.numero_volume end asc nulls last,
    b.created_at desc,
    b.id
  limit least(greatest(coalesce(p_limite, 60), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- v_series: possuídos e lidos da série contam a obra uma vez (a capa continua sendo a do 1º volume).
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
    (select count(*)::int from itens i where i.serie_id = s.id and i.estado <> 'desejo' and i.variante_de is null) as possuidos,
    case when 'lidos' = any (p_escopo) then (select count(*)::int from itens i where i.serie_id = s.id and i.estado = 'lido' and i.variante_de is null) end as lidos,
    case when 'notas_criticas' = any (p_escopo) then s.nota end as nota,
    case when 'notas_criticas' = any (p_escopo) and not s.critica_privada then s.critica end as critica,
    (select case when i.capa_url like 'pub/%' then i.capa_url else regexp_replace(i.capa_url, '^.*/', '') end
       from itens i where i.serie_id = s.id and i.estado <> 'desejo' and i.capa_url is not null
      order by i.variante_de nulls first, i.numero_volume nulls last, i.id limit 1) as capa
  from series s
  where s.user_id = p_dono
    and 'series' = any (p_escopo)
    and (p_serie is null or s.id = p_serie)
    and exists (select 1 from itens i where i.serie_id = s.id and i.estado <> 'desejo')
  order by lower(s.nome), s.id
$$;

-- v_resumo (0016): colecao conta os dois exemplares; lidos conta a obra uma vez.
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
    'avatar_url', p.avatar_url,
    'escopo', to_jsonb(p_escopo),
    'colecao', case when 'colecao' = any (p_escopo) then (select count(*) from itens i where i.user_id = p_dono and i.estado <> 'desejo') end,
    'lidos', case when 'lidos' = any (p_escopo) then (select count(*) from itens i where i.user_id = p_dono and i.estado = 'lido' and i.variante_de is null) end,
    'desejos', case when 'desejos' = any (p_escopo) then (select count(*) from itens i where i.user_id = p_dono and i.estado = 'desejo') end,
    'series', case when 'series' = any (p_escopo) then (select count(*) from series s where s.user_id = p_dono
                 and exists (select 1 from itens i where i.serie_id = s.id and i.estado <> 'desejo')) end
  )
  from (select 1) _
  left join perfis p on p.user_id = p_dono
$$;

commit;
