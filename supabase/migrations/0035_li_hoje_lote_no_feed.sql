-- 0035 — "Li hoje": avaliar vários volumes de uma vez e o card único do lote no feed
--
-- Pré-requisito: 0034 aplicada. Só ACRESCENTA: o app antigo continua funcionando com este banco (lê as colunas de
-- `feed_listar` e de `notificacoes_listar` pelo nome; as colunas novas vêm NO FIM; o que já existia não muda de
-- formato). O contrário não vale: o app novo precisa desta migration.
--
-- Ideia do Julian (21/11/2026): em dia de pôr a leitura em dia ele lê volumes de séries diferentes e não quer entrar
-- volume por volume. O app ganha o atalho "Li hoje" (seleção + passo a passo de nota e crítica, uma data só) e o feed
-- mostra UM card para o lote, com as capas e a lista que se expande.
--
--  * `itens.feed_lote_id` (nulo): identifica o lote em que o volume virou lido. Só o "Li hoje" preenche; qualquer outra
--    leitura (marcar um volume, série inteira, CSV...) continua nula e o feed a trata exatamente como antes.
--    Um gatilho zera a coluna quando o item deixa de ser `lido`: marcar de novo depois nunca herda o lote antigo.
--  * `itens_marcar_lidos_lote(p_data, p_itens)`: grava o lote INTEIRO numa transação (estado, data única, nota,
--    crítica e spoiler de cada volume). Qualquer volume inválido (não comprado, de outra pessoa, nota fora da régua...)
--    derruba o lote todo: nada fica pela metade. Os gatilhos de sempre fazem o resto (`lido_em`, `lido_marcado_em`,
--    leituras da 0025, variantes da 0017). Lote de 1 volume só não recebe `feed_lote_id` (é leitura normal).
--  * `feed_listar`: lote com 2 ou mais OBRAS diferentes (série ou volume avulso) entre os volumes visíveis vira um card
--    só (um por pessoa + lote). Lote de uma obra só segue como o card da série de sempre. Colunas novas no fim:
--    `lote_id` e `lote_itens` (jsonb: item_id, serie_nome, titulo, numero_volume, capa, nota, crítica e spoiler de cada
--    volume, já com a visibilidade de amigos: nota/crítica só com `notas_criticas` no escopo, crítica privada nunca).
--    No card de lote `serie_nome` e a nota/crítica da série vêm nulos (são várias séries): o app antigo mostra
--    "N volumes" com a capa do volume que representa o card.
--  * Curtir e comentar continuam tendo o ITEM como alvo: no card de lote o alvo é o volume que o representa
--    (`item_id`, o mais recente; empate pelo id). "Tirar do feed" tira o card inteiro (o lote todo) e
--    `feed_ocultos_listar` o lista como "N volumes" para recolocar.
--  * `notificacoes_listar` ganha `lote_qtd` (no fim): quantos volumes tem o card do aviso (nulo se não é card de
--    lote), para o app dizer "curtiu sua leitura de N volumes".

begin;

-- ---------------------------------------------------------------------------------------------
-- Coluna e gatilho
-- ---------------------------------------------------------------------------------------------
alter table itens add column feed_lote_id uuid;

create index idx_itens_feed_lote on itens (user_id, feed_lote_id) where feed_lote_id is not null;

-- Lote só existe enquanto o volume está lido. (Nome com `z`: roda depois dos outros BEFORE, que podem mudar o estado.)
create or replace function itens_limpar_lote()
returns trigger
language plpgsql
as $$
begin
  if new.estado <> 'lido' then
    new.feed_lote_id := null;
  end if;
  return new;
end;
$$;

create trigger trg_itens_z_limpar_lote before insert or update on itens
  for each row execute function itens_limpar_lote();

