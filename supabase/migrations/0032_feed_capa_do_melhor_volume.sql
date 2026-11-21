-- 0032 — feed: o card "Você leu N volumes" mostra a capa do melhor volume da série
--
-- Pré-requisito: 0031 aplicada (e, por ela, a 0030: `itens.melhor_da_serie`). Só ACRESCENTA: o app antigo continua
-- funcionando com este banco (lê as colunas de `feed_listar` pelo nome; `capa`, `item_id` e o resto não mudam).
--
-- Ideia do Julian (20/11/2026): o card agrupado mostrava a capa do último volume marcado (o #4); ele quer a do volume
-- marcado como melhor da série (a coroa, o #5).
--  * `feed_listar` ganha, NO FIM, `capa_destaque` (mesmo formato de `capa`) e `capa_destaque_item` (o volume de onde
--    ela vem). A capa NÃO é gravada no post: sai do melhor volume na hora de listar, então acompanha o melhor ser
--    marcado, trocado ou desmarcado depois.
--  * Só vale para card de VÁRIOS volumes (qtd > 1) e só se o melhor volume está entre os volumes do card (mesma série,
--    mesmo dia, visíveis no feed). Melhor volume de outro dia não entra: a capa seria de um volume que o card não cita.
--    Sem melhor volume no card (ou o melhor sem capa): as colunas vêm nulas e o app mostra a capa de sempre.
--  * Visibilidade: a marca "melhor da série" é a mesma da vitrine (0030): o amigo só a enxerga com `notas_criticas` +
--    `lidos` no escopo; o dono vê sempre a própria. Sem isso, o card cai na capa de sempre (a capa não revela a marca).
--  * A capa privada continua saindo por `/feed/capa/<item>` (`feed_capa`, que já exige o item visível no feed): o app
--    passa a pedir pelo id do melhor volume (`capa_destaque_item`), que é um item visível do mesmo post.

begin;

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
  -- novas (0032)
  capa_destaque text,
  capa_destaque_item uuid
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
           i.critica_privada, i.critica_spoiler, l.lido_em, l.criado_em as ordem, i.melhor_da_serie,
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
           case when 'notas_criticas' = any (v.escopo_amigos) and not v.critica_privada then v.critica end as v_critica,
           -- Marca de melhor da série como quem pede pode vê-la (a regra da vitrine, 0030): o dono vê a sua;
           -- o amigo precisa de `notas_criticas` + `lidos` no escopo.
           (v.melhor_da_serie
              and (v.user_id = auth.uid()
                   or ('notas_criticas' = any (v.escopo_amigos) and 'lidos' = any (v.escopo_amigos)))) as v_melhor
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
         case when 'notas_criticas' = any (g.escopo_amigos) and not s.critica_privada then s.critica end,
         case when g.qtd > 1 and g.tem_melhor and g.melhor_capa is not null
              then case when g.melhor_capa like 'pub/%' then g.melhor_capa else regexp_replace(g.melhor_capa, '^.*/', '') end
         end,
         case when g.qtd > 1 and g.tem_melhor and g.melhor_capa is not null then g.melhor_id end
    from grupos g
    left join series s on s.id = g.serie_id
   where g.rn = 1
     and (p_antes is null or g.marcado_em < p_antes)
   order by g.marcado_em desc, g.id
   limit least(greatest(coalesce(p_limite, 30), 1), 100)
$$;

-- ---------------------------------------------------------------------------------------------
-- Permissões: igual às anteriores; exige login.
-- ---------------------------------------------------------------------------------------------
revoke all on all functions in schema privado from public, anon, authenticated;

revoke all on function feed_listar(int, timestamptz) from public, anon;
grant execute on function feed_listar(int, timestamptz) to authenticated;

commit;
