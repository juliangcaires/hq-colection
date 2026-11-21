-- 0033 — notificações (sininho no app e Web Push): curtida, comentário, pedido de amizade e amizade aceita
--
-- Pré-requisito: 0032 aplicada. Só ACRESCENTA tabelas, triggers e funções: nada muda em `feed_curtir`/`feed_comentar`/
-- `amizade_*` (o app antigo continua funcionando com este banco).
--
-- Pedido do Julian (20/11/2026): avisar no celular e no app, SEM e-mail.
--  * `notificacoes`: uma linha por aviso (quem recebe, o tipo, quem fez, o item). NÃO guarda nota, crítica nem o texto do
--    comentário: só ids; o texto da tela é montado com apelido e nome da obra, na hora de listar.
--  * Criação por TRIGGER em `feed_curtidas`, `feed_comentarios` e `amizades`, para não mudar as assinaturas das funções.
--    Regras: a própria ação não notifica; curtida repetida (ou descurtir e curtir de novo) não gera outra, uma por
--    autor + item; comentário gera um por comentário; descurtir/apagar o comentário/recusar o pedido remove o aviso
--    NÃO LIDO correspondente (o já lido fica como histórico).
--  * Leitura e "marcar como lida" só pelas funções `security definer`; as tabelas não têm acesso direto.
--  * Tipo novo = um trigger novo + um texto na tela (o CHECK de `tipo` é trocado na migration que o criar).
--  * Web Push: `push_assinaturas` (um aparelho por endpoint) e `push_preferencias` (interruptores por tipo, padrão
--    ligado). O ENVIO é no servidor do app (chave de serviço); aqui só ficam os dados.

begin;

-- ---------------------------------------------------------------------------------------------
-- Notificações
-- ---------------------------------------------------------------------------------------------
create table notificacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade, -- quem recebe
  tipo text not null constraint notificacoes_tipo_check check (tipo in ('curtida', 'comentario', 'amizade_pedido', 'amizade_aceita')),
  autor_id uuid not null references auth.users(id) on delete cascade, -- quem fez
  -- Item do post (curtida/comentário); nulo nos tipos de amizade. Apagar o item apaga o aviso.
  item_id uuid references itens(id) on delete cascade,
  -- Comentário (tipo comentario) ou amizade (tipos de amizade) de origem. Sem FK de propósito: o trigger de
  -- remoção cuida dos não lidos e os lidos ficam como histórico.
  ref_id uuid,
  criado_em timestamptz not null default now(),
  lida_em timestamptz,
  -- O servidor do app marca ao enviar o push: protege contra envio em dobro (clique duplo, nova tentativa).
  push_enviado_em timestamptz,
  check (user_id <> autor_id),
  check ((tipo in ('curtida', 'comentario')) = (item_id is not null))
);
create index idx_notificacoes_user on notificacoes (user_id, criado_em desc);
create index idx_notificacoes_nao_lidas on notificacoes (user_id) where lida_em is null;
create index idx_notificacoes_ref on notificacoes (tipo, ref_id) where ref_id is not null;
-- Uma curtida por autor + item, mesmo depois de lida: curtir de novo não gera outra.
create unique index uq_notificacoes_curtida on notificacoes (user_id, autor_id, item_id) where tipo = 'curtida';
create unique index uq_notificacoes_comentario on notificacoes (ref_id) where tipo = 'comentario';

alter table notificacoes enable row level security;
revoke all on notificacoes from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Web Push: aparelhos e preferências
-- ---------------------------------------------------------------------------------------------
create table push_assinaturas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 2048),
  p256dh text not null check (char_length(p256dh) between 1 and 256),
  auth text not null check (char_length(auth) between 1 and 256),
  user_agent text check (char_length(user_agent) <= 400),
  criado_em timestamptz not null default now()
);
create index idx_push_assinaturas_user on push_assinaturas (user_id);

create table push_preferencias (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notif_push_curtidas boolean not null default true,
  notif_push_comentarios boolean not null default true,
  notif_push_amizades boolean not null default true
);

alter table push_assinaturas enable row level security;
alter table push_preferencias enable row level security;
-- Cada pessoa só enxerga (e desliga) as suas; criar/alterar passa pelas funções abaixo (validam os dados).
create policy "push_assinaturas_donas_leem" on push_assinaturas for select to authenticated using (user_id = auth.uid());
create policy "push_assinaturas_donas_apagam" on push_assinaturas for delete to authenticated using (user_id = auth.uid());
create policy "push_preferencias_donas_leem" on push_preferencias for select to authenticated using (user_id = auth.uid());
revoke all on push_assinaturas from public, anon, authenticated;
revoke all on push_preferencias from public, anon, authenticated;
grant select, delete on push_assinaturas to authenticated;
grant select on push_preferencias to authenticated;

