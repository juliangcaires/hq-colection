-- 0011 — catálogo global de edições, apelidos de editora e limite de consultas por ISBN (Fase 2)
--
-- Pré-requisito: 0010 aplicada.
--
-- `edicoes` é compartilhada: qualquer usuário logado LÊ; ninguém escreve direto (sem policy de
-- insert/update/delete e sem grant). A escrita passa por `edicao_registrar`, `security definer`, que
-- valida tudo o que entra. O catálogo guarda só dados bibliográficos públicos: nunca preço, loja,
-- data de compra, nota ou crítica.

begin;

-- ---------------------------------------------------------------------------------------------
-- ISBN-13: 13 dígitos, prefixo 978/979 e dígito verificador (mesma regra de src/lib/isbn.ts)
-- ---------------------------------------------------------------------------------------------
create or replace function isbn13_valido(p text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p ~ '^97[89][0-9]{10}$'
     and ((10 - (select sum(substr(p, i, 1)::int * case when i % 2 = 1 then 1 else 3 end)
                   from generate_series(1, 12) as i) % 10) % 10) = substr(p, 13, 1)::int
$$;

-- ---------------------------------------------------------------------------------------------
-- Catálogo de edições
-- ---------------------------------------------------------------------------------------------
create table edicoes (
  id uuid primary key default gen_random_uuid(),
  isbn13 text unique check (isbn13 is null or isbn13_valido(isbn13)),
  -- série normalizada + número + tipo + editora normalizada (calculada pelo app: src/lib/texto.ts)
  chave_normalizada text not null check (char_length(chave_normalizada) between 1 and 400),
  titulo text not null check (char_length(titulo) between 1 and 300),
  serie_nome text check (serie_nome is null or char_length(serie_nome) <= 200),
  numero_volume numeric,
  tipo tipo_obra,
  editora text check (editora is null or char_length(editora) <= 120),
  autores text[] not null default '{}' check (cardinality(autores) <= 20),
  ano int check (ano is null or ano between 1400 and 2100),
  paginas int check (paginas is null or paginas between 1 and 20000),
  sinopse text check (sinopse is null or char_length(sinopse) <= 4000),
  -- capa que a API informou (só https; o download no servidor ainda confere a lista de hosts)
  capa_url_externa text check (capa_url_externa is null or (capa_url_externa ~ '^https://' and char_length(capa_url_externa) <= 1000)),
  origem text not null check (origem in ('brasilapi', 'google_books', 'open_library', 'usuario')),
  consultado_em timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index idx_edicoes_chave on edicoes (chave_normalizada);
-- Edição sem ISBN: uma só por chave (duas pessoas cadastrando o mesmo volume compartilham a linha).
create unique index uq_edicoes_chave_sem_isbn on edicoes (chave_normalizada) where isbn13 is null;

alter table edicoes enable row level security;
create policy "edicoes_leitura" on edicoes for select to authenticated using (true);
revoke all on edicoes from public, anon;
revoke insert, update, delete, truncate on edicoes from authenticated;
grant select on edicoes to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Apelidos de editora: texto que as APIs devolvem → nome canônico (casado com a tag do usuário).
-- `apelido` já vem normalizado (minúsculas, sem acento, só letras/números e espaço, "&" vira "e").
-- ---------------------------------------------------------------------------------------------
create table editora_apelidos (
  apelido text primary key check (apelido = lower(apelido) and char_length(apelido) between 1 and 120),
  editora text not null check (char_length(editora) between 1 and 120)
);

alter table editora_apelidos enable row level security;
create policy "editora_apelidos_leitura" on editora_apelidos for select to authenticated using (true);
revoke all on editora_apelidos from public, anon;
revoke insert, update, delete, truncate on editora_apelidos from authenticated;
grant select on editora_apelidos to authenticated;

insert into editora_apelidos (apelido, editora) values
  ('panini', 'Panini'), ('panini brasil', 'Panini'), ('panini comics', 'Panini'), ('panini books', 'Panini'),
  ('panini manga', 'Panini'), ('editora panini', 'Panini'), ('panini brasil ltda', 'Panini'),
  ('jbc', 'JBC'), ('editora jbc', 'JBC'), ('japan brazil communication', 'JBC'),
  ('newpop', 'NewPOP'), ('new pop', 'NewPOP'), ('newpop editora', 'NewPOP'), ('new pop editora', 'NewPOP'),
  ('pipoca e nanquim', 'Pipoca & Nanquim'), ('editora pipoca e nanquim', 'Pipoca & Nanquim'),
  ('pipoca nanquim', 'Pipoca & Nanquim'),
  ('devir', 'Devir'), ('devir livraria', 'Devir'), ('editora devir', 'Devir'),
  ('mythos', 'Mythos'), ('mythos editora', 'Mythos'), ('editora mythos', 'Mythos'),
  ('conrad', 'Conrad'), ('conrad editora', 'Conrad'), ('editora conrad', 'Conrad'),
  ('conrad editora do brasil', 'Conrad');

-- ---------------------------------------------------------------------------------------------
-- itens.edicao_id (opcional): item sem edição continua funcionando como antes.
-- ---------------------------------------------------------------------------------------------
alter table itens add column if not exists edicao_id uuid references edicoes(id) on delete set null;
create index if not exists idx_itens_edicao on itens (edicao_id) where edicao_id is not null;
-- Busca por ISBN ignora hífens e espaços digitados no cadastro manual.
create index if not exists idx_itens_isbn_limpo on itens ((regexp_replace(isbn, '[^0-9Xx]', '', 'g'))) where isbn is not null;

-- ---------------------------------------------------------------------------------------------
-- edicao_registrar: única porta de escrita do catálogo.
--
-- Regras de mesclagem (com ISBN: pela coluna isbn13; sem ISBN: pela chave):
--  * edição nova → insere;
--  * existente de origem `usuario` + dado vindo de API → o dado da API vence (preenche o que faltar com o antigo);
--  * qualquer outro caso (existente de API, ou usuário sobre usuário) → só preenche campos vazios.
--    Nunca sobrescreve edição que veio de API e nunca troca a origem de quem já é API.
-- ---------------------------------------------------------------------------------------------
create or replace function edicao_registrar(p_dados jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_isbn text := nullif(btrim(p_dados->>'isbn13'), '');
  v_chave text := nullif(btrim(p_dados->>'chave_normalizada'), '');
  v_titulo text := nullif(btrim(p_dados->>'titulo'), '');
  v_origem text := p_dados->>'origem';
  v_autores text[] := coalesce(array(select left(btrim(a), 120) from jsonb_array_elements_text(coalesce(p_dados->'autores', '[]'::jsonb)) a where btrim(a) <> ''), '{}');
  v_id uuid;
  v_existente edicoes%rowtype;
  v_api boolean;
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if v_titulo is null or v_chave is null then
    raise exception 'edicao_invalida';
  end if;
  if v_origem is null or v_origem not in ('brasilapi', 'google_books', 'open_library', 'usuario') then
    raise exception 'edicao_invalida';
  end if;
  if v_isbn is not null and not isbn13_valido(v_isbn) then
    raise exception 'isbn_invalido';
  end if;
  v_api := v_origem <> 'usuario';

  if v_isbn is not null then
    select * into v_existente from edicoes where isbn13 = v_isbn for update;
  else
    select * into v_existente from edicoes where chave_normalizada = v_chave and isbn13 is null for update;
  end if;

  if not found then
    begin
      insert into edicoes (isbn13, chave_normalizada, titulo, serie_nome, numero_volume, tipo, editora,
                           autores, ano, paginas, sinopse, capa_url_externa, origem)
      values (
        v_isbn, v_chave, v_titulo,
        nullif(btrim(p_dados->>'serie_nome'), ''),
        (p_dados->>'numero_volume')::numeric,
        (p_dados->>'tipo')::tipo_obra,
        nullif(btrim(p_dados->>'editora'), ''),
        v_autores,
        (p_dados->>'ano')::int,
        (p_dados->>'paginas')::int,
        nullif(btrim(p_dados->>'sinopse'), ''),
        nullif(p_dados->>'capa_url_externa', ''),
        v_origem
      )
      returning id into v_id;
      return v_id;
    exception when unique_violation then
      -- Outra sessão registrou a mesma edição entre o select e o insert: cai na mesclagem abaixo.
      if v_isbn is not null then
        select * into v_existente from edicoes where isbn13 = v_isbn for update;
      else
        select * into v_existente from edicoes where chave_normalizada = v_chave and isbn13 is null for update;
      end if;
    end;
  end if;

  if v_existente.origem = 'usuario' and v_api then
    update edicoes set
      titulo = v_titulo,
      serie_nome = coalesce(nullif(btrim(p_dados->>'serie_nome'), ''), serie_nome),
      numero_volume = coalesce((p_dados->>'numero_volume')::numeric, numero_volume),
      tipo = coalesce((p_dados->>'tipo')::tipo_obra, tipo),
      editora = coalesce(nullif(btrim(p_dados->>'editora'), ''), editora),
      autores = case when cardinality(v_autores) > 0 then v_autores else autores end,
      ano = coalesce((p_dados->>'ano')::int, ano),
      paginas = coalesce((p_dados->>'paginas')::int, paginas),
      sinopse = coalesce(nullif(btrim(p_dados->>'sinopse'), ''), sinopse),
      capa_url_externa = coalesce(nullif(p_dados->>'capa_url_externa', ''), capa_url_externa),
      origem = v_origem,
      consultado_em = now()
    where id = v_existente.id;
  else
    update edicoes set
      serie_nome = coalesce(serie_nome, nullif(btrim(p_dados->>'serie_nome'), '')),
      numero_volume = coalesce(numero_volume, (p_dados->>'numero_volume')::numeric),
      tipo = coalesce(tipo, (p_dados->>'tipo')::tipo_obra),
      editora = coalesce(editora, nullif(btrim(p_dados->>'editora'), '')),
      autores = case when cardinality(autores) = 0 then v_autores else autores end,
      ano = coalesce(ano, (p_dados->>'ano')::int),
      paginas = coalesce(paginas, (p_dados->>'paginas')::int),
      sinopse = coalesce(sinopse, nullif(btrim(p_dados->>'sinopse'), '')),
      capa_url_externa = coalesce(capa_url_externa, nullif(p_dados->>'capa_url_externa', ''))
    where id = v_existente.id;
  end if;

  return v_existente.id;
end;
$$;

revoke all on function edicao_registrar(jsonb) from public, anon;
grant execute on function edicao_registrar(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- itens_por_isbn: "você já tem este volume?" — compara ignorando hífens/espaços. `security invoker`:
-- a RLS limita aos itens do próprio usuário.
-- ---------------------------------------------------------------------------------------------
create or replace function itens_por_isbn(p_isbns text[])
returns table (id uuid, titulo text, estado estado_item)
language sql
stable
security invoker
set search_path = public
as $$
  select i.id, i.titulo, i.estado
    from itens i
   where i.isbn is not null
     and upper(regexp_replace(i.isbn, '[^0-9Xx]', '', 'g')) = any (
       array(select upper(regexp_replace(x, '[^0-9Xx]', '', 'g')) from unnest(p_isbns) as x)
     )
   order by i.created_at
   limit 20
$$;

revoke all on function itens_por_isbn(text[]) from public, anon;
grant execute on function itens_por_isbn(text[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Limite de consultas a APIs externas por usuário (as respostas do catálogo não contam).
-- Janela de 1 hora; devolve false quando o limite foi atingido, sem registrar a tentativa.
-- ---------------------------------------------------------------------------------------------
create table isbn_consultas (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index idx_isbn_consultas_user on isbn_consultas (user_id, created_at desc);

alter table isbn_consultas enable row level security;
create policy "isbn_consultas_dono" on isbn_consultas
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on isbn_consultas from public, anon;
grant select, insert, delete on isbn_consultas to authenticated;

create or replace function isbn_consulta_registrar(p_limite int default 60)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_usadas int;
begin
  delete from isbn_consultas where user_id = auth.uid() and created_at < now() - interval '1 day';
  select count(*) into v_usadas from isbn_consultas
   where user_id = auth.uid() and created_at > now() - interval '1 hour';
  if v_usadas >= least(greatest(p_limite, 1), 200) then
    return false;
  end if;
  insert into isbn_consultas (user_id) values (auth.uid());
  return true;
end;
$$;

revoke all on function isbn_consulta_registrar(int) from public, anon;
grant execute on function isbn_consulta_registrar(int) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- item_salvar passa a aceitar `edicao_id`. Na edição, a chave ausente mantém o vínculo atual
-- (formulários antigos não desligam a edição sem querer); `null` explícito desvincula.
-- ---------------------------------------------------------------------------------------------
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
                       preco, loja, data_aquisicao, nota, critica, lido_em, edicao_id)
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
      nullif(p_dados->>'edicao_id', '')::uuid
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
      edicao_id = case when p_dados ? 'edicao_id' then nullif(p_dados->>'edicao_id', '')::uuid else edicao_id end
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

commit;
