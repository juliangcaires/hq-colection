-- 0018 — feed de amigos (D6 do estudo ESTUDO-OBRA-ENTRE-USUARIOS)
--
-- Pré-requisito: 0017 aplicada.
--
-- O feed é uma PROJEÇÃO de `itens`, sem tabela de eventos: cada "leu X" é um item `lido` de quem tem o
-- interruptor ligado (`perfis.feed_ativo`). Título, capa, nota e crítica são lidos ao vivo, então editar a
-- nota ou marcar a crítica como privada muda o feed junto. Visível só para o dono e amigos aceitos
-- (`privado.sao_amigos`, 0014): desfazer a amizade corta o acesso na hora.
-- Curtidas e comentários têm o ITEM como alvo; as tabelas não têm acesso direto (padrão do repo): tudo por RPC.

begin;

-- ---------------------------------------------------------------------------------------------
-- Interruptor geral e instante exato da marcação
-- ---------------------------------------------------------------------------------------------
-- Conservador: nada é compartilhado até a pessoa ligar.
alter table perfis add column feed_ativo boolean not null default false;

-- Instante em que o item virou `lido` (`lido_em` é só data e editável). Itens lidos antes desta migration
-- ficam com null e NÃO entram no feed: ele não nasce despejando a estante inteira.
alter table itens add column lido_marcado_em timestamptz;
-- O dono tira um item do feed sem mexer em nota nem crítica.
alter table itens add column feed_oculto boolean not null default false;

create index idx_itens_feed on itens (user_id, lido_marcado_em desc) where estado = 'lido';

-- Mesmo gatilho do `lido_em` (0010): preenchido quando o item vira `lido`, limpo quando deixa de ser.
create or replace function itens_definir_lido_em()
returns trigger
language plpgsql
as $$
begin
  if new.estado = 'lido' then
    if tg_op = 'INSERT' or old.estado is distinct from 'lido' then
      new.lido_em := coalesce(new.lido_em, (now() at time zone 'America/Sao_Paulo')::date);
      new.lido_marcado_em := now();
    end if;
  else
    new.lido_em := null;
    new.lido_marcado_em := null;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Curtidas e comentários (alvo = o item)
