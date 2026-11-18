-- 0029 — leituras: blindar o UPDATE e o `criado_em` (achado da revisão de 18/11/2026 sobre a 0025)
--
-- Pré-requisito: 0028 aplicada (vale também se aplicada logo depois da 0025).
--
-- Problema: a policy `leituras_owner` (0025) é `for all` e o gatilho `trg_leituras_validar` só roda no INSERT.
-- Quem estava logado podia dar `update leituras set item_id = <item de um amigo>, releitura = true,
-- criado_em = <data futura>` numa leitura própria; o `feed_listar` monta o post "releu" pelo dono do ITEM, então
-- os amigos do dono viam "Fulano releu X", e com data futura o post ficava no topo. O INSERT também aceitava
-- `criado_em` vindo do cliente.
--
-- Correção, em camadas:
--  * privilégio: o app só atualiza `lido_em` (editar a data da leitura); o resto da linha é do banco;
--  * gatilho BEFORE UPDATE: recusa mudança em id, item_id, user_id, releitura e criado_em, mesmo para quem tiver
--    privilégio (ex.: um papel com `grant all` ou uma policy futura);
--  * INSERT: `criado_em` é sempre `now()` (o valor do cliente é ignorado);
--  * `feed_listar`: o post "releu" exige que a leitura seja do dono do item (`l.user_id = i.user_id`).
-- Nada muda no comportamento já existente: editar `lido_em` continua reescrevendo `itens.lido_em` para a maior data.

begin;

-- ---------------------------------------------------------------------------------------------
-- Privilégio: só `lido_em` é atualizável por quem está logado.
-- ---------------------------------------------------------------------------------------------
revoke update on leituras from authenticated;
grant update (lido_em) on leituras to authenticated;

-- ---------------------------------------------------------------------------------------------
-- INSERT: mesma validação da 0025, e `criado_em` passa a ser sempre o instante do banco.
-- ---------------------------------------------------------------------------------------------
create or replace function leituras_validar()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  i itens%rowtype;
begin
  select * into i from itens where id = new.item_id;
  if not found or i.user_id is distinct from new.user_id then
    raise exception 'item_nao_encontrado';
  end if;
  if i.estado <> 'lido' then
    raise exception 'item_nao_lido';
  end if;
  if i.variante_de is not null
     and exists (select 1 from itens p where p.id = i.variante_de and p.estado <> 'desejo') then
    raise exception 'leitura_em_variante';
  end if;
  new.releitura := exists (select 1 from leituras l where l.item_id = new.item_id);
  new.criado_em := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- UPDATE: só `lido_em` pode mudar.
-- ---------------------------------------------------------------------------------------------
create or replace function leituras_imutaveis()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id
     or new.item_id is distinct from old.item_id
     or new.user_id is distinct from old.user_id
     or new.releitura is distinct from old.releitura
     or new.criado_em is distinct from old.criado_em then
    raise exception 'leitura_imutavel';
  end if;
  return new;
end;
$$;

create trigger trg_leituras_imutaveis before update on leituras
  for each row execute function leituras_imutaveis();

-- ---------------------------------------------------------------------------------------------
-- Feed: igual à 0025, com `l.user_id = i.user_id` no trecho de releitura.
-- ---------------------------------------------------------------------------------------------
create or replace function feed_listar(p_limite int default 30, p_antes timestamptz default null)
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
  comentarios int,
  releitura boolean,
  leitura_id uuid
)
language sql
stable
security definer
set search_path = public, privado
as $$
  with visiveis as (
    -- Primeira leitura: o item marcado como lido (0018). Lote vira um post por pessoa + série + dia.
    select i.id, i.user_id, i.serie_id, i.titulo, i.numero_volume, i.tipo, i.capa_url, i.nota, i.critica,
           i.critica_privada, i.critica_spoiler, i.lido_em, i.lido_marcado_em as ordem,
           p.apelido, p.nome_exibicao, p.avatar_url, p.escopo_amigos,
           (i.lido_marcado_em at time zone 'America/Sao_Paulo')::date as dia,
           coalesce(i.serie_id::text, i.id::text) as grupo,
           false as releitura, null::uuid as leitura_id
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
    union all
    -- Releitura: um post por leitura (a data do post é o instante em que a leitura foi registrada).
    select i.id, i.user_id, i.serie_id, i.titulo, i.numero_volume, i.tipo, i.capa_url, i.nota, i.critica,
           i.critica_privada, i.critica_spoiler, l.lido_em, l.criado_em as ordem,
           p.apelido, p.nome_exibicao, p.avatar_url, p.escopo_amigos,
           (l.criado_em at time zone 'America/Sao_Paulo')::date as dia,
           'r' || l.id::text as grupo,
           true as releitura, l.id as leitura_id
      from leituras l
      join itens i on i.id = l.item_id
      join perfis p on p.user_id = i.user_id
     where auth.uid() is not null
       and l.releitura
       and l.user_id = i.user_id
       and l.criado_em > now() - interval '90 days'
       and p.feed_ativo
       and i.estado = 'lido'
       and i.variante_de is null
       and not i.feed_oculto
       and (i.user_id = auth.uid() or privado.sao_amigos(auth.uid(), i.user_id))
  ),
  grupos as (
    select v.*,
           count(*) over w as qtd,
           row_number() over (w order by v.ordem desc, v.id) as rn,
           max(v.ordem) over w as marcado_em
      from visiveis v
    window w as (partition by v.user_id, v.grupo, v.dia)
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
           where m.item_id = g.id and privado.feed_autor_visivel(auth.uid(), g.user_id, m.user_id)),
         g.releitura,
         g.leitura_id
    from grupos g
    left join series s on s.id = g.serie_id
   where g.rn = 1
     and (p_antes is null or g.marcado_em < p_antes)
   order by g.marcado_em desc, g.id
   limit least(greatest(coalesce(p_limite, 30), 1), 100)
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissões: as mesmas da 0025.
-- ---------------------------------------------------------------------------------------------
revoke all on all functions in schema privado from public, anon, authenticated;

revoke all on function leituras_imutaveis() from public, anon;
revoke all on function feed_listar(int, timestamptz) from public, anon;
grant execute on function feed_listar(int, timestamptz) to authenticated;

commit;
