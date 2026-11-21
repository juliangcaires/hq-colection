-- 0036 — favoritos do perfil: séries E volumes únicos (avulsos), no mesmo limite de 4
--
-- Pré-requisito: 0035 aplicada (parte da tabela da 0026 e de privado.v_series / privado.escopo_de_amigo).
--
-- Modelagem: a tabela `favoritos_series` vira `favoritos` e ganha `item_id`. Cada linha é uma série OU um item avulso
-- (`check` de exatamente um dos dois). Estender a tabela existente, em vez de criar outra e copiar as linhas, mantém
-- os favoritos de hoje intactos (mesma posição, mesma ordem) e deixa o limite de 4 valendo no total por construção:
-- `posicao` 1..4 é única por usuário (deferrable, como na 0026), então não existe quinta linha, qualquer que seja o
-- caminho (função, formulário, SQL direto com a RLS do dono).
--
-- Regras do avulso (conferidas no gatilho e de novo na leitura):
--  * item do próprio dono, na coleção (comprado ou lido; desejo não), SEM série e que não é variante de outro volume
--    (a variante é outro exemplar da mesma obra: entra o volume normal);
--  * se o item vira desejo, ganha série ou vira variante depois, o favorito dele é apagado na hora (gatilho em `itens`);
--    apagar o item apaga o favorito (on delete cascade).
--
-- Quem vê (amigo com amizade aceita AGORA, conferida a cada chamada):
--  * série: como na 0026, só com a seção "series" no `escopo_amigos` (e com volume possuído: privado.v_series);
--  * avulso: a seção que governa os volumes avulsos na vitrine é "colecao" (privado.v_itens e privado.v_capa). Sem ela
--    no escopo, o favorito avulso simplesmente não vem (nem "existe" para quem não pode ver);
--  * só título, tipo e capa saem; nota e crítica nunca. A capa sai no formato da vitrine (`pub/…` direto do catálogo
--    público; privada só o nome do arquivo, servida pela rota autorizada, sem expor a pasta do dono).
--
-- Compatibilidade (app antigo + banco novo): as funções `favoritos_series_salvar`, `favoritos_series_meus` e
-- `amigo_favoritos_series` continuam existindo e continuam só de séries, agora sobre a tabela nova.
--  * `favoritos_series_meus` / `amigo_favoritos_series` devolvem só as linhas de série (a posição pode ter "buraco");
--  * `favoritos_series_salvar` troca a lista de SÉRIES e preserva os avulsos que o app antigo não conhece, colocando-os
--    depois das séries (se não couber em 4, recusa com `favoritos_limite`, sem apagar nada);
--  * `favoritos_series_candidatas` não toca na tabela e fica como está.
-- Funções novas, com nome novo: `favoritos_salvar(jsonb)`, `favoritos_meus()`, `favoritos_candidatos()` e
-- `amigo_favoritos(text)`.

begin;

-- ---------------------------------------------------------------------------------------------
-- Tabela: renomeia e abre espaço para o item avulso.
-- ---------------------------------------------------------------------------------------------
drop trigger trg_favoritos_series_validar on favoritos_series;
drop function favoritos_series_validar();

alter table favoritos_series rename to favoritos;
alter policy "favoritos_series_owner" on favoritos rename to "favoritos_owner";
alter table favoritos rename constraint uq_favoritos_series_posicao to uq_favoritos_posicao;

alter table favoritos drop constraint favoritos_series_pkey;
alter table favoritos add column id uuid not null default gen_random_uuid();
alter table favoritos add constraint favoritos_pkey primary key (id);
alter table favoritos alter column serie_id drop not null;
alter table favoritos add column item_id uuid references itens(id) on delete cascade;
alter table favoritos add constraint favoritos_serie_ou_item check (num_nonnulls(serie_id, item_id) = 1);
-- A mesma série (ou o mesmo item) não entra duas vezes. Com o outro lado nulo, o unique não atrapalha.
alter table favoritos add constraint uq_favoritos_serie unique (user_id, serie_id);
alter table favoritos add constraint uq_favoritos_item unique (user_id, item_id);

-- Série ou item tem que ser do próprio dono do favorito (a RLS não vê a chave estrangeira); o item é avulso e possuído.
create or replace function favoritos_validar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.serie_id is not null
     and not exists (select 1 from series s where s.id = new.serie_id and s.user_id = new.user_id) then
    raise exception 'serie_nao_encontrada';
  end if;
  if new.item_id is not null
     and not exists (
       select 1 from itens i
        where i.id = new.item_id and i.user_id = new.user_id
          and i.serie_id is null and i.variante_de is null and i.estado <> 'desejo'
     ) then
    raise exception 'item_nao_elegivel';
  end if;
  return new;
