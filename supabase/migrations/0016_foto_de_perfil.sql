-- 0016 — foto de perfil
--
-- Pré-requisito: 0015 aplicada.
--
-- Bucket NOVO `avatares`, público para leitura (amigos e quem abre o link público precisam ver a foto sem
-- sessão; o nome do arquivo tem 128 bits aleatórios, então a URL não é adivinhável). Escrita só do dono:
-- o primeiro segmento do caminho tem de ser o próprio `auth.uid()`. O app grava `<uid>/<32 hex>.<ext>`
-- (já redimensionado, sem metadados) e guarda a URL pública em `perfis.avatar_url` (coluna da 0012).

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatares', 'avatares', true, 307200, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Cada usuário mexe só na própria pasta, e só com nome no formato do app.
create policy "avatares_dono_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatares_dono_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatares'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f]{32}\.(jpg|png|webp)$'
  );

create policy "avatares_dono_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatares_dono_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------------------------
-- Quem aparece para os outros: a lista de amigos e o resumo (amigo e link público) passam a trazer a foto.
-- ---------------------------------------------------------------------------------------------
drop function if exists amigos_listar();
create function amigos_listar()
returns table (amizade_id uuid, status text, direcao text, apelido text, nome_exibicao text, avatar_url text)
language sql
stable
security definer
set search_path = public, privado
as $$
  select a.id, a.status,
         case when a.status = 'aceita' then 'amigo'
              when a.solicitante = auth.uid() then 'enviada'
              else 'recebida' end,
         p.apelido, p.nome_exibicao, p.avatar_url
    from amizades a
    left join perfis p on p.user_id = case when a.solicitante = auth.uid() then a.destinatario else a.solicitante end
   where auth.uid() in (a.solicitante, a.destinatario)
   order by (a.status = 'pendente') desc, lower(coalesce(p.nome_exibicao, p.apelido)), a.id
$$;
revoke all on function amigos_listar() from public, anon;
grant execute on function amigos_listar() to authenticated;

create or replace function privado.v_resumo(p_dono uuid, p_escopo text[])
returns jsonb
language sql
stable
security definer
set search_path = public, privado
as $$
  select jsonb_build_object(
    'nome', coalesce(p.nome_exibicao, p.apelido, 'Colecionador'),
    'apelido', p.apelido,
    'avatar_url', p.avatar_url,
    'escopo', to_jsonb(p_escopo),
    'colecao', case when 'colecao' = any (p_escopo) then (select count(*) from itens i where i.user_id = p_dono and i.estado <> 'desejo') end,
    'lidos', case when 'lidos' = any (p_escopo) then (select count(*) from itens i where i.user_id = p_dono and i.estado = 'lido') end,
    'desejos', case when 'desejos' = any (p_escopo) then (select count(*) from itens i where i.user_id = p_dono and i.estado = 'desejo') end,
    'series', case when 'series' = any (p_escopo) then (select count(*) from series s where s.user_id = p_dono
                 and exists (select 1 from itens i where i.serie_id = s.id and i.estado <> 'desejo')) end
  )
  from (select 1) _
  left join perfis p on p.user_id = p_dono
$$;

commit;
