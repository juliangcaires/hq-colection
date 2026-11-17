-- 0019 — notas entre amigos (D7 do estudo ESTUDO-OBRA-ENTRE-USUARIOS)
--
-- Pré-requisito: 0018 aplicada.
--
-- Não há tabela de avaliações: a avaliação JÁ É `itens.nota`/`critica` e `series.nota`/`critica`. O que faltava era
-- consultar por obra entre AMIGOS. A identidade da obra é uma chave normalizada calculada no app (`chaveObra`,
-- `chaveSerie` em src/lib/texto.ts) e gravada aqui; itens/séries antigos recebem a chave sob demanda pelo app.
-- Curtidas e comentários reaproveitam as tabelas do feed (0018): sem estrutura nova.
-- Só amigos aceitos, checado a cada chamada (desfazer a amizade corta na hora). Sem página pública.

begin;

alter table itens add column obra_chave text;
alter table series add column serie_chave text;
create index idx_itens_obra_chave on itens (obra_chave) where obra_chave is not null;
create index idx_series_serie_chave on series (serie_chave) where serie_chave is not null;

-- ---------------------------------------------------------------------------------------------
-- item_salvar / serie_salvar gravam a chave (chave ausente em edição mantém o valor atual).
-- Corpos das versões vigentes (0017 e 0013), só com o campo novo.
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
                       preco, loja, data_aquisicao, nota, critica, lido_em, edicao_id, critica_privada, variante_de, obra_chave)
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
      nullif(p_dados->>'edicao_id', '')::uuid,
      coalesce((p_dados->>'critica_privada')::boolean, false),
      nullif(p_dados->>'variante_de', '')::uuid,
      nullif(p_dados->>'obra_chave', '')
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
      edicao_id = case when p_dados ? 'edicao_id' then nullif(p_dados->>'edicao_id', '')::uuid else edicao_id end,
      critica_privada = case when p_dados ? 'critica_privada' then coalesce((p_dados->>'critica_privada')::boolean, false) else critica_privada end,
      variante_de = case when p_dados ? 'variante_de' then nullif(p_dados->>'variante_de', '')::uuid else variante_de end,
      obra_chave = case when p_dados ? 'obra_chave' then nullif(p_dados->>'obra_chave', '') else obra_chave end
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

create or replace function serie_salvar(p_id uuid, p_dados jsonb, p_tag_ids uuid[])
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_id is null then
    insert into series (user_id, nome, tipo, total_volumes, em_publicacao, tem_numeracao, observacoes, critica_privada, serie_chave)
    values (
      auth.uid(),
      p_dados->>'nome',
      (p_dados->>'tipo')::tipo_obra,
      (p_dados->>'total_volumes')::int,
      coalesce((p_dados->>'em_publicacao')::boolean, true),
      coalesce((p_dados->>'tem_numeracao')::boolean, false),
      nullif(p_dados->>'observacoes', ''),
      coalesce((p_dados->>'critica_privada')::boolean, false),
      nullif(p_dados->>'serie_chave', '')
    )
    returning id into v_id;
  else
    update series set
      nome = p_dados->>'nome',
      tipo = (p_dados->>'tipo')::tipo_obra,
      total_volumes = (p_dados->>'total_volumes')::int,
      em_publicacao = coalesce((p_dados->>'em_publicacao')::boolean, true),
      tem_numeracao = coalesce((p_dados->>'tem_numeracao')::boolean, false),
      observacoes = nullif(p_dados->>'observacoes', ''),
      critica_privada = case when p_dados ? 'critica_privada' then coalesce((p_dados->>'critica_privada')::boolean, false) else critica_privada end,
      serie_chave = case when p_dados ? 'serie_chave' then nullif(p_dados->>'serie_chave', '') else serie_chave end
    where id = p_id
    returning id into v_id;

    if v_id is null then
      raise exception 'serie_nao_encontrada';
    end if;
    delete from serie_tags where serie_id = v_id;
  end if;

  insert into serie_tags (serie_id, tag_id)
  select v_id, t from unnest(coalesce(p_tag_ids, '{}')) as t
  on conflict do nothing;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Regra única do que o visitante enxerga de uma avaliação de amigo (a mesma de `privado.v_itens`):
-- só amigo aceito; item lido; nota e crítica só com `notas_criticas` no escopo; crítica privada nunca sai;
-- data de leitura só com `lidos` no escopo. Sem linha = nada a mostrar.
-- ---------------------------------------------------------------------------------------------
create or replace function privado.v_avaliacao(p_item uuid, p_viewer uuid)
returns table (nota numeric, critica text, lido_em date)
language sql
stable
security definer
set search_path = public, privado
as $$
  select i.nota,
         case when not i.critica_privada then i.critica end,
         case when 'lidos' = any (p.escopo_amigos) then i.lido_em end
    from itens i
    join perfis p on p.user_id = i.user_id
   where i.id = p_item
     and i.estado = 'lido'
     and 'notas_criticas' = any (p.escopo_amigos)
     and privado.sao_amigos(p_viewer, i.user_id)
$$;