-- ---------------------------------------------------------------------------------------------
-- Gravar o lote inteiro de uma vez.
--  p_data:  a data da leitura (uma só para o lote); nula = hoje (fuso de São Paulo). Não pode ser futura.
--  p_itens: [{ "item_id": uuid, "nota": 0.5..5 | null, "critica": text | null, "critica_spoiler": bool | null }, ...]
--           de 1 a 100 volumes, sem repetir. Nota e crítica ausentes mantêm o que o volume já tinha (como o
--           "Marcar como lido" de sempre); com crítica nova, vale o spoiler informado.
-- ---------------------------------------------------------------------------------------------
create or replace function itens_marcar_lidos_lote(p_data date, p_itens jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_data date;
  v_n int;
  v_ids uuid[];
  v_notas numeric[];
  v_criticas text[];
  v_spoilers boolean[];
  v_lote uuid;
  v_marcados int;
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  v_data := coalesce(p_data, v_hoje);
  if v_data > v_hoje then
    raise exception 'data_futura';
  end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then
    raise exception 'lote_invalido';
  end if;
  v_n := jsonb_array_length(p_itens);
  if v_n < 1 then
    raise exception 'lote_vazio';
  end if;
  if v_n > 100 then
    raise exception 'lote_grande';
  end if;

  begin
    select array_agg((t.e->>'item_id')::uuid order by t.ord),
           array_agg((t.e->>'nota')::numeric order by t.ord),
           array_agg(nullif(btrim(coalesce(t.e->>'critica', '')), '') order by t.ord),
           array_agg(coalesce((t.e->>'critica_spoiler')::boolean, false) order by t.ord)
      into v_ids, v_notas, v_criticas, v_spoilers
      from jsonb_array_elements(p_itens) with ordinality as t(e, ord);
  exception when others then
    raise exception 'lote_invalido';
  end;

  if array_position(v_ids, null) is not null then
    raise exception 'lote_invalido';
  end if;
  if (select count(distinct x) from unnest(v_ids) x) <> v_n then
    raise exception 'lote_repetido';
  end if;
  if exists (select 1 from unnest(v_notas) n
              where n is not null and not (n between 0.5 and 5 and (n * 2) = trunc(n * 2))) then
    raise exception 'nota_invalida';
  end if;
  if exists (select 1 from unnest(v_criticas) c where char_length(coalesce(c, '')) > 2000) then
    raise exception 'critica_longa';
  end if;

  -- Cada volume tem de ser do usuário e estar comprado (mesma regra do "Marcar como lido": desejo ainda não foi
  -- lido e o lido já foi marcado). Trava as linhas para duas gravações do mesmo lote não se cruzarem.
  perform 1 from itens i where i.id = any (v_ids) and i.user_id = auth.uid() order by i.id for update;
  if (select count(*) from itens i where i.id = any (v_ids) and i.user_id = auth.uid() and i.estado = 'comprado') <> v_n then
    raise exception 'lote_item_indisponivel';
  end if;

  -- Um lote de 1 volume é leitura normal: sem `feed_lote_id`.
  v_lote := case when v_n >= 2 then gen_random_uuid() end;

  update itens i set
    estado = 'lido',
    lido_em = v_data,
    nota = coalesce(e.nota, i.nota),
    critica = coalesce(e.critica, i.critica),
    critica_spoiler = case when e.critica is not null then e.spoiler else i.critica_spoiler end,
    feed_lote_id = v_lote
  from unnest(v_ids, v_notas, v_criticas, v_spoilers) as e(item_id, nota, critica, spoiler)
  where i.id = e.item_id and i.user_id = auth.uid() and i.estado = 'comprado';
  get diagnostics v_marcados = row_count;

  return jsonb_build_object('marcados', v_marcados, 'lote_id', v_lote);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Tirar do feed: o card de lote sai inteiro (todos os volumes visíveis do lote); fora disso, como na 0031.
-- ---------------------------------------------------------------------------------------------
create or replace function feed_ocultar_post(p_item uuid, p_grupo boolean default true)
returns uuid[]
language plpgsql
security definer
set search_path = public, privado
as $$
declare
  i itens%rowtype;
  v_ids uuid[] := '{}';
  v_obras int := 0;
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  select * into i from itens where id = p_item and user_id = auth.uid();
  if not found then
    raise exception 'item_nao_encontrado';
  end if;

  -- Card de lote: 2 ou mais obras diferentes entre os volumes visíveis do lote (a mesma regra de `feed_listar`).
  if coalesce(p_grupo, true) and i.feed_lote_id is not null and i.lido_marcado_em is not null then
    select coalesce(array_agg(x.id order by x.id), '{}'), count(distinct coalesce(x.serie_id::text, x.id::text))
      into v_ids, v_obras
      from itens x
     where x.user_id = auth.uid()
       and x.feed_lote_id = i.feed_lote_id
       and x.estado = 'lido'
       and x.variante_de is null
       and not x.feed_oculto
       and x.lido_marcado_em is not null
       and x.lido_marcado_em > now() - interval '90 days';
    if v_obras < 2 then
      v_ids := '{}';
    end if;
  end if;

  if cardinality(v_ids) = 0 then
    if coalesce(p_grupo, true) and i.serie_id is not null and i.lido_marcado_em is not null then
      select coalesce(array_agg(x.id order by x.id), '{}') into v_ids
        from itens x
       where x.user_id = auth.uid()
         and x.serie_id = i.serie_id
         and x.estado = 'lido'
         and x.variante_de is null
         and not x.feed_oculto
         and x.lido_marcado_em is not null
         and x.lido_marcado_em > now() - interval '90 days'
         and (x.lido_marcado_em at time zone 'America/Sao_Paulo')::date = (i.lido_marcado_em at time zone 'America/Sao_Paulo')::date;
    end if;
  end if;
  if not (i.id = any (v_ids)) then
    v_ids := array_append(v_ids, i.id);
  end if;

  update itens set feed_oculto = true where id = any (v_ids) and user_id = auth.uid();
  return v_ids;
end;
$$;

-- Os tirados do feed que ainda podem voltar: o lote (2+ obras entre os tirados) é UM item da lista, sem nome de série.
create or replace function feed_ocultos_listar()
returns table (
  item_ids uuid[],
  item_id uuid,
  serie_nome text,
  titulo text,
  numero_volume numeric,
  tipo tipo_obra,
  qtd int,
  marcado_em timestamptz
)
language sql
stable
security definer
set search_path = public, privado
as $$
  with ocultos as (
    select i.id, i.serie_id, i.titulo, i.numero_volume, i.tipo, i.feed_lote_id,
           coalesce(i.lido_marcado_em, i.updated_at) as ordem,
           case when i.lido_marcado_em is null then i.id::text
                else coalesce(i.serie_id::text, i.id::text) || '|' || (i.lido_marcado_em at time zone 'America/Sao_Paulo')::date::text
           end as grupo_base,
           coalesce(i.serie_id::text, i.id::text) as obra
      from itens i
     where auth.uid() is not null
       and i.user_id = auth.uid()
       and i.feed_oculto
       and i.estado = 'lido'
       and i.variante_de is null
       and ((i.lido_marcado_em is not null and i.lido_marcado_em > now() - interval '90 days')
            or exists (select 1 from leituras l
                        where l.item_id = i.id and l.releitura and l.criado_em > now() - interval '90 days'))
  ),
  lotes as (
    select o.feed_lote_id
      from ocultos o
     where o.feed_lote_id is not null
     group by o.feed_lote_id
    having count(distinct o.obra) >= 2
  ),
  com_lote as (
    select o.*,
           (lo.feed_lote_id is not null) as em_lote,
           case when lo.feed_lote_id is not null then 'l' || o.feed_lote_id::text else o.grupo_base end as grupo
      from ocultos o
      left join lotes lo on lo.feed_lote_id = o.feed_lote_id
  ),
  grupos as (
    select o.*,
           count(*) over w as qtd,
           row_number() over (w order by o.ordem desc, o.id) as rn,
           max(o.ordem) over w as marcado_em,
           array_agg(o.id) over w as ids
      from com_lote o
    window w as (partition by o.grupo)
  )
  select g.ids, g.id, case when g.em_lote then null else s.nome end, g.titulo, g.numero_volume, g.tipo, g.qtd::int, g.marcado_em
    from grupos g
    left join series s on s.id = g.serie_id
   where g.rn = 1
   order by g.marcado_em desc, g.id
   limit 100
$$;

-- ---------------------------------------------------------------------------------------------
-- feed_listar: igual à 0032, com o card de lote (colunas novas NO FIM).
-- ---------------------------------------------------------------------------------------------
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
  leitura_id uuid,
  -- 0031
  nota_media numeric,
  avaliados int,
  critica_grupo text,
  critica_grupo_spoiler boolean,
  critica_grupo_volume numeric,
  serie_nota numeric,
  serie_critica text,
  -- 0032
  capa_destaque text,
  capa_destaque_item uuid,
  -- novas (0035)
  lote_id uuid,
  lote_itens jsonb
)
language sql
stable
security definer
set search_path = public, privado
as $$
  with visiveis as (
    -- Primeira leitura: o item marcado como lido (0018). Lote vira um post por pessoa + série + dia.
    select i.id, i.user_id, i.serie_id, i.titulo, i.numero_volume, i.tipo, i.capa_url, i.nota, i.critica,
           i.critica_privada, i.critica_spoiler, i.lido_em, i.lido_marcado_em as ordem, i.melhor_da_serie,
           p.apelido, p.nome_exibicao, p.avatar_url, p.escopo_amigos,
           (i.lido_marcado_em at time zone 'America/Sao_Paulo')::date as dia,
           coalesce(i.serie_id::text, i.id::text) as grupo_base,
           i.feed_lote_id,
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
           i.critica_privada, i.critica_spoiler, l.lido_em, l.criado_em as ordem, i.melhor_da_serie,
           p.apelido, p.nome_exibicao, p.avatar_url, p.escopo_amigos,
           (l.criado_em at time zone 'America/Sao_Paulo')::date as dia,
           'r' || l.id::text as grupo_base,
           null::uuid as feed_lote_id,
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
  lotes as (
    -- Lote do "Li hoje" que vira card próprio: 2 ou mais obras diferentes (série, ou volume avulso) entre os volumes
    -- visíveis. Um lote de uma obra só (ou de 1 volume) segue como leitura normal: o card da série.
    select v.user_id, v.feed_lote_id
      from visiveis v
     where v.feed_lote_id is not null
     group by v.user_id, v.feed_lote_id
    having count(distinct v.grupo_base) >= 2
  ),
  com_visao as (
    -- Nota e crítica como o amigo pode vê-las (a mesma regra de `v_itens`).
    select v.*,
           (lo.feed_lote_id is not null) as em_lote,
           case when lo.feed_lote_id is not null then 'l' || v.feed_lote_id::text else v.grupo_base end as grupo,
           case when 'notas_criticas' = any (v.escopo_amigos) then v.nota end as v_nota,
           case when 'notas_criticas' = any (v.escopo_amigos) and not v.critica_privada then v.critica end as v_critica,
           -- Marca de melhor da série como quem pede pode vê-la (a regra da vitrine, 0030): o dono vê a sua;
           -- o amigo precisa de `notas_criticas` + `lidos` no escopo.
           (v.melhor_da_serie
              and (v.user_id = auth.uid()
                   or ('notas_criticas' = any (v.escopo_amigos) and 'lidos' = any (v.escopo_amigos)))) as v_melhor
      from visiveis v
      left join lotes lo on lo.user_id = v.user_id and lo.feed_lote_id = v.feed_lote_id
  ),
  grupos as (
    select v.*,
           count(*) over w as qtd,
           row_number() over (w order by v.ordem desc, v.id) as rn,
           max(v.ordem) over w as marcado_em,
           round(avg(v.v_nota) over w, 2) as nota_media,
           count(v.v_nota) over w as avaliados,
           -- A crítica visível mais recente do grupo (e o volume dela).
           first_value(v.v_critica) over wc as critica_grupo,
           first_value(v.critica_spoiler) over wc as critica_grupo_spoiler,
           first_value(v.numero_volume) over wc as critica_grupo_volume,
           -- O melhor volume visível entre os do grupo (se houver, é a primeira linha desta ordem).
           first_value(v.v_melhor) over wm as tem_melhor,
           first_value(v.id) over wm as melhor_id,
           first_value(v.capa_url) over wm as melhor_capa
      from com_visao v
    window w as (partition by v.user_id, v.grupo, v.dia),
           wc as (partition by v.user_id, v.grupo, v.dia
                  order by (v.v_critica is null), v.ordem desc, v.id
                  rows between unbounded preceding and unbounded following),
           wm as (partition by v.user_id, v.grupo, v.dia
                  order by (not v.v_melhor), v.ordem desc, v.id
                  rows between unbounded preceding and unbounded following)
  )
  select g.id,
         g.user_id,
         g.apelido,
         g.nome_exibicao,
         g.avatar_url,
         g.user_id = auth.uid(),
         case when g.em_lote then null else s.nome end,
         g.titulo,
         g.numero_volume,
         g.tipo,
         case when g.capa_url like 'pub/%' then g.capa_url else regexp_replace(g.capa_url, '^.*/', '') end,
         g.v_nota,
         g.v_critica,
         (g.v_critica is not null and g.critica_spoiler),
         g.lido_em,
         g.marcado_em,
         g.qtd::int,
         (select count(*)::int from feed_curtidas c
           where c.item_id = g.id and privado.feed_autor_visivel(auth.uid(), g.user_id, c.user_id)),
         exists (select 1 from feed_curtidas c where c.item_id = g.id and c.user_id = auth.uid()),
         (select count(*)::int from feed_comentarios m
           where m.item_id = g.id and privado.feed_autor_visivel(auth.uid(), g.user_id, m.user_id)),
         g.releitura,
         g.leitura_id,
         g.nota_media,
         g.avaliados::int,
         g.critica_grupo,
         (g.critica_grupo is not null and g.critica_grupo_spoiler),
         case when g.critica_grupo is not null then g.critica_grupo_volume end,
         case when not g.em_lote and 'notas_criticas' = any (g.escopo_amigos) then s.nota end,
         case when not g.em_lote and 'notas_criticas' = any (g.escopo_amigos) and not s.critica_privada then s.critica end,
         case when g.qtd > 1 and g.tem_melhor and g.melhor_capa is not null
              then case when g.melhor_capa like 'pub/%' then g.melhor_capa else regexp_replace(g.melhor_capa, '^.*/', '') end
         end,
         case when g.qtd > 1 and g.tem_melhor and g.melhor_capa is not null then g.melhor_id end,
         case when g.em_lote then g.feed_lote_id end,
         case when g.em_lote then (
           -- Os volumes do card, com nota e crítica como quem pede pode vê-las (a mesma regra do card de um volume).
           select jsonb_agg(jsonb_build_object(
                    'item_id', x.id,
                    'serie_nome', xs.nome,
                    'titulo', x.titulo,
                    'numero_volume', x.numero_volume,
                    'capa', case when x.capa_url like 'pub/%' then x.capa_url else regexp_replace(x.capa_url, '^.*/', '') end,
                    'nota', x.v_nota,
                    'critica', x.v_critica,
                    'critica_spoiler', (x.v_critica is not null and x.critica_spoiler)
                  ) order by xs.nome nulls last, x.numero_volume nulls last, x.titulo, x.id)
             from com_visao x
             left join series xs on xs.id = x.serie_id
            where x.em_lote and x.user_id = g.user_id and x.feed_lote_id = g.feed_lote_id
         ) end
    from grupos g
    left join series s on s.id = g.serie_id
   where g.rn = 1
     and (p_antes is null or g.marcado_em < p_antes)
   order by g.marcado_em desc, g.id
   limit least(greatest(coalesce(p_limite, 30), 1), 100)
$$;

-- ---------------------------------------------------------------------------------------------
-- notificacoes_listar: igual à 0033, com `lote_qtd` NO FIM (volumes do card de lote do aviso; nulo se não é lote).
-- O aviso continua apontando para o volume que representa o card (é nele que curtida e comentário ficam).
-- ---------------------------------------------------------------------------------------------
drop function notificacoes_listar(int, timestamptz);
create function notificacoes_listar(p_limite int default 50, p_antes timestamptz default null)
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
  lida boolean,
  -- nova (0035)
  lote_qtd int
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
         n.lida_em is not null,
         lt.qtd
    from privado.notificacoes_visiveis(auth.uid()) n
    left join perfis p on p.user_id = n.autor_id
    left join itens i on i.id = n.item_id
    left join series s on s.id = i.serie_id
    left join lateral (
      -- Volumes visíveis do lote do item, se o lote tem 2+ obras (o mesmo critério do card no feed).
      select count(*)::int as qtd
        from itens x
       where i.feed_lote_id is not null
         and x.user_id = i.user_id
         and x.feed_lote_id = i.feed_lote_id
         and x.estado = 'lido'
         and x.variante_de is null
         and not x.feed_oculto
         and x.lido_marcado_em is not null
         and x.lido_marcado_em > now() - interval '90 days'
      having count(distinct coalesce(x.serie_id::text, x.id::text)) >= 2
    ) lt on true
   where auth.uid() is not null
     and (p_antes is null or n.criado_em < p_antes)
   order by n.criado_em desc, n.id
   limit least(greatest(coalesce(p_limite, 50), 1), 100)
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissões: igual às anteriores; tudo exige login.
-- ---------------------------------------------------------------------------------------------
revoke all on all functions in schema privado from public, anon, authenticated;
revoke all on function itens_limpar_lote() from public, anon, authenticated;

revoke all on function feed_listar(int, timestamptz) from public, anon;
revoke all on function notificacoes_listar(int, timestamptz) from public, anon;
revoke all on function itens_marcar_lidos_lote(date, jsonb) from public, anon;

grant execute on function feed_listar(int, timestamptz) to authenticated;
grant execute on function notificacoes_listar(int, timestamptz) to authenticated;
grant execute on function itens_marcar_lidos_lote(date, jsonb) to authenticated;

commit;
