-- Fase 0 — schema inicial (série, item, tags, herança de tags, RLS)
-- Referência: PLANO-APP-COLECAO.md, seção 4

-- Tipos
create type tipo_obra as enum ('hq', 'manga');
create type estado_item as enum ('desejo', 'comprado', 'lido');
create type tipo_tag as enum ('personagem', 'editora', 'arco', 'selo', 'autor', 'universo', 'outro');
create type origem_capa as enum ('api', 'foto', 'nenhuma');

-- Séries
create table series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  tipo tipo_obra not null default 'hq',
  editora text,
  total_volumes int,              -- null = desconhecido ou em publicação
  em_publicacao boolean default true,
  observacoes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Itens
create table itens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  serie_id uuid references series(id) on delete set null,  -- null = avulso/one-shot
  titulo text not null,
  numero_volume numeric,          -- numeric para aceitar 1.5, edições especiais
  tipo tipo_obra not null default 'hq',
  isbn text,
  estado estado_item not null default 'desejo',
  prioridade int default 0,       -- ordenação da lista de desejos
  capa_url text,                  -- URL no Supabase Storage
  capa_origem origem_capa default 'nenhuma',
  -- dados de compra (todos opcionais)
  preco numeric(10,2),
  loja text,
  data_aquisicao date,
  nota int check (nota between 1 and 5),
  observacoes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Tags
create table tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  tipo tipo_tag not null default 'outro',
  cor text,
  created_at timestamptz default now(),
  unique (user_id, nome, tipo)
);

create table serie_tags (
  serie_id uuid references series(id) on delete cascade,
  tag_id uuid references tags(id) on delete cascade,
  primary key (serie_id, tag_id)
);

create table item_tags (
  item_id uuid references itens(id) on delete cascade,
  tag_id uuid references tags(id) on delete cascade,
  primary key (item_id, tag_id)
);

-- Tags efetivas (item + herdadas da série)
create view v_item_tags_efetivas as
  select i.id as item_id, it.tag_id, 'item' as origem
    from itens i join item_tags it on it.item_id = i.id
  union
  select i.id as item_id, st.tag_id, 'serie' as origem
    from itens i join serie_tags st on st.serie_id = i.serie_id;

-- Índices
create index idx_itens_user_estado on itens (user_id, estado);
create index idx_itens_serie_vol on itens (user_id, serie_id, numero_volume);
create index idx_itens_isbn on itens (isbn) where isbn is not null;
create index idx_series_user_nome on series (user_id, nome);

-- updated_at automático
create function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_series_updated_at before update on series
  for each row execute function set_updated_at();

create trigger trg_itens_updated_at before update on itens
  for each row execute function set_updated_at();

-- RLS
alter table series enable row level security;
alter table itens enable row level security;
alter table tags enable row level security;
alter table serie_tags enable row level security;
alter table item_tags enable row level security;

create policy "series_owner" on series
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "itens_owner" on itens
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "tags_owner" on tags
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "serie_tags_owner" on serie_tags
  for all using (
    exists (select 1 from series s where s.id = serie_tags.serie_id and s.user_id = auth.uid())
  ) with check (
    exists (select 1 from series s where s.id = serie_tags.serie_id and s.user_id = auth.uid())
  );

create policy "item_tags_owner" on item_tags
  for all using (
    exists (select 1 from itens i where i.id = item_tags.item_id and i.user_id = auth.uid())
  ) with check (
    exists (select 1 from itens i where i.id = item_tags.item_id and i.user_id = auth.uid())
  );

-- Storage: bucket privado de capas
insert into storage.buckets (id, name, public)
values ('capas', 'capas', false)
on conflict (id) do nothing;

create policy "capas_owner_select" on storage.objects
  for select using (bucket_id = 'capas' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "capas_owner_insert" on storage.objects
  for insert with check (bucket_id = 'capas' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "capas_owner_update" on storage.objects
  for update using (bucket_id = 'capas' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "capas_owner_delete" on storage.objects
  for delete using (bucket_id = 'capas' and (storage.foldername(name))[1] = auth.uid()::text);
