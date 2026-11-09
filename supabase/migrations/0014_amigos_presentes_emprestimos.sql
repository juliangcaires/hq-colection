-- 0014 — amigos, lista de presentes e empréstimos (Fase 4, degraus 2 e 3)
--
-- Pré-requisito: 0013 aplicada.
--
-- Amizade só vale com o aceite dos dois lados. Quem é amigo aceito lê a coleção pelas MESMAS regras do link
-- público (camada `privado`), com o escopo próprio de amigos (`perfis.escopo_amigos`). Presentes e
-- empréstimos não têm acesso direto para ninguém além do que está descrito em cada função.

begin;

-- `convite` é um caminho fixo (/amigos/convite/<código>): não pode ser apelido de ninguém.
alter table perfis add constraint perfis_apelido_reservado check (apelido is null or apelido not in ('convite', 'comparar', 'capa'));

-- ---------------------------------------------------------------------------------------------
-- Amizades e convites
-- ---------------------------------------------------------------------------------------------
create table amizades (
  id uuid primary key default gen_random_uuid(),
  solicitante uuid not null references auth.users(id) on delete cascade,
  destinatario uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pendente' check (status in ('pendente', 'aceita')),
  criada_em timestamptz not null default now(),
  aceita_em timestamptz,
  check (solicitante <> destinatario)
);
-- Um registro por par de pessoas, não importa quem convidou.
create unique index uq_amizade_par on amizades (least(solicitante, destinatario), greatest(solicitante, destinatario));
create index idx_amizades_destinatario on amizades (destinatario);

alter table amizades enable row level security;
create policy "amizades_participantes_leem" on amizades for select to authenticated
  using (auth.uid() in (solicitante, destinatario));
revoke all on amizades from public, anon;
revoke insert, update, delete, truncate on amizades from authenticated;
grant select on amizades to authenticated;

