-- 0026 — quatro séries favoritas no perfil (R7 do estudo do Letterboxd, seções 6 e 12)
--
-- Pré-requisito: 0025 aplicada (usa privado.v_series, privado.escopo_de_amigo e as regras de amizade da 0014).
--
-- Cada pessoa escolhe até 4 séries da PRÓPRIA coleção e as ordena (posição 1 a 4). Os amigos aceitos veem a faixa no
-- perfil; ninguém mais.
--  * limite de 4 no banco: `posicao` só aceita 1..4 e é única por usuário (a série também é única por usuário),
--    então uma quinta linha é impossível, seja qual for o caminho (formulário, API, SQL direto com a RLS do dono);
--  * só série do dono: um gatilho recusa série de outra pessoa (a RLS de `series` não alcança a chave estrangeira);
--  * quem vê: amigo com amizade aceita AGORA (a leitura confere a amizade a cada chamada, então desfazer some na hora)
--    e só se o dono mantém a seção "séries" no escopo dos amigos. A leitura reaproveita privado.v_series: a série sem
--    nenhum volume possuído (só desejos) não aparece e a capa sai no mesmo formato da vitrine, sem pasta do dono;
--  * só nome, tipo e capa saem: nota e crítica da série (privadas ou não) nunca passam por aqui;
--  * trocar a lista é uma operação só (`favoritos_series_salvar`): apaga e regrava na mesma transação, e a unicidade
--    de posição é conferida no fim do comando, então reordenar não esbarra em si mesmo.

begin;

create table favoritos_series (
  user_id uuid not null references auth.users(id) on delete cascade,
  serie_id uuid not null references series(id) on delete cascade,
  posicao smallint not null check (posicao between 1 and 4),
  criado_em timestamptz not null default now(),
  primary key (user_id, serie_id),
  constraint uq_favoritos_series_posicao unique (user_id, posicao) deferrable initially deferred
);

alter table favoritos_series enable row level security;
revoke all on favoritos_series from anon;
create policy "favoritos_series_owner" on favoritos_series
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Série tem que ser do próprio dono do favorito (a RLS não vê a chave estrangeira).
create or replace function favoritos_series_validar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from series s where s.id = new.serie_id and s.user_id = new.user_id) then
    raise exception 'serie_nao_encontrada';
  end if;
  return new;
end;
$$;
create trigger trg_favoritos_series_validar before insert or update of serie_id, user_id on favoritos_series
  for each row execute function favoritos_series_validar();

-- ---------------------------------------------------------------------------------------------
-- Gravar a lista inteira, na ordem recebida (primeiro = posição 1). Lista vazia limpa os favoritos.
-- ---------------------------------------------------------------------------------------------
create or replace function favoritos_series_salvar(p_series uuid[])
returns void
language plpgsql
set search_path = public
as $$
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

  delete from favoritos_series where user_id = auth.uid();
  insert into favoritos_series (user_id, serie_id, posicao)
  select auth.uid(), x, n::smallint from unnest(p_series) with ordinality as t(x, n);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Os meus favoritos (para escolher e para o meu perfil). `capa` é o caminho completo, como em `itens.capa_url`.
-- ---------------------------------------------------------------------------------------------
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
    from favoritos_series f
    join series s on s.id = f.serie_id and s.user_id = f.user_id
   where f.user_id = auth.uid()
   order by f.posicao
$$;

-- ---------------------------------------------------------------------------------------------
-- Os favoritos de um amigo. Sem amizade aceita, sem a seção "séries" no escopo ou sem favoritos: vazio.
-- ---------------------------------------------------------------------------------------------
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
    from favoritos_series f
    join privado.v_series(v.dono, v.escopo, null) s on s.id = f.serie_id
   where f.user_id = v.dono
   order by f.posicao;
end;
$$;

revoke all on all functions in schema privado from public, anon, authenticated;

revoke all on function favoritos_series_salvar(uuid[]) from public, anon;
revoke all on function favoritos_series_meus() from public, anon;
revoke all on function amigo_favoritos_series(text) from public, anon;
grant execute on function favoritos_series_salvar(uuid[]) to authenticated;
grant execute on function favoritos_series_meus() to authenticated;
grant execute on function amigo_favoritos_series(text) to authenticated;

commit;
