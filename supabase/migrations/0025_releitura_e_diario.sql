-- 0025 — releitura e diário de leitura (R5 do estudo do Letterboxd)
--
-- Pré-requisito: 0024 aplicada.
--
-- Decisão: UMA nota/crítica por volume, com VÁRIAS leituras (cada uma com data). `leituras` guarda as datas;
-- `itens.lido_em` continua existindo e vale a leitura MAIS RECENTE, então ranking, feed, estatísticas, vitrine e
-- amigos seguem lendo a mesma coluna de antes. Quem mantém a coluna em dia é o banco (gatilhos), seja qual for o
-- caminho: formulário do item, lote, CSV, "Reli" ou edição direta de uma leitura.
--
-- Regras:
--  * a leitura mora no volume normal; variante (0017) compartilha estado/data com o principal e não tem leituras
--    próprias (vincular um item como variante apaga as dele);
--  * item que deixa de ser `lido` perde as leituras, como já perdia o `lido_em` (0010); ao voltar a ser lido, nasce
--    uma leitura nova com a data de hoje;
--  * item `lido` sem data (marcado antes da 0010) continua sem leitura: o backfill só copia datas que existem;
--  * "releu" no feed: cada leitura criada por "Reli" gera no máximo UM post (a linha da leitura é o post); a primeira
--    leitura segue sendo o post "leu" de sempre (0018), vindo de `itens`. Mesmas regras de visibilidade da 0018
--    (interruptor, amizade, nota/crítica só com `notas_criticas`, spoiler da 0024, item oculto).

begin;

-- ---------------------------------------------------------------------------------------------
-- Tabela
-- ---------------------------------------------------------------------------------------------
create table leituras (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references itens(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  lido_em date not null,
  criado_em timestamptz not null default now(),
  -- Preenchido pelo banco: verdadeiro quando o item já tinha outra leitura no momento da criação.
  releitura boolean not null default false
);

create index idx_leituras_item on leituras (item_id, lido_em desc);
create index idx_leituras_user on leituras (user_id, lido_em desc);
create index idx_leituras_feed on leituras (criado_em desc) where releitura;

alter table leituras enable row level security;
revoke all on leituras from anon;
create policy "leituras_owner" on leituras
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------------------------
-- Backfill: uma leitura por item lido que tem data (variante lida com o principal fica de fora: herda dele).
-- ---------------------------------------------------------------------------------------------
insert into leituras (item_id, user_id, lido_em, criado_em)
select i.id, i.user_id, i.lido_em, coalesce(i.lido_marcado_em, i.updated_at, now())
  from itens i
 where i.estado = 'lido'
   and i.lido_em is not null
   and (i.variante_de is null
        or not exists (select 1 from itens p where p.id = i.variante_de and p.estado <> 'desejo'));

-- ---------------------------------------------------------------------------------------------
-- Validação ao criar uma leitura: item do próprio usuário, lido, e não variante de um item que não é desejo.
-- Marca `releitura` quando já havia outra leitura do mesmo item.
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
  return new;
end;
$$;

create trigger trg_leituras_validar before insert on leituras
  for each row execute function leituras_validar();

-- ---------------------------------------------------------------------------------------------
-- leituras -> itens.lido_em: a data mais recente. Também acerta as variantes direto, porque o gatilho de
-- sincronia da 0017 não dispara em cascata (pg_trigger_depth). Só mexe em item `lido`.
-- ---------------------------------------------------------------------------------------------
create or replace function leituras_sincronizar_item()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_item uuid := coalesce(new.item_id, old.item_id);
  v_max date;
begin
  select max(l.lido_em) into v_max from leituras l where l.item_id = v_item;

  update itens set lido_em = v_max
   where id = v_item and estado = 'lido' and lido_em is distinct from v_max;

  update itens set lido_em = v_max
   where variante_de = v_item and estado <> 'desejo' and lido_em is distinct from v_max;

  return null;
end;
$$;

create trigger trg_leituras_sincronizar_item after insert or update or delete on leituras
  for each row execute function leituras_sincronizar_item();

-- ---------------------------------------------------------------------------------------------
-- itens -> leituras: quem marca como lido por qualquer caminho ganha a leitura; editar `lido_em` do item muda a
-- leitura mais recente; sair de `lido` apaga as leituras.
-- ---------------------------------------------------------------------------------------------
create or replace function itens_sincronizar_leituras()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_variante boolean;
  v_max date;
  v_ultima uuid;
begin
  v_variante := new.variante_de is not null
    and exists (select 1 from itens p where p.id = new.variante_de and p.estado <> 'desejo');

  if v_variante then
    delete from leituras where item_id = new.id;
    return null;
  end if;

  if new.estado <> 'lido' then
    if tg_op = 'UPDATE' and old.estado = 'lido' then
      delete from leituras where item_id = new.id;
    end if;
    return null;
  end if;

  if new.lido_em is null then
    return null;
  end if;

  select l.id, l.lido_em into v_ultima, v_max
    from leituras l where l.item_id = new.id
   order by l.lido_em desc, l.criado_em desc, l.id desc limit 1;

  if v_ultima is null then
    insert into leituras (item_id, user_id, lido_em) values (new.id, new.user_id, new.lido_em);
  elsif v_max is distinct from new.lido_em then
    update leituras set lido_em = new.lido_em where id = v_ultima;
  end if;
  return null;
end;
$$;

create trigger trg_itens_leituras after insert or update of estado, lido_em, variante_de on itens
  for each row execute function itens_sincronizar_leituras();

-- ---------------------------------------------------------------------------------------------
-- Feed (0018 + 0024): "releu" = leitura com `releitura`, criada nos últimos 90 dias. Mesmas regras de antes.
-- ---------------------------------------------------------------------------------------------
create or replace function privado.feed_item_visivel(p_viewer uuid, p_item uuid)
returns boolean
language sql
stable
security definer
set search_path = public, privado
as $$
  select p_viewer is not null and exists (
    select 1
      from itens i
      join perfis p on p.user_id = i.user_id
     where i.id = p_item
       and p.feed_ativo
       and i.estado = 'lido'
       and i.variante_de is null
       and not i.feed_oculto
       and (i.user_id = p_viewer or privado.sao_amigos(p_viewer, i.user_id))
       and ((i.lido_marcado_em is not null and i.lido_marcado_em > now() - interval '90 days')
            or exists (select 1 from leituras l
                        where l.item_id = i.id and l.releitura and l.criado_em > now() - interval '90 days'))
  )
$$;

-- Muda o retorno (leitura_id e releitura no fim): recria.
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
-- Permissões: nada novo vira público; tudo exige login.
-- ---------------------------------------------------------------------------------------------
revoke all on all functions in schema privado from public, anon, authenticated;

revoke all on function feed_listar(int, timestamptz) from public, anon;
grant execute on function feed_listar(int, timestamptz) to authenticated;

commit;