create table convites_amizade (
  codigo text primary key check (codigo ~ '^[0-9a-f]{32,64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '7 days',
  usado_em timestamptz,
  usado_por uuid references auth.users(id) on delete set null
);
create index idx_convites_user on convites_amizade (user_id);

alter table convites_amizade enable row level security;
create policy "convites_dono_le" on convites_amizade for select to authenticated using (user_id = auth.uid());
revoke all on convites_amizade from public, anon;
revoke insert, update, delete, truncate on convites_amizade from authenticated;
grant select on convites_amizade to authenticated;

create or replace function privado.sao_amigos(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, privado
as $$
  select a is not null and b is not null and a <> b and exists (
    select 1 from amizades
     where status = 'aceita'
       and least(solicitante, destinatario) = least(a, b)
       and greatest(solicitante, destinatario) = greatest(a, b)
  )
$$;

create or replace function privado.dono_por_apelido(p_apelido text)
returns uuid
language sql
stable
security definer
set search_path = public, privado
as $$
  select user_id from perfis where lower(apelido) = lower(btrim(p_apelido))
$$;

create or replace function privado.meu_apelido()
returns text
language sql
stable
security definer
set search_path = public, privado
as $$
  select apelido from perfis where user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------------------------
-- Solicitar por apelido, responder, desfazer
-- ---------------------------------------------------------------------------------------------
create or replace function amizade_solicitar(p_apelido text)
returns uuid
language plpgsql
security definer
set search_path = public, privado
as $$
declare
  v_dono uuid;
  v_ex amizades%rowtype;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if privado.meu_apelido() is null then
    raise exception 'perfil_sem_apelido';
  end if;
  v_dono := privado.dono_por_apelido(p_apelido);
  if v_dono is null then
    raise exception 'apelido_nao_encontrado';
  end if;
  if v_dono = auth.uid() then
    raise exception 'amizade_propria';
  end if;

  select * into v_ex from amizades
   where least(solicitante, destinatario) = least(auth.uid(), v_dono)
     and greatest(solicitante, destinatario) = greatest(auth.uid(), v_dono);
  if found then
    if v_ex.status = 'aceita' then
      raise exception 'amizade_existente';
    elsif v_ex.solicitante = auth.uid() then
      raise exception 'amizade_ja_solicitada';
    end if;
    -- A outra pessoa já tinha me convidado: pedir de volta equivale a aceitar.
    update amizades set status = 'aceita', aceita_em = now() where id = v_ex.id;
    return v_ex.id;
  end if;

  insert into amizades (solicitante, destinatario) values (auth.uid(), v_dono) returning id into v_id;
  return v_id;
end;
$$;

create or replace function amizade_responder(p_amizade uuid, p_aceitar boolean)
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if p_aceitar then
    if privado.meu_apelido() is null then
      raise exception 'perfil_sem_apelido';
    end if;
    update amizades set status = 'aceita', aceita_em = now()
     where id = p_amizade and destinatario = auth.uid() and status = 'pendente';
  else
    delete from amizades where id = p_amizade and destinatario = auth.uid() and status = 'pendente';
  end if;
  if not found then
    raise exception 'amizade_nao_encontrada';
  end if;
end;
$$;

-- Qualquer lado desfaz (ou cancela o pedido que enviou). O acesso some na hora.
create or replace function amizade_desfazer(p_amizade uuid)
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  delete from amizades where id = p_amizade and auth.uid() in (solicitante, destinatario);
  if not found then
    raise exception 'amizade_nao_encontrada';
  end if;
end;
$$;

create or replace function amigos_listar()
returns table (amizade_id uuid, status text, direcao text, apelido text, nome_exibicao text)
language sql
stable
security definer
set search_path = public, privado
as $$
  select a.id, a.status,
         case when a.status = 'aceita' then 'amigo'
              when a.solicitante = auth.uid() then 'enviada'
              else 'recebida' end,
         p.apelido, p.nome_exibicao
    from amizades a
    left join perfis p on p.user_id = case when a.solicitante = auth.uid() then a.destinatario else a.solicitante end
   where auth.uid() in (a.solicitante, a.destinatario)
   order by (a.status = 'pendente') desc, lower(coalesce(p.nome_exibicao, p.apelido)), a.id
$$;

-- Convite por link: quem gera já consente; quem abre e confirma fecha o aceite dos dois lados.
create or replace function convite_gerar()
returns text
language plpgsql
security definer
set search_path = public, privado
as $$
declare
  v_codigo text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if privado.meu_apelido() is null then
    raise exception 'perfil_sem_apelido';
  end if;
  delete from convites_amizade where user_id = auth.uid();
  insert into convites_amizade (codigo, user_id) values (v_codigo, auth.uid());
  return v_codigo;
end;
$$;

create or replace function convite_inspecionar(p_codigo text)
returns jsonb
language sql
stable
security definer
set search_path = public, privado
as $$
  select jsonb_build_object('nome', coalesce(p.nome_exibicao, p.apelido), 'apelido', p.apelido)
    from convites_amizade c
    join perfis p on p.user_id = c.user_id
   where auth.uid() is not null
     and c.codigo = p_codigo
     and c.usado_em is null
     and c.expira_em > now()
     and c.user_id <> auth.uid()
$$;

create or replace function convite_aceitar(p_codigo text)
returns text
language plpgsql
security definer
set search_path = public, privado
as $$
declare
  v_c convites_amizade%rowtype;
  v_apelido text;
  v_ex amizades%rowtype;
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if privado.meu_apelido() is null then
    raise exception 'perfil_sem_apelido';
  end if;
  select * into v_c from convites_amizade where codigo = p_codigo for update;
  if not found or v_c.usado_em is not null or v_c.expira_em <= now() then
    raise exception 'convite_invalido';
  end if;
  if v_c.user_id = auth.uid() then
    raise exception 'amizade_propria';
  end if;

  select * into v_ex from amizades
   where least(solicitante, destinatario) = least(auth.uid(), v_c.user_id)
     and greatest(solicitante, destinatario) = greatest(auth.uid(), v_c.user_id);
  if found then
    if v_ex.status = 'pendente' then
      update amizades set status = 'aceita', aceita_em = now() where id = v_ex.id;
    end if;
  else
    insert into amizades (solicitante, destinatario, status, aceita_em) values (v_c.user_id, auth.uid(), 'aceita', now());
  end if;
  update convites_amizade set usado_em = now(), usado_por = auth.uid() where codigo = p_codigo;
  select apelido into v_apelido from perfis where user_id = v_c.user_id;
  return v_apelido;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Lista de presentes: o amigo reserva um desejo; o dono nunca vê. Sem acesso direto para ninguém.
-- ---------------------------------------------------------------------------------------------
create table presentes (
  item_id uuid primary key references itens(id) on delete cascade,
  dono uuid not null references auth.users(id) on delete cascade,
  amigo uuid not null references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);
create index idx_presentes_amigo on presentes (amigo);

alter table presentes enable row level security;
revoke all on presentes from public, anon, authenticated;

create or replace function presente_marcar(p_item uuid)
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
declare
  v_item itens%rowtype;
  v_atual presentes%rowtype;
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  select * into v_item from itens where id = p_item;
  if not found or v_item.estado <> 'desejo' or v_item.user_id = auth.uid()
     or not privado.sao_amigos(auth.uid(), v_item.user_id)
     or not coalesce((select 'desejos' = any (p.escopo_amigos) from perfis p where p.user_id = v_item.user_id), false) then
    raise exception 'item_nao_encontrado';
  end if;
  select * into v_atual from presentes where item_id = p_item;
  if found then
    if v_atual.amigo = auth.uid() then
      return;
    end if;
    raise exception 'presente_ja_reservado';
  end if;
  insert into presentes (item_id, dono, amigo) values (p_item, v_item.user_id, auth.uid());
end;
$$;

create or replace function presente_desmarcar(p_item uuid)
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  delete from presentes where item_id = p_item and amigo = auth.uid();
end;
$$;

-- Item deixou de ser desejo (o dono comprou): a reserva perde o sentido e some, sem avisar ninguém.
create or replace function itens_limpar_presente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from presentes where item_id = new.id;
  return new;
end;
$$;
create trigger trg_itens_limpar_presente after update of estado on itens
  for each row when (new.estado <> 'desejo') execute function itens_limpar_presente();

-- Desfazer a amizade apaga as reservas entre as duas pessoas.
create or replace function amizades_limpar_presentes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from presentes
   where (dono = old.solicitante and amigo = old.destinatario)
      or (dono = old.destinatario and amigo = old.solicitante);
  return old;
end;
$$;
create trigger trg_amizades_limpar_presentes after delete on amizades
  for each row execute function amizades_limpar_presentes();

-- ---------------------------------------------------------------------------------------------
-- v_itens agora sabe de presentes: o AMIGO vê "reservado" (e se foi ele); o link público e o dono, nunca.
-- ---------------------------------------------------------------------------------------------
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
         or (p_secao = 'lidos' and 'lidos' = any (p_escopo) and i.estado = 'lido')
         or (p_secao = 'desejos' and 'desejos' = any (p_escopo) and i.estado = 'desejo')
         or (p_secao = 'ranking' and 'ranking' = any (p_escopo) and i.estado = 'lido' and i.nota is not null)
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
    count(*) over () as total
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

-- ---------------------------------------------------------------------------------------------
-- Leitura da coleção de um amigo (mesmo formato do link). Sem amizade aceita: vazio.
-- ---------------------------------------------------------------------------------------------
create or replace function privado.escopo_de_amigo(p_apelido text, out dono uuid, out escopo text[])
language plpgsql
stable
security definer
set search_path = public, privado
as $$
begin
  dono := privado.dono_por_apelido(p_apelido);
  if dono is null or not privado.sao_amigos(auth.uid(), dono) then
    dono := null;
    return;
  end if;
  select p.escopo_amigos into escopo from perfis p where p.user_id = dono;
end;
$$;

create or replace function amigo_resumo(p_apelido text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, privado
as $$
declare
  v record;
begin
  select * into v from privado.escopo_de_amigo(p_apelido);
  if v.dono is null then
    return null;
  end if;
  return privado.v_resumo(v.dono, v.escopo);
end;
$$;

create or replace function amigo_itens(p_apelido text, p_secao text, p_serie uuid default null, p_limite int default 60, p_offset int default 0)
returns setof vitrine_item
language plpgsql
stable
security definer
set search_path = public, privado
as $$
declare
  v record;
begin
  select * into v from privado.escopo_de_amigo(p_apelido);
  if v.dono is null or p_secao not in ('colecao', 'lidos', 'desejos', 'ranking', 'serie') then
    return;
  end if;
  return query select * from privado.v_itens(v.dono, v.escopo, p_secao, p_serie, auth.uid(), p_limite, p_offset);
end;
$$;

create or replace function amigo_series(p_apelido text, p_serie uuid default null)
returns setof vitrine_serie
language plpgsql
stable
security definer
set search_path = public, privado
as $$
declare
  v record;
begin
  select * into v from privado.escopo_de_amigo(p_apelido);
  if v.dono is null then
    return;
  end if;
  return query select * from privado.v_series(v.dono, v.escopo, p_serie);
end;
$$;

create or replace function amigo_capa(p_apelido text, p_arquivo text)
returns text
language plpgsql
stable
security definer
set search_path = public, privado
as $$
declare
  v record;
begin
  select * into v from privado.escopo_de_amigo(p_apelido);
  if v.dono is null then
    return null;
  end if;
  return privado.v_capa(v.dono, v.escopo, p_arquivo);
end;
$$;

-- Escopo que os amigos aceitos enxergam (separado do escopo do link).
create or replace function amigos_escopo_atualizar(p_escopo text[])
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if not escopo_valido(p_escopo) or cardinality(p_escopo) = 0 then
    raise exception 'escopo_invalido';
  end if;
  insert into perfis (user_id, escopo_amigos) values (auth.uid(), p_escopo)
  on conflict (user_id) do update set escopo_amigos = excluded.escopo_amigos;
  -- Tirar "desejos" do escopo derruba as reservas que dependiam dele? Não: o item continua desejo e a
  -- reserva só deixa de ser visível enquanto o escopo estiver desligado.
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Empréstimos: só do dono; nunca entram em link, escopo ou vitrine.
-- ---------------------------------------------------------------------------------------------
create table emprestimos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_id uuid not null references itens(id) on delete cascade,
  para_quem text not null check (char_length(btrim(para_quem)) between 1 and 120),
  emprestado_em date not null default (now() at time zone 'America/Sao_Paulo')::date,
  devolver_ate date,
  devolvido_em date,
  observacao text check (observacao is null or char_length(observacao) <= 500),
  created_at timestamptz not null default now(),
  check (devolver_ate is null or devolver_ate >= emprestado_em),
  check (devolvido_em is null or devolvido_em >= emprestado_em)
);
-- Um item só pode estar emprestado uma vez por vez.
create unique index uq_emprestimo_aberto on emprestimos (item_id) where devolvido_em is null;
create index idx_emprestimos_user on emprestimos (user_id, devolvido_em);

alter table emprestimos enable row level security;
create policy "emprestimos_dono" on emprestimos for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from itens i where i.id = item_id and i.user_id = auth.uid()));
revoke all on emprestimos from public, anon;
grant select, insert, update, delete on emprestimos to authenticated;

