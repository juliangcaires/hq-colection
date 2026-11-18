-- 0027 — progresso "tenho X de Y" por série (R8 do estudo do Letterboxd)
--
-- Pré-requisito: 0017 aplicada (variantes). Não mexe em tabelas nem em RLS: só amplia `series_com_resumo`, que continua
-- `security invoker` (cada pessoa só enxerga as próprias séries e itens, como antes).
--
-- Novas colunas, calculadas no banco para a lista de séries não baixar todos os volumes:
--  * `tenho`   — volumes possuídos (comprado ou lido), cada um UMA vez: variante não conta, número repetido vale um,
--                item sem número conta um a um (não há como saber se são o mesmo);
--  * `lidos_n` — o mesmo recorte, só os lidos (subconjunto de `tenho`);
--  * `maximo_conhecido` — maior número de volume inteiro da série, desejos incluídos, variantes não. Serve de Y quando a
--                série não tem `total_volumes`: a tela diz "de N conhecidos". Nulo = nem total nem volume numerado, e
--                nenhum total é inventado.
-- As colunas antigas e a regra de furos/completa/lida ficam exatamente como na 0017. Mesma regra de
-- `src/lib/progresso-serie.ts` (o teste de paridade em migrations-sql.test.ts confere as duas).
--
-- Mudou o tipo de retorno, então a função é recriada.

begin;

drop function if exists series_com_resumo(text);
create function series_com_resumo(p_padrao text default null)
returns table (
  id uuid,
  nome text,
  tipo tipo_obra,
  total_volumes int,
  em_publicacao boolean,
  tem_numeracao boolean,
  faltantes int[],
  completa boolean,
  lida boolean,
  tenho int,
  lidos_n int,
  maximo_conhecido int
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
        where i.serie_id = s.id and i.numero_volume > 0 and i.numero_volume = trunc(i.numero_volume)) as maximo,
      (select max(i.numero_volume)::int
         from itens i
        where i.serie_id = s.id and i.variante_de is null
          and i.numero_volume > 0 and i.numero_volume = trunc(i.numero_volume)) as maximo_conhecido,
      (select count(distinct case when i.numero_volume > 0 then i.numero_volume end) + count(*) filter (where i.numero_volume is null or i.numero_volume <= 0)
         from itens i
        where i.serie_id = s.id and i.estado <> 'desejo' and i.variante_de is null) as tenho,
      (select count(distinct case when i.numero_volume > 0 then i.numero_volume end) + count(*) filter (where i.numero_volume is null or i.numero_volume <= 0)
         from itens i
        where i.serie_id = s.id and i.estado = 'lido' and i.variante_de is null) as lidos_n
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
    (c.adquiridos > 0 and c.na_fila = 0) as lida,
    c.tenho::int,
    c.lidos_n::int,
    c.maximo_conhecido
  from calc c
  order by c.nome, c.id
$$;

revoke all on function series_com_resumo(text) from public, anon;
grant execute on function series_com_resumo(text) to authenticated;

commit;
