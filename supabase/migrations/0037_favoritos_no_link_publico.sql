-- 0037 — favoritos do perfil no link público da coleção (`/c/<token>`)
--
-- Pré-requisito: 0036 aplicada (tabela `favoritos`, série ou volume avulso, no limite de 4).
--
-- `link_favoritos(token)` espelha `amigo_favoritos(apelido)` (0036), mas pelo TOKEN e pelo ESCOPO DO PRÓPRIO LINK
-- (`compartilhamentos.escopo`), não pelo escopo de amigos:
--  * série: só com a seção "series" no escopo do link (e com volume possuído: privado.v_series);
--  * volume avulso: só com a seção "colecao" no escopo do link, e só se está comprado ou lido, sem série e sem ser
--    variante (a mesma regra da vitrine e do amigo);
--  * link inexistente, revogado ou com formato inválido: não devolve nada, sem distinguir o motivo (como as outras
--    `link_*`); o visitante sem login pode chamar (anon), como `link_resumo`/`link_itens`/`link_series`/`link_capa`;
--  * só origem, id, nome (da série ou título do volume), tipo, capa e posição saem. Nota, crítica, preço, loja, data
--    e a pasta do dono nunca. A capa vem no formato da vitrine: `pub/…` direto do catálogo público; privada só o nome
--    do arquivo, servida pela rota autorizada do link (`link_capa`, que aceita exatamente esses itens: avulso em
--    "colecao" e série em "series").
--
-- Uma chamada só por visita. Função nova, com nome novo: nada do que existe é alterado (app antigo + banco novo ok).

begin;

create or replace function link_favoritos(p_token text)
returns table (origem text, id uuid, nome text, tipo tipo_obra, capa text, posicao int)
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
  return query
  select 'serie'::text, s.id, s.nome, s.tipo, s.capa, f.posicao::int
    from favoritos f
    join privado.v_series(v.dono, v.escopo, null) s on s.id = f.serie_id
   where f.user_id = v.dono
  union all
  select 'avulso'::text, i.id, i.titulo, i.tipo,
         case when i.capa_url like 'pub/%' then i.capa_url else regexp_replace(i.capa_url, '^.*/', '') end,
         f.posicao::int
    from favoritos f
    join itens i on i.id = f.item_id and i.user_id = f.user_id
   where f.user_id = v.dono
     and 'colecao' = any (v.escopo)
     and i.serie_id is null and i.variante_de is null and i.estado in ('comprado', 'lido')
   order by 6;
end;
$$;

revoke all on function link_favoritos(text) from public;
grant execute on function link_favoritos(text) to anon, authenticated;

commit;
