-- 0012 — capas compartilhadas entre usuários (Fase 3)
--
-- Pré-requisito: 0011 aplicada.
--
-- Nada novo é legível ou gravável direto pelo cliente, exceto `perfis` (dono) e as linhas do próprio
-- usuário em `capas_denuncias`. O catálogo de capas é lido e escrito só por funções `security definer`
-- que devolvem campos explícitos (sem expor quem contribuiu). O bucket `capas` continua privado; o novo
-- `capas-publicas` é público para leitura e só aceita upload com nome `<sha256>.<jpg|png|webp>`.

begin;

-- ---------------------------------------------------------------------------------------------
-- Perfil do usuário (a Fase 4 acrescenta apelido/nome/avatar no compartilhamento)
-- ---------------------------------------------------------------------------------------------
create table perfis (
  user_id uuid primary key references auth.users(id) on delete cascade,
  apelido text check (apelido is null or apelido ~ '^[a-z0-9_]{3,30}$'),
  nome_exibicao text check (nome_exibicao is null or char_length(nome_exibicao) between 1 and 80),
  avatar_url text check (avatar_url is null or (avatar_url ~ '^https://' and char_length(avatar_url) <= 500)),
  -- Opt-in: fotos de capa enviadas pelo usuário só entram no catálogo público se isto for true.
  contribuir_capas boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_perfis_apelido on perfis (lower(apelido)) where apelido is not null;

create trigger trg_perfis_updated_at before update on perfis
  for each row execute function set_updated_at();

alter table perfis enable row level security;
create policy "perfis_dono" on perfis for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on perfis from public, anon;
grant select, insert, update on perfis to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Catálogo de capas
-- ---------------------------------------------------------------------------------------------
create table capas_catalogo (
  id uuid primary key default gen_random_uuid(),
  edicao_id uuid references edicoes(id) on delete set null,
  isbn13 text check (isbn13 is null or isbn13_valido(isbn13)),
  -- série + número + tipo + editora normalizados (src/lib/texto.ts), igual a edicoes.chave_normalizada
  chave_normalizada text not null check (char_length(chave_normalizada) between 1 and 400),
  -- só série + tipo: serve para sugerir "o nome bate" (nunca aplicada sozinha)
  serie_chave text check (serie_chave is null or char_length(serie_chave) <= 400),
  caminho text not null check (caminho ~ '^[0-9a-f]{64}\.(jpg|png|webp)$'),
  hash_sha256 text not null check (hash_sha256 ~ '^[0-9a-f]{64}$' and left(caminho, 64) = hash_sha256),
  origem text not null check (origem in ('api', 'foto')),
  contribuido_por uuid references auth.users(id) on delete set null,
  -- 3 denúncias de pessoas diferentes escondem a capa das sugestões até alguém revisar
  oculta boolean not null default false,
  created_at timestamptz not null default now(),
  unique (hash_sha256, chave_normalizada)
);
create index idx_capas_catalogo_isbn on capas_catalogo (isbn13) where isbn13 is not null;
create index idx_capas_catalogo_chave on capas_catalogo (chave_normalizada);
create index idx_capas_catalogo_serie on capas_catalogo (serie_chave) where serie_chave is not null;

create table capas_denuncias (
  capa_id uuid not null references capas_catalogo(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (capa_id, user_id)
);

-- RLS ligada e SEM policy: o cliente não lê nem escreve; só as funções abaixo.
alter table capas_catalogo enable row level security;
alter table capas_denuncias enable row level security;
revoke all on capas_catalogo, capas_denuncias from public, anon, authenticated;

alter table itens add column if not exists capa_catalogo_id uuid references capas_catalogo(id) on delete set null;
create index if not exists idx_itens_capa_catalogo on itens (capa_catalogo_id) where capa_catalogo_id is not null;

-- ---------------------------------------------------------------------------------------------
-- Memória de busca da série, versão global (por série normalizada + tipo)
-- ---------------------------------------------------------------------------------------------
create table series_busca_global (
  serie_chave text primary key check (char_length(serie_chave) between 1 and 400),
  termo text check (termo is null or char_length(termo) <= 200),
  provedor text not null check (provedor in ('google_books', 'open_library', 'anilist', 'mangadex')),
  ref text check (ref is null or ref ~ '^[A-Za-z0-9-]{1,64}$'),
  confirmacoes int not null default 1,
  atualizado_em timestamptz not null default now()
);
alter table series_busca_global enable row level security;
create policy "series_busca_global_leitura" on series_busca_global for select to authenticated using (true);
revoke all on series_busca_global from public, anon;
revoke insert, update, delete, truncate on series_busca_global from authenticated;
grant select on series_busca_global to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Storage: bucket público só para as capas do catálogo
-- ---------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('capas-publicas', 'capas-publicas', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Quem está logado pode enviar, mas só com o nome-hash; não há update nem delete (arquivo é imutável).
create policy "capas_publicas_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'capas-publicas' and name ~ '^[0-9a-f]{64}\.(jpg|png|webp)$');

-- ---------------------------------------------------------------------------------------------
-- capa_catalogo_registrar: registra (ou reaproveita, pelo hash) a capa de uma edição e, se vier
-- `p_item`, já a aplica ao item do usuário. Foto só entra com opt-in em `perfis.contribuir_capas`.
-- ---------------------------------------------------------------------------------------------
create or replace function capa_catalogo_registrar(
  p_isbn13 text,
  p_chave text,
  p_serie_chave text,
  p_caminho text,
  p_hash text,
  p_origem text,
  p_item uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_isbn text := nullif(btrim(p_isbn13), '');
  v_edicao uuid;
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if p_origem is null or p_origem not in ('api', 'foto') then
    raise exception 'capa_invalida';
  end if;
  if p_origem = 'foto' and not coalesce((select contribuir_capas from perfis where user_id = auth.uid()), false) then
    raise exception 'contribuicao_nao_autorizada';
  end if;
  if v_isbn is not null and not isbn13_valido(v_isbn) then
    raise exception 'isbn_invalido';
  end if;
  if p_item is not null and not exists (select 1 from itens where id = p_item and user_id = auth.uid()) then
    raise exception 'item_nao_encontrado';
  end if;
  if nullif(btrim(p_chave), '') is null then
    raise exception 'capa_invalida';
  end if;

  if v_isbn is not null then
    select id into v_edicao from edicoes where isbn13 = v_isbn;
  end if;

  insert into capas_catalogo (edicao_id, isbn13, chave_normalizada, serie_chave, caminho, hash_sha256, origem, contribuido_por)
  values (v_edicao, v_isbn, left(btrim(p_chave), 400), left(nullif(btrim(p_serie_chave), ''), 400), p_caminho, p_hash, p_origem, auth.uid())
  on conflict (hash_sha256, chave_normalizada) do update set
    isbn13 = coalesce(capas_catalogo.isbn13, excluded.isbn13),
    edicao_id = coalesce(capas_catalogo.edicao_id, excluded.edicao_id),
    serie_chave = coalesce(capas_catalogo.serie_chave, excluded.serie_chave)
  returning id into v_id;

  if p_item is not null then
    update itens set capa_url = 'pub/' || p_caminho, capa_catalogo_id = v_id, capa_origem = p_origem::origem_capa
     where id = p_item and user_id = auth.uid();
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- capa_catalogo_aplicar: o usuário escolheu uma capa da comunidade para um item dele.
-- ---------------------------------------------------------------------------------------------
create or replace function capa_catalogo_aplicar(p_item uuid, p_capa uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c capas_catalogo%rowtype;
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if not exists (select 1 from itens where id = p_item and user_id = auth.uid()) then
    raise exception 'item_nao_encontrado';
  end if;
  select * into v_c from capas_catalogo where id = p_capa and not oculta;
  if not found then
    raise exception 'capa_indisponivel';
  end if;
  update itens set capa_url = 'pub/' || v_c.caminho, capa_catalogo_id = v_c.id, capa_origem = v_c.origem::origem_capa
   where id = p_item and user_id = auth.uid();
  return v_c.caminho;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- capas_comunidade_buscar: capas do catálogo para um item, da mais para a menos específica.
--   nivel 'isbn'  → mesma edição pelo ISBN
--   nivel 'chave' → mesma série + número + tipo + editora
--   nivel 'nome'  → só a série bate (sugestão, nunca aplicada sozinha)
-- `usos` = pessoas diferentes que usam a capa hoje (conta ao vivo, então apagar item reduz).
-- Capas ocultas (3 denúncias) não saem. Não devolve quem contribuiu.
-- ---------------------------------------------------------------------------------------------
create or replace function capas_comunidade_buscar(p_isbn13 text, p_chave text, p_serie_chave text)
returns table (id uuid, caminho text, origem text, nivel text, usos int)
language sql
stable
security definer
set search_path = public
as $$
  with achadas as (
    select c.id, c.caminho, c.origem, c.created_at,
           case
             when p_isbn13 is not null and c.isbn13 = p_isbn13 then 1
             when p_chave is not null and c.chave_normalizada = p_chave then 2
             else 3
           end as rank
      from capas_catalogo c
     where not c.oculta
       and auth.uid() is not null
       and (
         (p_isbn13 is not null and c.isbn13 = p_isbn13)
         or (p_chave is not null and c.chave_normalizada = p_chave)
         or (p_serie_chave is not null and c.serie_chave = p_serie_chave)
       )
  )
  select a.id, a.caminho, a.origem,
         case a.rank when 1 then 'isbn' when 2 then 'chave' else 'nome' end as nivel,
         (select count(distinct i.user_id)::int from itens i where i.capa_catalogo_id = a.id) as usos
    from achadas a
   order by a.rank, 5 desc, a.created_at
   limit 12
$$;

-- ---------------------------------------------------------------------------------------------
-- capa_denunciar: uma denúncia por pessoa; na terceira a capa sai das sugestões até revisão
-- (revisar = apagar as linhas de capas_denuncias da capa e pôr oculta = false, direto no Supabase).
-- ---------------------------------------------------------------------------------------------
create or replace function capa_denunciar(p_capa uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total int;
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if not exists (select 1 from capas_catalogo where id = p_capa) then
    raise exception 'capa_indisponivel';
  end if;
  insert into capas_denuncias (capa_id, user_id) values (p_capa, auth.uid()) on conflict do nothing;
  select count(*) into v_total from capas_denuncias where capa_id = p_capa;
  if v_total >= 3 then
    update capas_catalogo set oculta = true where id = p_capa;
  end if;
  return v_total >= 3;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- series_busca_global_registrar: votação simples. Mesma resposta confirma; resposta diferente tira
-- uma confirmação e só troca quando chega a zero (um palpite errado não derruba o consenso).
-- ---------------------------------------------------------------------------------------------
create or replace function series_busca_global_registrar(p_serie_chave text, p_termo text, p_provedor text, p_ref text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_atual series_busca_global%rowtype;
  v_ref text := nullif(btrim(p_ref), '');
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if nullif(btrim(p_serie_chave), '') is null or p_provedor not in ('google_books', 'open_library', 'anilist', 'mangadex') then
    raise exception 'busca_invalida';
  end if;
  if v_ref is not null and v_ref !~ '^[A-Za-z0-9-]{1,64}$' then
    raise exception 'busca_invalida';
  end if;

  select * into v_atual from series_busca_global where serie_chave = p_serie_chave for update;
  if not found then
    insert into series_busca_global (serie_chave, termo, provedor, ref)
    values (left(p_serie_chave, 400), left(p_termo, 200), p_provedor, v_ref)
    on conflict (serie_chave) do nothing;
  elsif v_atual.provedor = p_provedor and v_atual.ref is not distinct from v_ref then
    update series_busca_global set confirmacoes = least(confirmacoes + 1, 1000), termo = coalesce(left(p_termo, 200), termo), atualizado_em = now()
     where serie_chave = p_serie_chave;
  elsif v_atual.confirmacoes > 1 then
    update series_busca_global set confirmacoes = confirmacoes - 1 where serie_chave = p_serie_chave;
  else
    update series_busca_global set provedor = p_provedor, ref = v_ref, termo = left(p_termo, 200), confirmacoes = 1, atualizado_em = now()
     where serie_chave = p_serie_chave;
  end if;
end;
$$;

revoke all on function capa_catalogo_registrar(text, text, text, text, text, text, uuid) from public, anon;
revoke all on function capa_catalogo_aplicar(uuid, uuid) from public, anon;
revoke all on function capas_comunidade_buscar(text, text, text) from public, anon;
revoke all on function capa_denunciar(uuid) from public, anon;
revoke all on function series_busca_global_registrar(text, text, text, text) from public, anon;
grant execute on function capa_catalogo_registrar(text, text, text, text, text, text, uuid) to authenticated;
grant execute on function capa_catalogo_aplicar(uuid, uuid) to authenticated;
grant execute on function capas_comunidade_buscar(text, text, text) to authenticated;
grant execute on function capa_denunciar(uuid) to authenticated;
grant execute on function series_busca_global_registrar(text, text, text, text) to authenticated;

commit;
