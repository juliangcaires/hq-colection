-- Editora deixa de ser coluna livre na série e vira só mais um tipo de tag
-- (igual personagem/arco/selo/autor/universo), evitando duplicidade com o
-- sistema de tags. Ver PLANO-APP-COLECAO.md seção 4 — editora já era
-- prevista como tag na heurística de migração do Notion (seção 8).

-- 1. cria a tag de editora para cada valor livre já preenchido
insert into tags (user_id, nome, tipo)
select distinct user_id, editora, 'editora'::tipo_tag
from series
where editora is not null and trim(editora) <> ''
on conflict (user_id, nome, tipo) do nothing;

-- 2. vincula cada série à tag de editora correspondente
insert into serie_tags (serie_id, tag_id)
select s.id, t.id
from series s
join tags t
  on t.user_id = s.user_id
  and t.nome = s.editora
  and t.tipo = 'editora'
where s.editora is not null and trim(s.editora) <> ''
on conflict (serie_id, tag_id) do nothing;

-- 3. remove a coluna duplicada
alter table series drop column editora;
