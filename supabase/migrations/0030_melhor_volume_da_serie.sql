-- 0030 — melhor volume da série
-- O dono marca UM volume lido por série como "melhor da série" (`itens.melhor_da_serie`).
--
-- Pré-requisito: 0029 aplicada. Não edita 0001–0029.
--  * no máximo uma marca por (user_id, serie_id) (índice único parcial); marcar outro desmarca o anterior (RPC);
--  * marcar exige: volume lido, com série, item principal (não variante) e 2 ou mais principais lidos na série.
--    A nota é opcional (existem lidos sem nota) e apagar a nota não derruba a marca;
--  * a marca cai sozinha (sem erro) quando o item deixa de ser lido, muda de série ou vira variante, e quando a série
--    fica com menos de 2 lidos. INSERT sempre nasce `false`;
--  * vitrine: amigo com `notas_criticas` + `lidos` no escopo vê a marca (e ela desempata o ranking dele); o link público
--    `/c/[token]` nunca vê (sempre `false`, e a ordem não depende dela);
--  * ranking_amigos: devolve `n_melhor` (amigos que marcaram) e `meu_melhor`; `n_melhor` desempata logo depois do score
--    (ordem `nota`) e da média (ordem `media`).
-- Sem post no feed, sem coluna no CSV (o importar nunca escreve a coluna).

begin;

alter table itens add column melhor_da_serie boolean not null default false;

create unique index itens_melhor_da_serie_unico on itens (user_id, serie_id) where melhor_da_serie;

-- ---------------------------------------------------------------------------------------------
-- BEFORE: valida ao ligar a marca; derruba (sem erro) quando ela deixa de fazer sentido.
-- Nome depois de `trg_itens_lido_em` e antes de `trg_itens_variante_validar` (ordem alfabética).
-- ---------------------------------------------------------------------------------------------
create or replace function itens_melhor_da_serie_validar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.melhor_da_serie := false;
    return new;
  end if;

  if new.melhor_da_serie and not old.melhor_da_serie then
    if new.estado <> 'lido' then
      raise exception 'melhor_exige_lido';
    end if;
    if new.serie_id is null then
      raise exception 'melhor_exige_serie';
    end if;
    if new.variante_de is not null then
      raise exception 'melhor_em_variante';
    end if;
    -- `new` ainda não foi gravada: conta as outras linhas (a própria já é um principal lido).
    if not exists (
      select 1 from itens o
       where o.user_id = new.user_id
         and o.serie_id = new.serie_id
         and o.variante_de is null
         and o.estado = 'lido'
         and o.id <> new.id
    ) then
      raise exception 'melhor_exige_dois_lidos';
    end if;
  elsif new.melhor_da_serie and old.melhor_da_serie then
    if new.estado <> 'lido'
       or new.serie_id is distinct from old.serie_id
       or new.variante_de is not null then
      new.melhor_da_serie := false;
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_itens_melhor_da_serie_validar before insert or update on itens
  for each row execute function itens_melhor_da_serie_validar();

-- ---------------------------------------------------------------------------------------------
-- AFTER: a série ficou com menos de 2 principais lidos => a marca dela cai. O UPDATE de dentro não
-- re-dispara este gatilho (a lista OF não inclui `melhor_da_serie`). Dispara também nos updates em
-- cascata da sincronização de variantes (0024), o que é o esperado.
-- ---------------------------------------------------------------------------------------------
create or replace function itens_melhor_da_serie_recontar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.serie_id is not null
     and (select count(*) from itens i
           where i.user_id = old.user_id
             and i.serie_id = old.serie_id
             and i.variante_de is null
             and i.estado = 'lido') < 2 then
    update itens set melhor_da_serie = false
     where user_id = old.user_id and serie_id = old.serie_id and melhor_da_serie;
  end if;
  return null;
end;
$$;

create trigger trg_itens_melhor_da_serie_recontar after update of estado, serie_id, variante_de or delete on itens
  for each row execute function itens_melhor_da_serie_recontar();