create or replace function emprestimo_registrar(p_item uuid, p_para text, p_emprestado_em date, p_devolver_ate date, p_obs text)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_estado estado_item;
  v_id uuid;
begin
  select estado into v_estado from itens where id = p_item;
  if not found then
    raise exception 'item_nao_encontrado';
  end if;
  if v_estado = 'desejo' then
    raise exception 'item_nao_possuido';
  end if;
  if exists (select 1 from emprestimos where item_id = p_item and devolvido_em is null) then
    raise exception 'emprestimo_em_aberto';
  end if;
  insert into emprestimos (item_id, para_quem, emprestado_em, devolver_ate, observacao)
  values (p_item, btrim(p_para), coalesce(p_emprestado_em, (now() at time zone 'America/Sao_Paulo')::date), p_devolver_ate, nullif(btrim(p_obs), ''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function emprestimo_devolver(p_id uuid, p_data date default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update emprestimos
     set devolvido_em = greatest(coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date), emprestado_em)
   where id = p_id and devolvido_em is null;
  if not found then
    raise exception 'emprestimo_nao_encontrado';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissões: nada novo vira público; amigos exigem login.
-- ---------------------------------------------------------------------------------------------
revoke all on all functions in schema privado from public, anon, authenticated;

revoke all on function amizade_solicitar(text) from public, anon;
revoke all on function amizade_responder(uuid, boolean) from public, anon;
revoke all on function amizade_desfazer(uuid) from public, anon;
revoke all on function amigos_listar() from public, anon;
revoke all on function convite_gerar() from public, anon;
revoke all on function convite_inspecionar(text) from public, anon;
revoke all on function convite_aceitar(text) from public, anon;
revoke all on function presente_marcar(uuid) from public, anon;
revoke all on function presente_desmarcar(uuid) from public, anon;
revoke all on function amigo_resumo(text) from public, anon;
revoke all on function amigo_itens(text, text, uuid, int, int) from public, anon;
revoke all on function amigo_series(text, uuid) from public, anon;
revoke all on function amigo_capa(text, text) from public, anon;
revoke all on function amigos_escopo_atualizar(text[]) from public, anon;
revoke all on function emprestimo_registrar(uuid, text, date, date, text) from public, anon;
revoke all on function emprestimo_devolver(uuid, date) from public, anon;
revoke all on function itens_limpar_presente() from public, anon, authenticated;
revoke all on function amizades_limpar_presentes() from public, anon, authenticated;

grant execute on function amizade_solicitar(text) to authenticated;
grant execute on function amizade_responder(uuid, boolean) to authenticated;
grant execute on function amizade_desfazer(uuid) to authenticated;
grant execute on function amigos_listar() to authenticated;
grant execute on function convite_gerar() to authenticated;
grant execute on function convite_inspecionar(text) to authenticated;
grant execute on function convite_aceitar(text) to authenticated;
grant execute on function presente_marcar(uuid) to authenticated;
grant execute on function presente_desmarcar(uuid) to authenticated;
grant execute on function amigo_resumo(text) to authenticated;
grant execute on function amigo_itens(text, text, uuid, int, int) to authenticated;
grant execute on function amigo_series(text, uuid) to authenticated;
grant execute on function amigo_capa(text, text) to authenticated;
grant execute on function amigos_escopo_atualizar(text[]) to authenticated;
grant execute on function emprestimo_registrar(uuid, text, date, date, text) to authenticated;
grant execute on function emprestimo_devolver(uuid, date) to authenticated;

commit;
