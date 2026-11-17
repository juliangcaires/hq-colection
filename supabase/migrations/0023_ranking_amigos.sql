-- 0023 — ranking dos amigos, por volume (demanda R3 do estudo do Letterboxd, seções 4.1, 5 e 12)
--
-- Pré-requisito: 0022 aplicada (usa privado.v_avaliacao, privado.isbn13_norm, privado.feed_item_visivel e obra_equivalencias).
--
-- Uma linha por VOLUME (obra) com as notas dos amigos aceitos que compartilham `notas_criticas`:
--  * visibilidade: a mesma regra de `obra_amigos` (privado.v_avaliacao): amizade aceita, item lido, escopo
--    `notas_criticas`; a crítica nem é lida aqui (só a nota), então crítica privada não tem como vazar;
--  * agrupamento: mesma `obra_chave` e, em segundo lugar, mesmo ISBN-13 (une chaves diferentes). A raiz do grupo é a
--    menor chave entre as que compartilham ISBN (um salto; cadeias de dois saltos não são unidas). O vínculo manual
--    (0020) é só da visão de quem vinculou: serve para achar o SEU item da obra, nunca para juntar notas de amigos;
--  * variante conta uma vez; cada amigo entra uma vez por obra (leitura mais recente);
--  * a SUA nota fica fora da média e vem à parte (`minha_nota`, `meu_item_id`);
--  * ordenar por média suavizada: score = (soma + m·C) / (n + m), m = 1, C = média de TODAS as notas visíveis dos amigos
--    (3,5 se não houver). A média real e a quantidade são devolvidas para exibir; o score só ordena;
--  * período e "só os que eu não li": `p_desde`/`p_ate` olham `lido_em` do amigo (que só é visível com `lidos` no
--    escopo; sem a data, a nota só aparece em "sempre"); "não li" = você não tem o volume como lido.

begin;

-- Média suavizada (estimador bayesiano leve): puxa poucas notas para C. Mesma conta do app (src/lib/ranking-amigos.ts).
create or replace function privado.score_suavizado(p_soma numeric, p_n numeric, p_c numeric, p_m numeric default 1)
returns numeric
language sql
immutable
set search_path = pg_catalog
as $$
  select (p_soma + p_m * p_c) / (p_n + p_m)
$$;

create or replace function ranking_amigos(
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
           i.capa_url, i.lido_marcado_em, i.updated_at, v.nota, v.lido_em,
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
    select i.id, i.obra_chave, i.estado, i.nota, i.lido_marcado_em,
           privado.isbn13_norm(i.isbn) as isbn_a, privado.isbn13_norm(ed.isbn13) as isbn_b
      from itens i
      left join edicoes ed on ed.id = i.edicao_id
     where i.user_id = auth.uid() and i.variante_de is null
  ),
  pagina as (
    select g.grupo, g.n, g.soma, g.media, g.ultima, g.isbn, g.rep_id, g.avatares,
           privado.score_suavizado(g.soma, g.n, (select c from constante)) as score_exato,
           mi.id as meu_id, mi.estado as meu_estado, mi.nota as meu_nota,
           ri.titulo as r_titulo, ri.numero_volume as r_numero, ri.tipo::text as r_tipo,
           rs.nome as r_serie, rs.tem_numeracao as r_tem_numeracao
      from agrupado g
      join itens ri on ri.id = g.rep_id
      left join series rs on rs.id = ri.serie_id
      left join lateral (
        select m.id, m.estado, m.nota
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
                 when 'nota' then array[round(pg.score_exato, 6), pg.n::numeric, pg.media, coalesce(extract(epoch from pg.ultima)::numeric, -1)]
                 when 'lidos' then array[pg.n::numeric, pg.media, round(pg.score_exato, 6), coalesce(extract(epoch from pg.ultima)::numeric, -1)]
                 when 'media' then array[pg.media, pg.n::numeric, round(pg.score_exato, 6), coalesce(extract(epoch from pg.ultima)::numeric, -1)]
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

-- Para os estados vazios da tela: quantos amigos aceitos e quantos deles deixam os amigos verem as notas.
create or replace function ranking_amigos_estado()
returns table (amigos int, amigos_com_notas int)
language sql
stable
security definer
set search_path = public, privado
as $$
  with amigos as (
    select case when a.solicitante = auth.uid() then a.destinatario else a.solicitante end as id
      from amizades a
     where auth.uid() is not null
       and a.status = 'aceita'
       and auth.uid() in (a.solicitante, a.destinatario)
  )
  select count(*)::int,
         count(*) filter (where coalesce('notas_criticas' = any (p.escopo_amigos), false))::int
    from amigos am
    left join perfis p on p.user_id = am.id
$$;

revoke all on all functions in schema privado from public, anon, authenticated;

revoke all on function ranking_amigos(text, date, date, text, boolean, int, int) from public, anon;
revoke all on function ranking_amigos_estado() from public, anon;

grant execute on function ranking_amigos(text, date, date, text, boolean, int, int) to authenticated;
grant execute on function ranking_amigos_estado() to authenticated;

commit;
