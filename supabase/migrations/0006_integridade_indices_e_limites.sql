-- 0006 — integridade, índices e limites do bucket (auditoria: B-04, S-10, S-03, P-05)
--
-- Seguro de rodar uma vez no SQL Editor. Idempotente onde possível.
-- Antes de rodar, conferi nos dados reais: nenhuma tag duplicada (o índice único não falha).

begin;

-- B-04 · tags: o importador já compara sem caixa; o banco passa a exigir o mesmo.
-- (Séries NÃO ganham índice único em nome: o app prevê séries homônimas de editoras diferentes.)
create unique index if not exists uq_tags_user_tipo_lower_nome
  on tags (user_id, tipo, lower(nome));

-- P-05 · índices que faltavam (chaves estrangeiras e ordenações das telas)
create index if not exists idx_itens_serie on itens (serie_id);
create index if not exists idx_itens_user_created on itens (user_id, created_at desc);
create index if not exists idx_itens_user_estado_prioridade on itens (user_id, estado, prioridade desc);
create index if not exists idx_item_tags_tag on item_tags (tag_id);
create index if not exists idx_serie_tags_tag on serie_tags (tag_id);

-- P-05 / S-10 · policies: `(select auth.uid())` é avaliado uma vez por consulta (não por linha),
-- e as tabelas filhas passam a exigir que TODOS os pais sejam do usuário.
drop policy if exists "series_owner" on series;
create policy "series_owner" on series
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "tags_owner" on tags;
create policy "tags_owner" on tags
  for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- itens.serie_id, quando preenchido, precisa ser uma série do próprio usuário.
drop policy if exists "itens_owner" on itens;
create policy "itens_owner" on itens
  for all using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      serie_id is null
      or exists (select 1 from series s where s.id = itens.serie_id and s.user_id = (select auth.uid()))
    )
  );

drop policy if exists "serie_tags_owner" on serie_tags;
create policy "serie_tags_owner" on serie_tags
  for all using (
    exists (select 1 from series s where s.id = serie_tags.serie_id and s.user_id = (select auth.uid()))
  ) with check (
    exists (select 1 from series s where s.id = serie_tags.serie_id and s.user_id = (select auth.uid()))
    and exists (select 1 from tags t where t.id = serie_tags.tag_id and t.user_id = (select auth.uid()))
  );

drop policy if exists "item_tags_owner" on item_tags;
create policy "item_tags_owner" on item_tags
  for all using (
    exists (select 1 from itens i where i.id = item_tags.item_id and i.user_id = (select auth.uid()))
  ) with check (
    exists (select 1 from itens i where i.id = item_tags.item_id and i.user_id = (select auth.uid()))
    and exists (select 1 from tags t where t.id = item_tags.tag_id and t.user_id = (select auth.uid()))
  );

-- S-03 · bucket de capas: teto de 5 MB e só imagens (o código já valida; isto é a segunda trava).
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'capas';

commit;