end;
$$;
create trigger trg_favoritos_validar before insert or update of serie_id, item_id, user_id on favoritos
  for each row execute function favoritos_validar();

-- O item deixou de ser elegível (virou desejo, entrou numa série ou virou variante): sai dos favoritos.
create or replace function favoritos_item_mudou()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'desejo' or new.serie_id is not null or new.variante_de is not null then
    delete from favoritos where item_id = new.id;
  end if;
  return null;
end;
$$;
create trigger trg_favoritos_item_mudou after update of estado, serie_id, variante_de on itens
  for each row execute function favoritos_item_mudou();

-- ---------------------------------------------------------------------------------------------
-- Gravar a lista inteira, na ordem recebida (primeiro = posição 1): `[{"tipo":"serie"|"item","id":"<uuid>"}, …]`.
-- Lista vazia limpa. Apaga e regrava na mesma transação; a unicidade de posição é conferida no fim do comando.
-- ---------------------------------------------------------------------------------------------
create or replace function favoritos_salvar(p_lista jsonb)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_tipos text[];
  v_ids uuid[];
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if p_lista is null or p_lista = 'null'::jsonb then
    p_lista := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_lista) <> 'array' then
    raise exception 'favoritos_invalido';
  end if;
  if jsonb_array_length(p_lista) > 4 then
    raise exception 'favoritos_limite';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lista) e
     where jsonb_typeof(e) <> 'object'
        or e->>'tipo' is null or e->>'tipo' not in ('serie', 'item')
        or e->>'id' is null
        or e->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'favoritos_invalido';
  end if;

  select array_agg(e->>'tipo' order by n), array_agg((e->>'id')::uuid order by n)
    into v_tipos, v_ids
    from jsonb_array_elements(p_lista) with ordinality as t(e, n);
  v_tipos := coalesce(v_tipos, '{}');
  v_ids := coalesce(v_ids, '{}');

  if (select count(distinct x) from unnest(v_ids) x) <> cardinality(v_ids) then
    raise exception 'favoritos_repetido';
  end if;
  if exists (
    select 1 from unnest(v_tipos, v_ids) as t(tp, x)
     where tp = 'serie' and not exists (select 1 from series s where s.id = x and s.user_id = auth.uid())
  ) then
    raise exception 'serie_nao_encontrada';
  end if;
  if exists (
    select 1 from unnest(v_tipos, v_ids) as t(tp, x)
     where tp = 'item' and not exists (
       select 1 from itens i
        where i.id = x and i.user_id = auth.uid()
          and i.serie_id is null and i.variante_de is null and i.estado <> 'desejo'
     )
  ) then
    raise exception 'item_nao_elegivel';
  end if;

  delete from favoritos where user_id = auth.uid();
  insert into favoritos (user_id, serie_id, item_id, posicao)
  select auth.uid(),
         case when tp = 'serie' then x end,
         case when tp = 'item' then x end,
         n::smallint
    from unnest(v_tipos, v_ids) with ordinality as t(tp, x, n);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Os meus favoritos (para escolher e para o meu perfil), séries e avulsos na ordem. `origem` é 'serie' ou 'avulso';
-- `nome` é o nome da série ou o título do volume; `capa` é o caminho completo, como em `itens.capa_url`.
-- Avulso que deixou de valer (defesa extra, o gatilho de `itens` já o apaga) não aparece.
-- ---------------------------------------------------------------------------------------------
create or replace function favoritos_meus()
returns table (origem text, id uuid, nome text, tipo tipo_obra, capa text, posicao int)
language sql
stable
set search_path = public
as $$
  select 'serie'::text, s.id, s.nome, s.tipo,
         (select i.capa_url from itens i
           where i.serie_id = s.id and i.estado <> 'desejo' and i.capa_url is not null
           order by i.variante_de nulls first, i.numero_volume nulls last, i.id limit 1),
         f.posicao::int
    from favoritos f
    join series s on s.id = f.serie_id and s.user_id = f.user_id
   where f.user_id = auth.uid()
  union all
  select 'avulso'::text, i.id, i.titulo, i.tipo, i.capa_url, f.posicao::int
    from favoritos f
    join itens i on i.id = f.item_id and i.user_id = f.user_id
   where f.user_id = auth.uid()
     and i.serie_id is null and i.variante_de is null and i.estado <> 'desejo'
   order by 6
$$;

