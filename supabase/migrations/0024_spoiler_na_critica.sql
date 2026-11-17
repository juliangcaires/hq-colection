-- 0024 — spoiler na crítica (R4 do estudo do Letterboxd)
-- Quem escreve a crítica de um volume pode marcá-la como spoiler (`itens.critica_spoiler`). Onde a crítica aparece
-- para OUTRAS pessoas (feed, bloco Amigos, painel de notas do ranking, vitrine e links públicos), o app mostra um
-- cartão recolhido; quem lê abre se quiser. Para o dono nada muda (a crítica aparece normal, com um selo).
--
-- O flag segue a regra da própria crítica: só sai junto com ela (crítica privada nunca sai, e sem `notas_criticas`
-- no escopo nada sai). Normal e variante compartilham o flag, como compartilham a crítica (0017).
-- Série não tem o flag (a crítica de série continua como estava). Não muda quem enxerga o quê.

begin;

alter table itens add column critica_spoiler boolean not null default false;

-- ---------------------------------------------------------------------------------------------
-- Variantes (0017): o flag viaja junto com a crítica. Corpos da 0017, só com o campo novo.
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
    new.critica_spoiler := p.critica_spoiler;
  end if;
  return new;
end;
$$;
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
    critica_privada = new.critica_privada,
    critica_spoiler = new.critica_spoiler
  where i.id <> new.id
    and i.estado <> 'desejo'
    and (i.id = v_grupo or i.variante_de = v_grupo)
    and (i.estado, i.nota, i.critica, i.lido_em, i.critica_privada, i.critica_spoiler)
        is distinct from (new.estado, new.nota, new.critica, new.lido_em, new.critica_privada, new.critica_spoiler);
  return null;
end;
$$;
drop trigger trg_itens_variante_sincronizar on itens;
create trigger trg_itens_variante_sincronizar after update on itens
  for each row
  when (old.estado is distinct from new.estado
     or old.nota is distinct from new.nota
     or old.critica is distinct from new.critica
     or old.lido_em is distinct from new.lido_em
     or old.critica_privada is distinct from new.critica_privada
     or old.critica_spoiler is distinct from new.critica_spoiler)
  execute function itens_sincronizar_variantes();

-- item_salvar grava `critica_spoiler` (chave ausente mantém o valor atual na edição). Corpo da 0019, só com o campo novo.
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
                       preco, loja, data_aquisicao, nota, critica, lido_em, edicao_id, critica_privada, variante_de, obra_chave, critica_spoiler)
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
      nullif(p_dados->>'variante_de', '')::uuid,
      nullif(p_dados->>'obra_chave', ''),
      coalesce((p_dados->>'critica_spoiler')::boolean, false)
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
      variante_de = case when p_dados ? 'variante_de' then nullif(p_dados->>'variante_de', '')::uuid else variante_de end,
      obra_chave = case when p_dados ? 'obra_chave' then nullif(p_dados->>'obra_chave', '') else obra_chave end,
      critica_spoiler = case when p_dados ? 'critica_spoiler' then coalesce((p_dados->>'critica_spoiler')::boolean, false) else critica_spoiler end
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
-- Regra única do que o visitante enxerga de uma avaliação de amigo (0019) + o flag de spoiler, que só sai
-- junto com a crítica (privada => sem crítica e sem flag). Muda o tipo de retorno: recria.
-- ---------------------------------------------------------------------------------------------
drop function privado.v_avaliacao(uuid, uuid);
create function privado.v_avaliacao(p_item uuid, p_viewer uuid)
returns table (nota numeric, critica text, lido_em date, critica_spoiler boolean)
language sql
stable
security definer
set search_path = public, privado
as $$
  select i.nota,
         case when not i.critica_privada then i.critica end,
         case when 'lidos' = any (p.escopo_amigos) then i.lido_em end,
         (not i.critica_privada and i.critica is not null and i.critica_spoiler)
    from itens i
    join perfis p on p.user_id = i.user_id
   where i.id = p_item
     and i.estado = 'lido'
     and 'notas_criticas' = any (p.escopo_amigos)
     and privado.sao_amigos(p_viewer, i.user_id)
$$;

-- obra_amigos: mesma regra da 0020, com o flag depois da crítica (muda o retorno: recria).
drop function obra_amigos(text, text);
create function obra_amigos(p_obra_chave text, p_isbn text default null)
returns table (
  item_id uuid,
  dono_id uuid,
  apelido text,
  nome_exibicao text,
  avatar_url text,
  nota numeric,
  critica text,
  critica_spoiler boolean,
  lido_em date,
  casou_por text,
  interagivel boolean,
  curtidas int,
  curti boolean,
  comentarios int
)
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
  ),
  meu as (select privado.isbn13_norm(p_isbn) as isbn),
  eq as (
    select oe.obra_chave_amigo as chave
      from obra_equivalencias oe
     where oe.user_id = auth.uid() and oe.obra_chave = p_obra_chave and coalesce(p_obra_chave, '') <> ''
  ),
  candidatos as (
    select i.id, i.user_id, i.lido_marcado_em, i.updated_at,
           case
             when (select isbn from meu) is not null
                  and (privado.isbn13_norm(e.isbn13) = (select isbn from meu) or privado.isbn13_norm(i.isbn) = (select isbn from meu)) then 'isbn'
             when coalesce(p_obra_chave, '') <> '' and i.obra_chave = p_obra_chave then 'nome'
             when i.obra_chave in (select chave from eq) then 'manual'
           end as por
      from itens i
      join amigos am on am.id = i.user_id
      left join edicoes e on e.id = i.edicao_id
     where i.estado = 'lido'
       and i.variante_de is null
       and exists (select 1 from privado.v_avaliacao(i.id, auth.uid()) v where v.nota is not null or v.critica is not null)
  ),
  escolhidos as (
    select distinct on (c.user_id) c.id, c.user_id, c.por
      from candidatos c
     where c.por is not null
     order by c.user_id, case c.por when 'isbn' then 1 when 'nome' then 2 else 3 end, c.lido_marcado_em desc nulls last, c.updated_at desc, c.id
  )
  select c.id,
         c.user_id,
         p.apelido,
         p.nome_exibicao,
         p.avatar_url,
         v.nota,
         v.critica,
         v.critica_spoiler,
         v.lido_em,
         c.por,
         privado.feed_item_visivel(auth.uid(), c.id),
         (select count(*)::int from feed_curtidas k
           where k.item_id = c.id and privado.feed_autor_visivel(auth.uid(), c.user_id, k.user_id)),
         exists (select 1 from feed_curtidas k where k.item_id = c.id and k.user_id = auth.uid()),
         (select count(*)::int from feed_comentarios m
           where m.item_id = c.id and privado.feed_autor_visivel(auth.uid(), c.user_id, m.user_id))
    from escolhidos c
    join perfis p on p.user_id = c.user_id
    cross join lateral privado.v_avaliacao(c.id, auth.uid()) v
   order by v.nota desc nulls last, p.apelido
