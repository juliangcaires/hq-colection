-- 0020 — casar a mesma obra por ISBN e por vínculo manual (continuação da 0019; ver ESTUDO-OBRA-ENTRE-USUARIOS)
--
-- Pré-requisito: 0019 aplicada.
--
-- 1) `obra_amigos` passa a casar também pelo ISBN-13 (edicoes.isbn13 ou itens.isbn, limpo e normalizado; ISBN-10 vira
--    ISBN-13), mesmo com `obra_chave` diferente ("Absolute Batman" x "Batman Absolute"). Segue UMA linha por amigo.
-- 2) Vínculo manual "é a mesma obra que...": tabela `obra_equivalencias`, do USUÁRIO e só na visão dele. Escrever só
--    pelas funções abaixo (que exigem amizade aceita e item que o amigo já compartilha); ler e desfazer: só o dono.
--    `casou_por`: 'isbn' > 'nome' (mesma chave) > 'manual'.
-- Séries ficam de fora do vínculo manual (a série não tem ISBN e o vínculo é por volume).

begin;

-- ISBN → ISBN-13 só com dígitos (ISBN-10 é convertido); null se não parecer ISBN.
create or replace function privado.isbn13_norm(p text)
returns text
language sql
immutable
set search_path = public
as $$
  with c as (select upper(regexp_replace(coalesce(p, ''), '[^0-9Xx]', '', 'g')) as v),
  base as (select '978' || substr(v, 1, 9) as b from c where v ~ '^[0-9]{9}[0-9X]$')
  select case
    when (select v from c) ~ '^97[89][0-9]{10}$' then (select v from c)
    else (select b || ((10 - (select sum(substr(b, n, 1)::int * case when n % 2 = 1 then 1 else 3 end)
                                from generate_series(1, 12) n) % 10) % 10)::text
            from base)
  end
$$;

-- O amigo (aceito) de `p_viewer` tem item com esta chave que ele já compartilha (coleção ou lidos)?
create or replace function privado.obra_visivel_de_amigo(p_viewer uuid, p_chave text)
returns boolean
language sql
stable
security definer
set search_path = public, privado
as $$
  select exists (
    select 1
      from itens i
      join perfis p on p.user_id = i.user_id
     where p_chave is not null and p_chave <> ''
       and i.obra_chave = p_chave
       and i.variante_de is null
       and privado.sao_amigos(p_viewer, i.user_id)
       and ((i.estado in ('comprado', 'lido') and 'colecao' = any (p.escopo_amigos))
         or (i.estado = 'lido' and 'lidos' = any (p.escopo_amigos)))
  )
$$;

create table obra_equivalencias (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  obra_chave text not null check (obra_chave <> '' and length(obra_chave) <= 300),
  obra_chave_amigo text not null check (obra_chave_amigo <> '' and length(obra_chave_amigo) <= 300 and obra_chave_amigo <> obra_chave),
  created_at timestamptz not null default now(),
  primary key (user_id, obra_chave, obra_chave_amigo)
);

alter table obra_equivalencias enable row level security;
create policy "equivalencias_dono_le" on obra_equivalencias for select to authenticated using (user_id = auth.uid());
create policy "equivalencias_dono_apaga" on obra_equivalencias for delete to authenticated using (user_id = auth.uid());
revoke all on obra_equivalencias from public, anon;
revoke insert, update, truncate on obra_equivalencias from authenticated;
grant select, delete on obra_equivalencias to authenticated;

-- Criar o vínculo: a obra é do usuário e a do amigo precisa ser de um amigo aceito, compartilhada.
create or replace function obra_equivalencia_criar(p_obra_chave text, p_chave_amigo text)
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if coalesce(p_obra_chave, '') = '' or coalesce(p_chave_amigo, '') = '' or p_obra_chave = p_chave_amigo then
    raise exception 'equivalencia_invalida';
  end if;
  if not exists (select 1 from itens where user_id = auth.uid() and obra_chave = p_obra_chave) then
    raise exception 'item_nao_encontrado';
  end if;
  if not privado.obra_visivel_de_amigo(auth.uid(), p_chave_amigo) then
    raise exception 'equivalencia_obra_indisponivel';
  end if;
  if (select count(*) from obra_equivalencias where user_id = auth.uid() and obra_chave = p_obra_chave) >= 20 then
    raise exception 'equivalencia_limite';
  end if;
  insert into obra_equivalencias (user_id, obra_chave, obra_chave_amigo)
  values (auth.uid(), p_obra_chave, p_chave_amigo)
  on conflict do nothing;
end;
$$;

