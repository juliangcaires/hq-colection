-- 0010 — "Lido em" e marcar série como lida com avaliação em cascata (Fase 1 das melhorias)
--
-- Pré-requisito: 0009 aplicada. Funções `security invoker`: a RLS do dono continua valendo.

begin;

alter table itens add column if not exists lido_em date;

-- ---------------------------------------------------------------------------------------------
-- serie_marcar_lida: marca os volumes `comprado` como `lido` e aplica nota/crítica, numa transação.
--
--  p_modo:
--    'serie'            nota só na série; volumes não recebem nota
--    'serie_e_sem_nota' nota na série e nos volumes lidos que ainda não têm nota (padrão da UI)
--    'serie_e_todos'    nota na série e em todos os volumes lidos (substitui a nota deles)
--  Crítica: em TODOS os modos só vai para volumes lidos com crítica vazia; a de volume nunca é sobrescrita.
--  p_nota null  = não mexe em nota (série nem volumes). p_critica null = não mexe; '' = limpa a da série.
--  p_marcar_lidos false = só avalia (tela "Avaliar série"): volumes comprados continuam comprados.
--
-- Devolve contagens e um snapshot do estado anterior (para `serie_desfazer_marcacao`).
-- ---------------------------------------------------------------------------------------------
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
    select i.id, i.estado, i.nota, i.critica, i.lido_em,
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
      critica = case when a.grava_critica then v_critica else i.critica end
    from afetados a
    where i.id = a.id
    returning a.*
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'estado', estado, 'nota', nota, 'critica', critica, 'lido_em', lido_em
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
           (e->>'lido_em')::date as lido_em
      from jsonb_array_elements(coalesce(p_snapshot->'itens', '[]'::jsonb)) e
  ),
  upd as (
    update itens i set estado = a.estado, nota = a.nota, critica = a.critica, lido_em = a.lido_em
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
-- lido_em: preenchido pelo próprio banco quando o item vira `lido` (individual, lote, CSV, volumes
-- em lote) e limpo quando deixa de ser lido. Itens já lidos antes desta migration ficam com null.
-- Fuso do app (America/Sao_Paulo), igual a FUSO_DO_APP em src/lib/datas.ts.
-- ---------------------------------------------------------------------------------------------
create or replace function itens_definir_lido_em()
returns trigger
language plpgsql
as $$
begin
  if new.estado = 'lido' then
    if tg_op = 'INSERT' or old.estado is distinct from 'lido' then
      new.lido_em := coalesce(new.lido_em, (now() at time zone 'America/Sao_Paulo')::date);
    end if;
  else
    new.lido_em := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_itens_lido_em on itens;
create trigger trg_itens_lido_em before insert or update on itens
  for each row execute function itens_definir_lido_em();

-- item_salvar passa a gravar `lido_em` (editável no item) — só vale para item lido.
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
                       preco, loja, data_aquisicao, nota, critica, lido_em)
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
      nullif(p_dados->>'lido_em', '')::date
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
      lido_em = nullif(p_dados->>'lido_em', '')::date
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

revoke all on function serie_marcar_lida(uuid, numeric, text, text, boolean) from public, anon;
revoke all on function serie_desfazer_marcacao(uuid, jsonb) from public, anon;
grant execute on function serie_marcar_lida(uuid, numeric, text, text, boolean) to authenticated;
grant execute on function serie_desfazer_marcacao(uuid, jsonb) to authenticated;

commit;