-- ---------------------------------------------------------------------------------------------
create table feed_curtidas (
  item_id uuid not null references itens(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  criada_em timestamptz not null default now(),
  primary key (item_id, user_id)
);

create table feed_comentarios (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references itens(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  texto text not null check (char_length(texto) between 1 and 500),
  criado_em timestamptz not null default now()
);
create index idx_feed_comentarios_item on feed_comentarios (item_id, criado_em);

alter table feed_curtidas enable row level security;
alter table feed_comentarios enable row level security;
revoke all on feed_curtidas from public, anon, authenticated;
revoke all on feed_comentarios from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Regras de visibilidade (uma só, usada por todas as funções do feed)
-- ---------------------------------------------------------------------------------------------

-- O item aparece no feed para este visitante? Dono (com o interruptor ligado) ou amigo aceito dele; item lido,
-- não é variante (o principal basta), não oculto, marcado nos últimos 90 dias.
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
       and i.lido_marcado_em is not null
       and i.lido_marcado_em > now() - interval '90 days'
       and not i.feed_oculto
       and (i.user_id = p_viewer or privado.sao_amigos(p_viewer, i.user_id))
  )
$$;

-- Curtida/comentário de `p_autor` no item de `p_dono` aparece para `p_viewer`? Só o dono do item, o próprio
-- visitante e as pessoas que são AMIGAS DO VISITANTE: o amigo A nunca descobre o amigo B só pelo comentário.
create or replace function privado.feed_autor_visivel(p_viewer uuid, p_dono uuid, p_autor uuid)
returns boolean
language sql
stable
security definer
set search_path = public, privado
as $$
  select p_autor = p_dono or p_autor = p_viewer or privado.sao_amigos(p_viewer, p_autor)
$$;

-- ---------------------------------------------------------------------------------------------
-- Interruptor geral (Configurações)
-- ---------------------------------------------------------------------------------------------
-- Ligar também libera nota e crítica para os amigos (`notas_criticas` é a porta única delas, 0014): o texto
-- da tela diz isso. Desligar NÃO tira `notas_criticas` do escopo (a pessoa pode tê-lo ligado por outro caminho);
-- o feed some na hora porque a visibilidade lê `feed_ativo` ao vivo.
create or replace function feed_configurar(p_ativo boolean)
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if p_ativo is null then
    raise exception 'valor_invalido';
  end if;
  insert into perfis (user_id, feed_ativo) values (auth.uid(), p_ativo)
  on conflict (user_id) do update set feed_ativo = excluded.feed_ativo;
  if p_ativo then
    update perfis set escopo_amigos = array_append(escopo_amigos, 'notas_criticas')
     where user_id = auth.uid() and not ('notas_criticas' = any (escopo_amigos));
  end if;
end;
$$;

-- Dono tira (ou devolve) um item do feed.
create or replace function feed_ocultar(p_item uuid, p_oculto boolean)
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  update itens set feed_oculto = coalesce(p_oculto, true) where id = p_item and user_id = auth.uid();
  if not found then
    raise exception 'item_nao_encontrado';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Leitura do feed. Lote (série inteira, CSV, volumes em lote) vira UM post por pessoa + série + dia.
-- Nota/crítica seguem a regra de `v_itens`: nota só com `notas_criticas` no escopo de amigos; crítica
-- também não sendo privada. Em post de vários volumes, o cartão mostra o mais recente.
-- Paginação por `p_antes` (o `marcado_em` do último post recebido).
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
           i.critica_privada, i.lido_em, i.lido_marcado_em,
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

-- Arquivo da capa privada de um item do feed (`<dono>/<arquivo>`); null se o item não está visível.
create or replace function feed_capa(p_item uuid)
returns text
language sql
stable
security definer
set search_path = public, privado
as $$
  select i.capa_url
    from itens i
   where i.id = p_item
     and i.capa_url is not null
     and i.capa_url not like 'pub/%'
     and privado.feed_item_visivel(auth.uid(), i.id)
$$;

-- ---------------------------------------------------------------------------------------------
-- Curtir e comentar: dono do item ou amigo aceito dele, e só em item visível no feed.
-- ---------------------------------------------------------------------------------------------
create or replace function feed_curtir(p_item uuid)
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if not privado.feed_item_visivel(auth.uid(), p_item) then
    raise exception 'item_nao_encontrado';
  end if;
  insert into feed_curtidas (item_id, user_id) values (p_item, auth.uid()) on conflict do nothing;
end;
$$;

create or replace function feed_descurtir(p_item uuid)
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  delete from feed_curtidas where item_id = p_item and user_id = auth.uid();
end;
$$;

create or replace function feed_comentar(p_item uuid, p_texto text)
returns uuid
language plpgsql
security definer
set search_path = public, privado
as $$
declare
  v_texto text := btrim(coalesce(p_texto, ''));
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if char_length(v_texto) = 0 then
    raise exception 'comentario_vazio';
  end if;
  if char_length(v_texto) > 500 then
    raise exception 'comentario_longo';
  end if;
  if not privado.feed_item_visivel(auth.uid(), p_item) then
    raise exception 'item_nao_encontrado';
  end if;
  insert into feed_comentarios (item_id, user_id, texto) values (p_item, auth.uid(), v_texto) returning id into v_id;
  return v_id;
end;
$$;

-- Apaga o autor ou o dono do item.
create or replace function feed_apagar_comentario(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  delete from feed_comentarios m
   where m.id = p_id
     and (m.user_id = auth.uid() or exists (select 1 from itens i where i.id = m.item_id and i.user_id = auth.uid()));
  if not found then
    raise exception 'comentario_nao_encontrado';
  end if;
end;
$$;

-- Comentários de um item visível, só de quem o visitante pode ver (dono do item, ele mesmo, amigos dele).
create or replace function feed_comentarios_listar(p_item uuid)
returns table (
  id uuid,
  apelido text,
  nome_exibicao text,
  avatar_url text,
  texto text,
  criado_em timestamptz,
  meu boolean,
  pode_apagar boolean
)
language sql
stable
security definer
set search_path = public, privado
as $$
  select m.id,
         p.apelido,
         p.nome_exibicao,
         p.avatar_url,
         m.texto,
         m.criado_em,
         m.user_id = auth.uid(),
         m.user_id = auth.uid() or i.user_id = auth.uid()
    from feed_comentarios m
    join itens i on i.id = m.item_id
    left join perfis p on p.user_id = m.user_id
   where m.item_id = p_item
     and privado.feed_item_visivel(auth.uid(), p_item)
     and privado.feed_autor_visivel(auth.uid(), i.user_id, m.user_id)
   order by m.criado_em, m.id
   limit 200
$$;

-- ---------------------------------------------------------------------------------------------
-- Card semanal (só no app): últimos 7 dias, calculado ao abrir. Sem e-mail, sem push.
--  meus_lidos          volumes lidos por você (data de leitura nos últimos 7 dias; variante não conta em dobro)
--  amigos / lidos_amigos  quantos amigos leram algo visível no feed e quantos volumes
--  destaque            leitura de amigo mais bem avaliada (só nota visível pelo escopo)
-- ---------------------------------------------------------------------------------------------
create or replace function feed_resumo_semana()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, privado
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_meus int;
  v_amigos int;
  v_lidos_amigos int;
  v_destaque jsonb;
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;

  select count(*) into v_meus
    from itens i
   where i.user_id = auth.uid() and i.estado = 'lido' and i.variante_de is null
     and i.lido_em is not null and i.lido_em >= v_hoje - 6 and i.lido_em <= v_hoje;

  select count(distinct i.user_id), count(*) into v_amigos, v_lidos_amigos
    from itens i
    join perfis p on p.user_id = i.user_id
   where i.user_id <> auth.uid()
     and privado.sao_amigos(auth.uid(), i.user_id)
     and p.feed_ativo and i.estado = 'lido' and i.variante_de is null and not i.feed_oculto
     and i.lido_marcado_em is not null and i.lido_marcado_em > now() - interval '7 days';

  select jsonb_build_object('titulo', x.titulo, 'numero_volume', x.numero_volume, 'serie', x.serie_nome,
                            'apelido', x.apelido, 'nota', x.nota)
    into v_destaque
    from (
      select i.titulo, i.numero_volume, s.nome as serie_nome, p.apelido, i.nota
        from itens i
        join perfis p on p.user_id = i.user_id
        left join series s on s.id = i.serie_id
       where i.user_id <> auth.uid()
         and privado.sao_amigos(auth.uid(), i.user_id)
         and p.feed_ativo and 'notas_criticas' = any (p.escopo_amigos)
         and i.estado = 'lido' and i.variante_de is null and not i.feed_oculto and i.nota is not null
         and i.lido_marcado_em is not null and i.lido_marcado_em > now() - interval '7 days'
       order by i.nota desc, i.lido_marcado_em desc, i.id
       limit 1
    ) x;

  return jsonb_build_object('meus_lidos', v_meus, 'amigos', v_amigos, 'lidos_amigos', v_lidos_amigos, 'destaque', v_destaque);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissões: nada novo vira público; tudo exige login.
-- ---------------------------------------------------------------------------------------------
revoke all on all functions in schema privado from public, anon, authenticated;

revoke all on function feed_configurar(boolean) from public, anon;
revoke all on function feed_ocultar(uuid, boolean) from public, anon;
revoke all on function feed_listar(int, timestamptz) from public, anon;
revoke all on function feed_capa(uuid) from public, anon;
revoke all on function feed_curtir(uuid) from public, anon;
revoke all on function feed_descurtir(uuid) from public, anon;
revoke all on function feed_comentar(uuid, text) from public, anon;
revoke all on function feed_apagar_comentario(uuid) from public, anon;
revoke all on function feed_comentarios_listar(uuid) from public, anon;
revoke all on function feed_resumo_semana() from public, anon;

grant execute on function feed_configurar(boolean) to authenticated;
grant execute on function feed_ocultar(uuid, boolean) to authenticated;
grant execute on function feed_listar(int, timestamptz) to authenticated;
grant execute on function feed_capa(uuid) to authenticated;
grant execute on function feed_curtir(uuid) to authenticated;
grant execute on function feed_descurtir(uuid) to authenticated;
grant execute on function feed_comentar(uuid, text) to authenticated;
grant execute on function feed_apagar_comentario(uuid) to authenticated;
grant execute on function feed_comentarios_listar(uuid) to authenticated;
grant execute on function feed_resumo_semana() to authenticated;

commit;