create or replace function obra_equivalencia_desfazer(p_obra_chave text, p_chave_amigo text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from obra_equivalencias
   where user_id = auth.uid() and obra_chave = p_obra_chave and obra_chave_amigo = p_chave_amigo
$$;

-- Busca entre os itens dos amigos (só o que eles compartilham): um resultado por amigo e obra.
create or replace function amigos_buscar_obras(p_termo text)
returns table (
  dono_id uuid,
  apelido text,
  nome_exibicao text,
  obra_chave text,
  titulo text,
  numero_volume numeric,
  serie_nome text
)
language sql
stable
security definer
set search_path = public, privado
as $$
  select * from (
    select distinct on (i.user_id, i.obra_chave)
           i.user_id, p.apelido, p.nome_exibicao, i.obra_chave, i.titulo, i.numero_volume, s.nome
      from itens i
      join perfis p on p.user_id = i.user_id
      left join series s on s.id = i.serie_id
     where auth.uid() is not null
       and length(btrim(coalesce(p_termo, ''))) >= 2
       and i.obra_chave is not null
       and i.variante_de is null
       and privado.sao_amigos(auth.uid(), i.user_id)
       and ((i.estado in ('comprado', 'lido') and 'colecao' = any (p.escopo_amigos))
         or (i.estado = 'lido' and 'lidos' = any (p.escopo_amigos)))
       and (i.titulo ilike '%' || replace(replace(replace(btrim(p_termo), '\', '\\'), '%', '\%'), '_', '\_') || '%'
         or s.nome ilike '%' || replace(replace(replace(btrim(p_termo), '\', '\\'), '%', '\%'), '_', '\_') || '%')
     order by i.user_id, i.obra_chave, i.created_at desc
  ) r
  order by r.apelido, r.titulo, r.numero_volume nulls last
  limit 20
$$;

-- Vínculos do usuário para uma obra dele, com o item do amigo que ainda aparece (null = amigo/itens indisponíveis).
create or replace function obra_equivalencias_listar(p_obra_chave text)
returns table (
  obra_chave_amigo text,
  apelido text,
  nome_exibicao text,
  titulo text,
  numero_volume numeric,
  serie_nome text
)
language sql
stable
security definer
set search_path = public, privado
as $$
  select oe.obra_chave_amigo, f.apelido, f.nome_exibicao, f.titulo, f.numero_volume, f.serie_nome
    from obra_equivalencias oe
    left join lateral (
      select p.apelido, p.nome_exibicao, i.titulo, i.numero_volume, s.nome as serie_nome
        from itens i
        join perfis p on p.user_id = i.user_id
        left join series s on s.id = i.serie_id
       where i.obra_chave = oe.obra_chave_amigo
         and i.variante_de is null
         and privado.sao_amigos(auth.uid(), i.user_id)
       order by i.created_at desc
       limit 1
    ) f on true
   where oe.user_id = auth.uid() and oe.obra_chave = p_obra_chave
   order by oe.created_at
$$;

-- ---------------------------------------------------------------------------------------------
-- obra_amigos: mesma assinatura e colunas da 0019; casa por ISBN, por chave e por vínculo manual.
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
  meu as (select privado.isbn13_norm(p_isbn) as isbn),
  eq as (
    select oe.obra_chave_amigo as chave
      from obra_equivalencias oe
     where oe.user_id = auth.uid() and oe.obra_chave = p_obra_chave and coalesce(p_obra_chave, '') <> ''
  ),
  candidatos as (
    select i.id, i.user_id, i.lido_marcado_em, i.updated_at,
           case
             when (select isbn from meu) is not null
                  and (privado.isbn13_norm(e.isbn13) = (select isbn from meu) or privado.isbn13_norm(i.isbn) = (select isbn from meu)) then 'isbn'
             when coalesce(p_obra_chave, '') <> '' and i.obra_chave = p_obra_chave then 'nome'
             when i.obra_chave in (select chave from eq) then 'manual'
           end as por
      from itens i
      join amigos am on am.id = i.user_id
      left join edicoes e on e.id = i.edicao_id
     where i.estado = 'lido'
       and i.variante_de is null
       and exists (select 1 from privado.v_avaliacao(i.id, auth.uid()) v where v.nota is not null or v.critica is not null)
  ),
  escolhidos as (
    select distinct on (c.user_id) c.id, c.user_id, c.por
      from candidatos c
     where c.por is not null
     order by c.user_id, case c.por when 'isbn' then 1 when 'nome' then 2 else 3 end, c.lido_marcado_em desc nulls last, c.updated_at desc, c.id
  )
  select c.id,
         c.user_id,
         p.apelido,
         p.nome_exibicao,
         p.avatar_url,
         v.nota,
         v.critica,
         v.lido_em,
         c.por,
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

revoke all on all functions in schema privado from public, anon, authenticated;

revoke all on function obra_amigos(text, text) from public, anon;
revoke all on function obra_equivalencia_criar(text, text) from public, anon;
revoke all on function obra_equivalencia_desfazer(text, text) from public, anon;
revoke all on function amigos_buscar_obras(text) from public, anon;
revoke all on function obra_equivalencias_listar(text) from public, anon;

grant execute on function obra_amigos(text, text) to authenticated;
grant execute on function obra_equivalencia_criar(text, text) to authenticated;
grant execute on function obra_equivalencia_desfazer(text, text) to authenticated;
grant execute on function amigos_buscar_obras(text) to authenticated;
grant execute on function obra_equivalencias_listar(text) to authenticated;

commit;