-- O servidor do app (chave de serviço) lê as assinaturas e preferências do destinatário e marca o envio.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, update, delete on notificacoes to service_role;
    grant select, delete on push_assinaturas to service_role;
    grant select on push_preferencias to service_role;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Criação por trigger
-- ---------------------------------------------------------------------------------------------
create or replace function privado.notificar_curtida()
returns trigger
language plpgsql
security definer
set search_path = public, privado
as $$
declare
  v_dono uuid;
begin
  select user_id into v_dono from itens where id = new.item_id;
  -- Sem dono, a própria curtida ou item que o autor não podia ver: nada a avisar.
  if v_dono is null or v_dono = new.user_id then
    return new;
  end if;
  if not privado.feed_item_visivel(new.user_id, new.item_id) then
    return new;
  end if;
  insert into notificacoes (user_id, tipo, autor_id, item_id)
  values (v_dono, 'curtida', new.user_id, new.item_id)
  on conflict (user_id, autor_id, item_id) where tipo = 'curtida' do nothing;
  return new;
end;
$$;

create or replace function privado.desnotificar_curtida()
returns trigger
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  delete from notificacoes
   where tipo = 'curtida' and autor_id = old.user_id and item_id = old.item_id and lida_em is null;
  return old;
end;
$$;

create or replace function privado.notificar_comentario()
returns trigger
language plpgsql
security definer
set search_path = public, privado
as $$
declare
  v_dono uuid;
begin
  select user_id into v_dono from itens where id = new.item_id;
  if v_dono is null or v_dono = new.user_id then
    return new;
  end if;
  if not privado.feed_item_visivel(new.user_id, new.item_id) then
    return new;
  end if;
  insert into notificacoes (user_id, tipo, autor_id, item_id, ref_id)
  values (v_dono, 'comentario', new.user_id, new.item_id, new.id)
  on conflict (ref_id) where tipo = 'comentario' do nothing;
  return new;
end;
$$;

-- BEFORE: a FK de `ref_id` não existe, mas assim a remoção não depende da ordem dos triggers do apagar em cascata.
create or replace function privado.desnotificar_comentario()
returns trigger
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  delete from notificacoes where tipo = 'comentario' and ref_id = old.id and lida_em is null;
  return old;
end;
$$;

create or replace function privado.notificar_amizade_nova()
returns trigger
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  if new.status = 'pendente' then
    insert into notificacoes (user_id, tipo, autor_id, ref_id) values (new.destinatario, 'amizade_pedido', new.solicitante, new.id);
  elsif new.status = 'aceita' and auth.uid() is distinct from new.solicitante then
    -- Convite por link: a amizade já nasce aceita; quem o gerou (solicitante) fica sabendo.
    insert into notificacoes (user_id, tipo, autor_id, ref_id) values (new.solicitante, 'amizade_aceita', new.destinatario, new.id);
  end if;
  return new;
end;
$$;

create or replace function privado.notificar_amizade_aceita()
returns trigger
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  if old.status = 'pendente' and new.status = 'aceita' then
    -- O pedido foi respondido: o aviso "quer ser sua amiga" não vale mais.
    delete from notificacoes where tipo = 'amizade_pedido' and ref_id = new.id and lida_em is null;
    if auth.uid() is distinct from new.solicitante then
      insert into notificacoes (user_id, tipo, autor_id, ref_id) values (new.solicitante, 'amizade_aceita', new.destinatario, new.id);
    end if;
  end if;
  return new;
end;
$$;

-- Pedido recusado ou cancelado: some o aviso que ainda não foi lido.
create or replace function privado.desnotificar_amizade()
returns trigger
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  delete from notificacoes where tipo = 'amizade_pedido' and ref_id = old.id and lida_em is null;
  return old;
end;
$$;

create trigger trg_notificar_curtida after insert on feed_curtidas
  for each row execute function privado.notificar_curtida();
create trigger trg_desnotificar_curtida after delete on feed_curtidas
  for each row execute function privado.desnotificar_curtida();
create trigger trg_notificar_comentario after insert on feed_comentarios
  for each row execute function privado.notificar_comentario();
create trigger trg_desnotificar_comentario before delete on feed_comentarios
  for each row execute function privado.desnotificar_comentario();
create trigger trg_notificar_amizade_nova after insert on amizades
  for each row execute function privado.notificar_amizade_nova();
create trigger trg_notificar_amizade_aceita after update of status on amizades
  for each row execute function privado.notificar_amizade_aceita();
create trigger trg_desnotificar_amizade after delete on amizades
  for each row execute function privado.desnotificar_amizade();