-- ---------------------------------------------------------------------------------------------
-- O que dá para escolher: as minhas séries com ao menos um volume possuído (como a 0026) e os meus volumes avulsos
-- na coleção (comprado ou lido, sem série, sem ser variante). Ordem alfabética.
-- ---------------------------------------------------------------------------------------------
create or replace function favoritos_candidatos()
returns table (origem text, id uuid, nome text, tipo tipo_obra, capa text)
language sql
stable
set search_path = public
as $$
  select q.* from (
    select 'serie'::text as origem, s.id, s.nome, s.tipo,
           (select i.capa_url from itens i
             where i.serie_id = s.id and i.estado <> 'desejo' and i.capa_url is not null
             order by i.variante_de nulls first, i.numero_volume nulls last, i.id limit 1) as capa
      from series s
     where s.user_id = auth.uid()
       and exists (select 1 from itens i where i.serie_id = s.id and i.estado <> 'desejo')
    union all
    select 'avulso'::text, i.id, i.titulo, i.tipo, i.capa_url
      from itens i
     where i.user_id = auth.uid()
       and i.serie_id is null and i.variante_de is null and i.estado <> 'desejo'
  ) q
  order by lower(q.nome), q.id
$$;

-- ---------------------------------------------------------------------------------------------
-- Os favoritos de um amigo. Sem amizade aceita: vazio. Série só com "series" no escopo; avulso só com "colecao".
-- Só origem, id, nome, tipo, capa e posição saem; a capa no formato da vitrine.
-- ---------------------------------------------------------------------------------------------
create or replace function amigo_favoritos(p_apelido text)
returns table (origem text, id uuid, nome text, tipo tipo_obra, capa text, posicao int)
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

-- ---------------------------------------------------------------------------------------------
-- Funções da 0026, mantidas para o app antigo: só séries, agora sobre a tabela `favoritos`.
-- ---------------------------------------------------------------------------------------------
create or replace function favoritos_series_salvar(p_series uuid[])
returns void
language plpgsql
set search_path = public
as $$
declare
  v_avulsos uuid[];
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if p_series is null then
    p_series := '{}';
  end if;
  if cardinality(p_series) > 4 then
    raise exception 'favoritos_limite';
  end if;
  if exists (select 1 from unnest(p_series) x where x is null)
     or (select count(distinct x) from unnest(p_series) x) <> cardinality(p_series) then
    raise exception 'favoritos_repetido';
  end if;
  if exists (
    select 1 from unnest(p_series) x
     where not exists (select 1 from series s where s.id = x and s.user_id = auth.uid())
  ) then
    raise exception 'serie_nao_encontrada';
  end if;

  -- Os avulsos que o app antigo não enxerga ficam guardados, depois das séries.
  select coalesce(array_agg(f.item_id order by f.posicao), '{}') into v_avulsos
    from favoritos f where f.user_id = auth.uid() and f.item_id is not null;
  if cardinality(p_series) + cardinality(v_avulsos) > 4 then
    raise exception 'favoritos_limite';
  end if;

  delete from favoritos where user_id = auth.uid();
  insert into favoritos (user_id, serie_id, posicao)
  select auth.uid(), x, n::smallint from unnest(p_series) with ordinality as t(x, n);
  insert into favoritos (user_id, item_id, posicao)
  select auth.uid(), x, (cardinality(p_series) + n)::smallint from unnest(v_avulsos) with ordinality as t(x, n);
end;
$$;

create or replace function favoritos_series_meus()
returns table (id uuid, nome text, tipo tipo_obra, capa text, posicao int)
language sql
stable
set search_path = public
as $$
  select s.id, s.nome, s.tipo,
         (select i.capa_url from itens i
           where i.serie_id = s.id and i.estado <> 'desejo' and i.capa_url is not null
           order by i.variante_de nulls first, i.numero_volume nulls last, i.id limit 1) as capa,
         f.posicao::int
    from favoritos f
    join series s on s.id = f.serie_id and s.user_id = f.user_id
   where f.user_id = auth.uid()
   order by f.posicao
$$;

create or replace function amigo_favoritos_series(p_apelido text)
returns table (id uuid, nome text, tipo tipo_obra, capa text, posicao int)
language plpgsql
stable
security definer
set search_path = public, privado
as $$
declare
  v record;
begin
  select * into v from privado.escopo_de_amigo(p_apelido);
  if v.dono is null or not ('series' = any (v.escopo)) then
    return;
  end if;
  return query
  select s.id, s.nome, s.tipo, s.capa, f.posicao::int
    from favoritos f
    join privado.v_series(v.dono, v.escopo, null) s on s.id = f.serie_id
   where f.user_id = v.dono
   order by f.posicao;
end;
$$;

revoke all on all functions in schema privado from public, anon, authenticated;

revoke all on function favoritos_salvar(jsonb) from public, anon;
revoke all on function favoritos_meus() from public, anon;
revoke all on function favoritos_candidatos() from public, anon;
revoke all on function amigo_favoritos(text) from public, anon;
grant execute on function favoritos_salvar(jsonb) to authenticated;
grant execute on function favoritos_meus() to authenticated;
grant execute on function favoritos_candidatos() to authenticated;
grant execute on function amigo_favoritos(text) to authenticated;

commit;