-- ---------------------------------------------------------------------------------------------
-- RPC: marcar/desmarcar. security invoker (a RLS `itens_owner` vale). Trava a série para serializar
-- duas marcações simultâneas; as validações ficam com o gatilho.
-- ---------------------------------------------------------------------------------------------
create or replace function item_melhor_da_serie_definir(p_item uuid, p_marcar boolean)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v itens%rowtype;
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;

  select * into v from itens where id = p_item and user_id = auth.uid() for update;
  if not found then
    raise exception 'item_nao_encontrado';
  end if;

  if not coalesce(p_marcar, false) then
    update itens set melhor_da_serie = false where id = p_item;
    return;
  end if;

  if v.serie_id is not null then
    perform 1 from series where id = v.serie_id for update;
    update itens set melhor_da_serie = false
     where user_id = auth.uid() and serie_id = v.serie_id and melhor_da_serie and id <> p_item;
  end if;
  update itens set melhor_da_serie = true where id = p_item;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Vitrine (amigos e link): `melhor_da_serie` entra no fim do tipo `vitrine_item` (depois de `critica_spoiler`).
-- `link_itens` e `amigo_itens` repassam o tipo como está. Corpo de `privado.v_itens` da 0024.
-- ---------------------------------------------------------------------------------------------
alter type vitrine_item add attribute melhor_da_serie boolean;

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
    count(*) over () as total,
    (b.estado = 'lido' and 'notas_criticas' = any (p_escopo) and not b.critica_privada and b.critica is not null and b.critica_spoiler) as critica_spoiler,
    -- Marca de melhor da série: só para amigo (nunca no link público) com `notas_criticas` + `lidos` no escopo.
    (p_viewer is not null and b.estado = 'lido' and b.variante_de is null
       and 'notas_criticas' = any (p_escopo) and 'lidos' = any (p_escopo) and b.melhor_da_serie) as melhor_da_serie
  from base b
  left join edicoes e on e.id = b.edicao_id
  left join presentes pr on pr.item_id = b.id
  order by
    case when p_secao = 'ranking' then b.nota end desc nulls last,
    case when p_secao = 'ranking' then
      (p_viewer is not null and b.estado = 'lido' and b.variante_de is null
         and 'notas_criticas' = any (p_escopo) and 'lidos' = any (p_escopo) and b.melhor_da_serie)
    end desc nulls last,
    case when p_secao = 'lidos' then b.lido_em end desc nulls last,
    case when p_secao = 'serie' then b.numero_volume end asc nulls last,
    b.created_at desc,
    b.id
  limit least(greatest(coalesce(p_limite, 60), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

revoke all on all functions in schema privado from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- ranking_amigos: o retorno muda (n_melhor, meu_melhor antes de `total`), então recria. Corpo da 0023.
-- ---------------------------------------------------------------------------------------------
drop function ranking_amigos(text, date, date, text, boolean, int, int);

create function ranking_amigos(
  p_tipo text default null,
  p_desde date default null,
  p_ate date default null,
  p_ordem text default 'nota',
  p_so_nao_lidos boolean default false,
  p_limite int default 30,
  p_offset int default 0
)
returns table (
  obra_chave text,
  isbn text,
  titulo text,
  numero_volume numeric,
  serie_nome text,
  tem_numeracao boolean,
  tipo text,
  n int,
  soma numeric,
  media numeric,
  score numeric,
  ultima_leitura date,
  avatares jsonb,
  minha_nota numeric,
  meu_item_id uuid,
  capa_publica text,
  capa_item_id uuid,
  n_melhor int,
  meu_melhor boolean,
  total bigint
)
language plpgsql
stable
security definer
set search_path = public, privado
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if p_ordem not in ('nota', 'lidos', 'media', 'recentes') then
    raise exception 'ordem_invalida';
  end if;
  if p_tipo is not null and p_tipo not in ('hq', 'manga') then
    raise exception 'tipo_invalido';
  end if;

  return query
  with amigos as (
    select case when a.solicitante = auth.uid() then a.destinatario else a.solicitante end as id
      from amizades a
     where a.status = 'aceita'
       and auth.uid() in (a.solicitante, a.destinatario)
  ),
  -- Toda nota visível de amigo (sem filtros): base do C e dos grupos. Sem chave e sem ISBN não há como casar: fica fora.
  avaliados as (
    select i.id, i.user_id, i.serie_id, i.titulo as i_titulo, i.numero_volume as i_numero, i.tipo::text as i_tipo,
           i.capa_url, i.lido_marcado_em, i.updated_at, i.melhor_da_serie, v.nota, v.lido_em,
           coalesce(privado.isbn13_norm(i.isbn), privado.isbn13_norm(e.isbn13)) as i_isbn,
           coalesce(i.obra_chave, 'isbn:' || coalesce(privado.isbn13_norm(i.isbn), privado.isbn13_norm(e.isbn13))) as chave
      from itens i
      join amigos am on am.id = i.user_id
      left join edicoes e on e.id = i.edicao_id
      cross join lateral privado.v_avaliacao(i.id, auth.uid()) v
     where i.estado = 'lido'
       and i.variante_de is null
       and v.nota is not null
       and (i.obra_chave is not null or coalesce(privado.isbn13_norm(i.isbn), privado.isbn13_norm(e.isbn13)) is not null)
  ),
  constante as (select coalesce(avg(nota), 3.5) as c from avaliados),
  isbn_raiz as (
    select a.i_isbn, min(a.chave) as raiz from avaliados a where a.i_isbn is not null group by a.i_isbn
  ),
  chave_raiz as (
    select a.chave, least(a.chave, min(ir.raiz)) as raiz
      from avaliados a
      left join isbn_raiz ir on ir.i_isbn = a.i_isbn
     group by a.chave
  ),
  -- Filtros de tipo e período, depois uma linha por amigo e grupo (leitura mais recente).
  escolhidos as (
    select distinct on (cr.raiz, a.user_id) cr.raiz as grupo, a.*
      from avaliados a
      join chave_raiz cr on cr.chave = a.chave
     where (p_tipo is null or a.i_tipo = p_tipo)
       and (p_desde is null or a.lido_em >= p_desde)
       and (p_ate is null or a.lido_em <= p_ate)
     order by cr.raiz, a.user_id, a.lido_marcado_em desc nulls last, a.updated_at desc, a.id
  ),
  agrupado as (
    select e.grupo,
           count(*)::int as n,
           count(*) filter (where e.melhor_da_serie)::int as n_melhor,
           sum(e.nota) as soma,
           round(avg(e.nota), 4) as media,
           max(e.lido_em) as ultima,
           min(e.i_isbn) as isbn,
           (array_agg(e.id order by e.lido_em desc nulls last, e.lido_marcado_em desc nulls last, e.updated_at desc, e.id))[1] as rep_id,
           to_jsonb((array_agg(jsonb_build_object('apelido', p.apelido, 'nome_exibicao', p.nome_exibicao, 'avatar_url', p.avatar_url)
                               order by e.lido_em desc nulls last, p.apelido, e.user_id))[1:3]) as avatares
      from escolhidos e
      join perfis p on p.user_id = e.user_id
     group by e.grupo
  ),
  meus as (
    select i.id, i.obra_chave, i.estado, i.nota, i.melhor_da_serie, i.lido_marcado_em,
           privado.isbn13_norm(i.isbn) as isbn_a, privado.isbn13_norm(ed.isbn13) as isbn_b
      from itens i
      left join edicoes ed on ed.id = i.edicao_id
     where i.user_id = auth.uid() and i.variante_de is null
  ),
  pagina as (
    select g.grupo, g.n, g.n_melhor, g.soma, g.media, g.ultima, g.isbn, g.rep_id, g.avatares,
           privado.score_suavizado(g.soma, g.n, (select c from constante)) as score_exato,
           mi.id as meu_id, mi.estado as meu_estado, mi.nota as meu_nota, mi.melhor_da_serie as meu_melhor,
           ri.titulo as r_titulo, ri.numero_volume as r_numero, ri.tipo::text as r_tipo,
           rs.nome as r_serie, rs.tem_numeracao as r_tem_numeracao
      from agrupado g
      join itens ri on ri.id = g.rep_id
      left join series rs on rs.id = ri.serie_id
      left join lateral (
        select m.id, m.estado, m.nota, m.melhor_da_serie
          from meus m
         where m.obra_chave in (select cr.chave from chave_raiz cr where cr.raiz = g.grupo)
            or m.obra_chave in (select oe.obra_chave from obra_equivalencias oe
                                 where oe.user_id = auth.uid()
                                   and oe.obra_chave_amigo in (select cr.chave from chave_raiz cr where cr.raiz = g.grupo))
            or m.isbn_a in (select a.i_isbn from avaliados a join chave_raiz cr on cr.chave = a.chave where cr.raiz = g.grupo and a.i_isbn is not null)
            or m.isbn_b in (select a.i_isbn from avaliados a join chave_raiz cr on cr.chave = a.chave where cr.raiz = g.grupo and a.i_isbn is not null)
         order by (m.estado = 'lido') desc, m.lido_marcado_em desc nulls last, m.id
         limit 1
      ) mi on true
     where not (p_so_nao_lidos and coalesce(mi.estado::text, '') = 'lido')
  ),
  ordenada as (
    select pg.*,
           count(*) over () as total_geral,
           row_number() over (
             order by
               case p_ordem
                 when 'nota' then array[round(pg.score_exato, 6), pg.n_melhor::numeric, pg.n::numeric, pg.media, coalesce(extract(epoch from pg.ultima)::numeric, -1)]
                 when 'lidos' then array[pg.n::numeric, pg.media, round(pg.score_exato, 6), coalesce(extract(epoch from pg.ultima)::numeric, -1)]
                 when 'media' then array[pg.media, pg.n_melhor::numeric, pg.n::numeric, round(pg.score_exato, 6), coalesce(extract(epoch from pg.ultima)::numeric, -1)]
                 else array[coalesce(extract(epoch from pg.ultima)::numeric, -1), round(pg.score_exato, 6), pg.n::numeric, pg.media]
               end desc,
               lower(pg.r_titulo), pg.grupo
           ) as pos
      from pagina pg
  )
  select o.grupo,
         o.isbn,
         o.r_titulo,
         o.r_numero,
         o.r_serie,
         o.r_tem_numeracao,
         o.r_tipo,
         o.n,
         o.soma,
         o.media,
         round(o.score_exato, 4),
         o.ultima,
         o.avatares,
         case when o.meu_estado = 'lido' then o.meu_nota end,
         o.meu_id,
         cp.capa_url,
         cf.id,
         o.n_melhor,
         coalesce(o.meu_estado = 'lido' and o.meu_melhor, false),
         o.total_geral
    from ordenada o
    -- Capa do catálogo público (qualquer pessoa pode ver) ou, na falta dela, a de um item que o feed já mostra a você
    -- (a rota /feed/capa/[item] só serve o arquivo se `feed_item_visivel`). Sem nenhuma das duas: sem capa.
    left join lateral (
      select e.capa_url from escolhidos e
       where e.grupo = o.grupo and e.capa_url like 'pub/%'
       order by e.lido_em desc nulls last, e.id limit 1
    ) cp on true
    left join lateral (
      select e.id from escolhidos e
       where e.grupo = o.grupo and e.capa_url is not null and e.capa_url not like 'pub/%'
         and privado.feed_item_visivel(auth.uid(), e.id)
       order by e.lido_em desc nulls last, e.id limit 1
    ) cf on true
   where o.pos > greatest(0, coalesce(p_offset, 0))
     and o.pos <= greatest(0, coalesce(p_offset, 0)) + greatest(1, least(coalesce(p_limite, 30), 500))
   order by o.pos;
end;
$$;

revoke all on function item_melhor_da_serie_definir(uuid, boolean) from public, anon;
revoke all on function ranking_amigos(text, date, date, text, boolean, int, int) from public, anon;

grant execute on function item_melhor_da_serie_definir(uuid, boolean) to authenticated;
grant execute on function ranking_amigos(text, date, date, text, boolean, int, int) to authenticated;

commit;
