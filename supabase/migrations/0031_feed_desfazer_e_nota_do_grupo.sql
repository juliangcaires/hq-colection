-- 0031 — feed: tirar o post inteiro (com desfazer e lista dos tirados) e nota/crítica no post de vários volumes
--
-- Pré-requisito: 0030 aplicada. Só ACRESCENTA: o app antigo continua funcionando com este banco (lê as colunas
-- de `feed_listar` pelo nome e segue chamando `feed_ocultar`, que não muda).
--
-- Problemas (nota 41 do Alfred, 20/11/2026):
--  1. O post "Você leu: 4 volumes de X" mostra UM volume (o último marcado), mas "Tirar do feed" escondia só esse
--     item: o post voltava com 3 volumes, sem aviso, e não havia como desfazer nem recolocar.
--     -> `feed_ocultar_post` tira o post inteiro (todos os volumes do mesmo dia e série) e devolve os ids tirados;
--        `feed_ocultar_varios` desfaz/recoloca por ids; `feed_ocultos_listar` lista o que está tirado para recolocar.
--  2. Nota e crítica dadas na marcação da série ("Marcar série como lida") não apareciam no post de vários volumes:
--     a tela só as mostrava com qtd = 1, e a nota dada só à série (modo `serie`) nem saía do banco.
--     -> `feed_listar` ganha colunas no fim: média das notas visíveis do grupo e quantos volumes têm nota, a crítica
--        visível mais recente do grupo (com o volume dela e o flag de spoiler) e nota/crítica da SÉRIE.
--     As regras de visibilidade são as de sempre: tudo só com `notas_criticas` no escopo de amigos; crítica privada
--     (do volume ou da série) nunca sai.

begin;

-- ---------------------------------------------------------------------------------------------
-- Tirar o post inteiro. Post de primeira leitura = volumes `lido` da mesma série marcados no mesmo dia (fuso de
-- São Paulo), como em `feed_listar`. Com `p_grupo = false` (ou item sem série) só o item. Devolve os ids tirados
-- para o app poder desfazer exatamente isso.
-- ---------------------------------------------------------------------------------------------
create or replace function feed_ocultar_post(p_item uuid, p_grupo boolean default true)
returns uuid[]
language plpgsql
security definer
set search_path = public, privado
as $$
declare
  i itens%rowtype;
  v_ids uuid[];
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  select * into i from itens where id = p_item and user_id = auth.uid();
  if not found then
    raise exception 'item_nao_encontrado';
  end if;

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
  else
    v_ids := '{}';
  end if;
  if not (i.id = any (v_ids)) then
    v_ids := array_append(v_ids, i.id);
  end if;

  update itens set feed_oculto = true where id = any (v_ids) and user_id = auth.uid();
  return v_ids;
end;
$$;

-- Desfaz / recoloca vários itens de uma vez (só os do próprio usuário). Devolve quantos mudaram.
create or replace function feed_ocultar_varios(p_itens uuid[], p_oculto boolean)
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
  if p_itens is null or p_oculto is null then
    raise exception 'valor_invalido';
  end if;
  if coalesce(array_length(p_itens, 1), 0) > 500 then
    raise exception 'itens_demais';
  end if;
  update itens set feed_oculto = p_oculto
   where id = any (p_itens) and user_id = auth.uid() and feed_oculto is distinct from p_oculto;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- O que o usuário tirou do feed e ainda poderia voltar (leitura marcada, ou releitura, nos últimos 90 dias),
-- agrupado como o post era (série + dia). `item_ids` é o que `feed_ocultar_varios(..., false)` recebe.
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
    select i.id, i.serie_id, i.titulo, i.numero_volume, i.tipo,
           coalesce(i.lido_marcado_em, i.updated_at) as ordem,
           case when i.lido_marcado_em is null then i.id::text
                else coalesce(i.serie_id::text, i.id::text) || '|' || (i.lido_marcado_em at time zone 'America/Sao_Paulo')::date::text
           end as grupo
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
  grupos as (
    select o.*,
           count(*) over w as qtd,
           row_number() over (w order by o.ordem desc, o.id) as rn,
           max(o.ordem) over w as marcado_em,
           array_agg(o.id) over w as ids
      from ocultos o
    window w as (partition by o.grupo)
  )
  select g.ids, g.id, s.nome, g.titulo, g.numero_volume, g.tipo, g.qtd::int, g.marcado_em
    from grupos g
    left join series s on s.id = g.serie_id
   where g.rn = 1
   order by g.marcado_em desc, g.id
   limit 100
$$;

-- ---------------------------------------------------------------------------------------------
-- feed_listar: igual à 0029, com colunas novas NO FIM (nota/crítica do grupo e da série).
-- O volume que representa o post e o item das curtidas/comentários não mudam.
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
  -- novas (0031)
  nota_media numeric,
  avaliados int,
  critica_grupo text,
  critica_grupo_spoiler boolean,
  critica_grupo_volume numeric,
  serie_nota numeric,
  serie_critica text
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
       and l.user_id = i.user_id
       and l.criado_em > now() - interval '90 days'
       and p.feed_ativo
       and i.estado = 'lido'
       and i.variante_de is null
       and not i.feed_oculto
       and (i.user_id = auth.uid() or privado.sao_amigos(auth.uid(), i.user_id))
  ),
  com_visao as (
    -- Nota e crítica como o amigo pode vê-las (a mesma regra de `v_itens`).
    select v.*,
           case when 'notas_criticas' = any (v.escopo_amigos) then v.nota end as v_nota,
           case when 'notas_criticas' = any (v.escopo_amigos) and not v.critica_privada then v.critica end as v_critica
      from visiveis v
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
           first_value(v.numero_volume) over wc as critica_grupo_volume
      from com_visao v
    window w as (partition by v.user_id, v.grupo, v.dia),
           wc as (partition by v.user_id, v.grupo, v.dia
                  order by (v.v_critica is null), v.ordem desc, v.id
                  rows between unbounded preceding and unbounded following)
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
         case when 'notas_criticas' = any (g.escopo_amigos) then s.nota end,
         case when 'notas_criticas' = any (g.escopo_amigos) and not s.critica_privada then s.critica end
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

revoke all on function feed_ocultar_post(uuid, boolean) from public, anon;
revoke all on function feed_ocultar_varios(uuid[], boolean) from public, anon;
revoke all on function feed_ocultos_listar() from public, anon;
revoke all on function feed_listar(int, timestamptz) from public, anon;

grant execute on function feed_ocultar_post(uuid, boolean) to authenticated;
grant execute on function feed_ocultar_varios(uuid[], boolean) to authenticated;
grant execute on function feed_ocultos_listar() to authenticated;
grant execute on function feed_listar(int, timestamptz) to authenticated;

commit;