$$;

-- feed_listar: mesma regra da 0018, com o flag depois da crítica (muda o retorno: recria).
drop function feed_listar(int, timestamptz);
create function feed_listar(p_limite int default 30, p_antes timestamptz default null)
returns table (
  item_id uuid,
  dono_id uuid,
  apelido text,
  nome_exibicao text,
  avatar_url text,
  proprio boolean,
  serie_nome text,
  titulo text,
  numero_volume numeric,
  tipo tipo_obra,
  capa text,
  nota numeric,
  critica text,
  critica_spoiler boolean,
  lido_em date,
  marcado_em timestamptz,
  qtd int,
  curtidas int,
  curti boolean,
  comentarios int
)
language sql
stable
security definer
set search_path = public, privado
as $$
  with visiveis as (
    select i.id, i.user_id, i.serie_id, i.titulo, i.numero_volume, i.tipo, i.capa_url, i.nota, i.critica,
           i.critica_privada, i.critica_spoiler, i.lido_em, i.lido_marcado_em,
           p.apelido, p.nome_exibicao, p.avatar_url, p.escopo_amigos,
           (i.lido_marcado_em at time zone 'America/Sao_Paulo')::date as dia
      from itens i
      join perfis p on p.user_id = i.user_id
     where auth.uid() is not null
       and p.feed_ativo
       and i.estado = 'lido'
       and i.variante_de is null
       and i.lido_marcado_em is not null
       and i.lido_marcado_em > now() - interval '90 days'
       and not i.feed_oculto
       and (i.user_id = auth.uid() or privado.sao_amigos(auth.uid(), i.user_id))
  ),
  grupos as (
    select v.*,
           count(*) over w as qtd,
           row_number() over (w order by v.lido_marcado_em desc, v.id) as rn,
           max(v.lido_marcado_em) over w as marcado_em
      from visiveis v
    window w as (partition by v.user_id, coalesce(v.serie_id::text, v.id::text), v.dia)
  )
  select g.id,
         g.user_id,
         g.apelido,
         g.nome_exibicao,
         g.avatar_url,
         g.user_id = auth.uid(),
         s.nome,
         g.titulo,
         g.numero_volume,
         g.tipo,
         case when g.capa_url like 'pub/%' then g.capa_url else regexp_replace(g.capa_url, '^.*/', '') end,
         case when 'notas_criticas' = any (g.escopo_amigos) then g.nota end,
         case when 'notas_criticas' = any (g.escopo_amigos) and not g.critica_privada then g.critica end,
         ('notas_criticas' = any (g.escopo_amigos) and not g.critica_privada and g.critica is not null and g.critica_spoiler),
         g.lido_em,
         g.marcado_em,
         g.qtd::int,
         (select count(*)::int from feed_curtidas c
           where c.item_id = g.id and privado.feed_autor_visivel(auth.uid(), g.user_id, c.user_id)),
         exists (select 1 from feed_curtidas c where c.item_id = g.id and c.user_id = auth.uid()),
         (select count(*)::int from feed_comentarios m
           where m.item_id = g.id and privado.feed_autor_visivel(auth.uid(), g.user_id, m.user_id))
    from grupos g
    left join series s on s.id = g.serie_id
   where g.rn = 1
     and (p_antes is null or g.marcado_em < p_antes)
   order by g.marcado_em desc, g.id
   limit least(greatest(coalesce(p_limite, 30), 1), 100)
$$;

-- ---------------------------------------------------------------------------------------------
-- Vitrine (link público e amigos): `critica_spoiler` entra no fim do tipo `vitrine_item` (depois de `total`),
-- só verdadeiro quando a crítica também é devolvida. `link_itens` e `amigo_itens` repassam o tipo como está.
-- ---------------------------------------------------------------------------------------------
alter type vitrine_item add attribute critica_spoiler boolean;

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
    (b.estado = 'lido' and 'notas_criticas' = any (p_escopo) and not b.critica_privada and b.critica is not null and b.critica_spoiler) as critica_spoiler
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

revoke all on all functions in schema privado from public, anon, authenticated;

revoke all on function item_salvar(uuid, jsonb, uuid[]) from public, anon;
revoke all on function obra_amigos(text, text) from public, anon;
revoke all on function feed_listar(int, timestamptz) from public, anon;

grant execute on function item_salvar(uuid, jsonb, uuid[]) to authenticated;
grant execute on function obra_amigos(text, text) to authenticated;
grant execute on function feed_listar(int, timestamptz) to authenticated;

commit;
