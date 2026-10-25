-- A view v_item_tags_efetivas rodava com os privilegios do dono e ignorava a RLS:
-- qualquer pessoa com a anon key (publica) lia item_id/tag_id de todos os usuarios.
-- O app nao usa a view (as tags efetivas sao montadas em src/lib/queries.ts).
drop view if exists v_item_tags_efetivas;