-- ---------------------------------------------------------------------------------------------
-- Amigos que leram a mesma obra (volume): uma linha por amigo, só quem tem nota ou crítica visível.
-- Variante não conta (o principal basta); amigo com duas edições do volume entra uma vez, pela leitura mais recente.
-- `casou_por`: 'isbn' se o ISBN do item do visitante (p_isbn) é o do amigo, senão 'nome'.
-- `interagivel`: curtir/comentar só onde o item aparece no feed (feed ligado, 90 dias, não oculto).
-- ---------------------------------------------------------------------------------------------
create or replace function obra_amigos(p_obra_chave text, p_isbn text default null)
returns table (
  item_id uuid,
  dono_id uuid,
  apelido text,
  nome_exibicao text,
  avatar_url text,
  nota numeric,
  critica text,
  lido_em date,
  casou_por text,
  interagivel boolean,
  curtidas int,
  curti boolean,
  comentarios int
)
language sql
stable
security definer
set search_path = public, privado
as $$
  with amigos as (
    select case when a.solicitante = auth.uid() then a.destinatario else a.solicitante end as id
      from amizades a
     where auth.uid() is not null
       and a.status = 'aceita'
       and auth.uid() in (a.solicitante, a.destinatario)
  ),
  escolhidos as (
    select distinct on (i.user_id) i.id, i.user_id, coalesce(e.isbn13, i.isbn) as isbn_amigo
      from itens i
      join amigos am on am.id = i.user_id
      left join edicoes e on e.id = i.edicao_id
     where p_obra_chave is not null and p_obra_chave <> ''
       and i.obra_chave = p_obra_chave
       and i.estado = 'lido'
       and i.variante_de is null
       and exists (select 1 from privado.v_avaliacao(i.id, auth.uid()) v where v.nota is not null or v.critica is not null)
     order by i.user_id, i.lido_marcado_em desc nulls last, i.updated_at desc, i.id
  )
  select c.id,
         c.user_id,
         p.apelido,
         p.nome_exibicao,
         p.avatar_url,
         v.nota,
         v.critica,
         v.lido_em,
         case when nullif(p_isbn, '') is not null and c.isbn_amigo = p_isbn then 'isbn' else 'nome' end,
         privado.feed_item_visivel(auth.uid(), c.id),
         (select count(*)::int from feed_curtidas k
           where k.item_id = c.id and privado.feed_autor_visivel(auth.uid(), c.user_id, k.user_id)),
         exists (select 1 from feed_curtidas k where k.item_id = c.id and k.user_id = auth.uid()),
         (select count(*)::int from feed_comentarios m
           where m.item_id = c.id and privado.feed_autor_visivel(auth.uid(), c.user_id, m.user_id))
    from escolhidos c
    join perfis p on p.user_id = c.user_id
    cross join lateral privado.v_avaliacao(c.id, auth.uid()) v
   order by v.nota desc nulls last, p.apelido
$$;

-- ---------------------------------------------------------------------------------------------
-- Amigos que avaliaram a mesma série. Regra da 0009: a nota da série do amigo ou, sem ela, a média dos volumes
-- lidos e avaliados dele (variante fora). Crítica da série só se não for privada.
-- ---------------------------------------------------------------------------------------------
create or replace function serie_amigos(p_serie_chave text)
returns table (
  dono_id uuid,
  apelido text,
  nome_exibicao text,
  avatar_url text,
  nota numeric,
  critica text
)
language sql
stable
security definer
set search_path = public, privado
as $$
  with amigos as (
    select case when a.solicitante = auth.uid() then a.destinatario else a.solicitante end as id
      from amizades a
     where auth.uid() is not null
       and a.status = 'aceita'
       and auth.uid() in (a.solicitante, a.destinatario)
  ),
  candidatas as (
    select distinct on (s.user_id)
           s.user_id,
           coalesce(s.nota, (select round(avg(i.nota), 1) from itens i
                              where i.serie_id = s.id and i.estado = 'lido' and i.nota is not null and i.variante_de is null)) as nota,
           case when not s.critica_privada then s.critica end as critica
      from series s
      join amigos am on am.id = s.user_id
      join perfis p on p.user_id = s.user_id
     where p_serie_chave is not null and p_serie_chave <> ''
       and s.serie_chave = p_serie_chave
       and 'notas_criticas' = any (p.escopo_amigos)
     order by s.user_id, (s.nota is not null) desc, s.created_at desc, s.id
  )
  select c.user_id, p.apelido, p.nome_exibicao, p.avatar_url, c.nota, c.critica
    from candidatas c
    join perfis p on p.user_id = c.user_id
   where c.nota is not null or c.critica is not null
   order by c.nota desc nulls last, p.apelido
$$;

revoke all on all functions in schema privado from public, anon, authenticated;

revoke all on function item_salvar(uuid, jsonb, uuid[]) from public, anon;
revoke all on function serie_salvar(uuid, jsonb, uuid[]) from public, anon;
revoke all on function obra_amigos(text, text) from public, anon;
revoke all on function serie_amigos(text) from public, anon;

grant execute on function item_salvar(uuid, jsonb, uuid[]) to authenticated;
grant execute on function serie_salvar(uuid, jsonb, uuid[]) to authenticated;
grant execute on function obra_amigos(text, text) to authenticated;
grant execute on function serie_amigos(text) to authenticated;

commit;