-- ---------------------------------------------------------------------------------------------
-- Leitura (o que a pessoa de fato pode ver agora)
-- ---------------------------------------------------------------------------------------------
-- Aviso de curtida/comentário só vale enquanto o item ainda aparece no feed (feed ligado, não oculto, dentro de 90
-- dias) e o autor segue sendo amigo; os de amizade valem sempre. Listar e contar usam esta mesma regra.
create or replace function privado.notificacoes_visiveis(p_user uuid)
returns setof notificacoes
language sql
stable
security definer
set search_path = public, privado
as $$
  select n.*
    from notificacoes n
   where n.user_id = p_user
     and (
       n.tipo in ('amizade_pedido', 'amizade_aceita')
       or (privado.sao_amigos(p_user, n.autor_id) and privado.feed_item_visivel(p_user, n.item_id))
     )
$$;

create or replace function notificacoes_listar(p_limite int default 50, p_antes timestamptz default null)
returns table (
  id uuid,
  tipo text,
  autor_apelido text,
  autor_nome text,
  item_id uuid,
  serie_nome text,
  titulo text,
  numero_volume numeric,
  criado_em timestamptz,
  lida boolean
)
language sql
stable
security definer
set search_path = public, privado
as $$
  select n.id,
         n.tipo,
         p.apelido,
         p.nome_exibicao,
         n.item_id,
         s.nome,
         i.titulo,
         i.numero_volume,
         n.criado_em,
         n.lida_em is not null
    from privado.notificacoes_visiveis(auth.uid()) n
    left join perfis p on p.user_id = n.autor_id
    left join itens i on i.id = n.item_id
    left join series s on s.id = i.serie_id
   where auth.uid() is not null
     and (p_antes is null or n.criado_em < p_antes)
   order by n.criado_em desc, n.id
   limit least(greatest(coalesce(p_limite, 50), 1), 100)
$$;

create or replace function notificacoes_contar_nao_lidas()
returns int
language sql
stable
security definer
set search_path = public, privado
as $$
  select count(*)::int
    from privado.notificacoes_visiveis(auth.uid()) n
   where auth.uid() is not null and n.lida_em is null
$$;

-- Marca as ids dadas (só as da própria pessoa) ou, sem ids, todas. De quebra apaga as já lidas há mais de 90 dias.
create or replace function notificacoes_marcar_lidas(p_ids uuid[] default null)
returns int
language plpgsql
security definer
set search_path = public, privado
as $$
declare
  v_n int;
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  delete from notificacoes where user_id = auth.uid() and lida_em < now() - interval '90 days';
  update notificacoes set lida_em = now()
   where user_id = auth.uid() and lida_em is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Web Push: aparelho e preferências da própria pessoa
-- ---------------------------------------------------------------------------------------------
-- Um aparelho = um endpoint. Se o mesmo aparelho entrar com outra conta, a assinatura passa para ela.
create or replace function push_assinar(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 2048
     or coalesce(char_length(p_p256dh), 0) not between 1 and 256 or coalesce(char_length(p_auth), 0) not between 1 and 256 then
    raise exception 'push_assinatura_invalida';
  end if;
  insert into push_assinaturas (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 400))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
  insert into push_preferencias (user_id) values (auth.uid()) on conflict do nothing;
end;
$$;

create or replace function push_desassinar(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  delete from push_assinaturas where user_id = auth.uid() and endpoint = p_endpoint;
end;
$$;

create or replace function push_preferencias_definir(p_curtidas boolean, p_comentarios boolean, p_amizades boolean)
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if p_curtidas is null or p_comentarios is null or p_amizades is null then
    raise exception 'valor_invalido';
  end if;
  insert into push_preferencias (user_id, notif_push_curtidas, notif_push_comentarios, notif_push_amizades)
  values (auth.uid(), p_curtidas, p_comentarios, p_amizades)
  on conflict (user_id) do update
    set notif_push_curtidas = excluded.notif_push_curtidas,
        notif_push_comentarios = excluded.notif_push_comentarios,
        notif_push_amizades = excluded.notif_push_amizades;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissões: nada vira público; tudo exige login.
-- ---------------------------------------------------------------------------------------------
revoke all on all functions in schema privado from public, anon, authenticated;

revoke all on function notificacoes_listar(int, timestamptz) from public, anon;
revoke all on function notificacoes_contar_nao_lidas() from public, anon;
revoke all on function notificacoes_marcar_lidas(uuid[]) from public, anon;
revoke all on function push_assinar(text, text, text, text) from public, anon;
revoke all on function push_desassinar(text) from public, anon;
revoke all on function push_preferencias_definir(boolean, boolean, boolean) from public, anon;

grant execute on function notificacoes_listar(int, timestamptz) to authenticated;
grant execute on function notificacoes_contar_nao_lidas() to authenticated;
grant execute on function notificacoes_marcar_lidas(uuid[]) to authenticated;
grant execute on function push_assinar(text, text, text, text) to authenticated;
grant execute on function push_desassinar(text) to authenticated;
grant execute on function push_preferencias_definir(boolean, boolean, boolean) to authenticated;

commit;
