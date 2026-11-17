-- 0021: contas novas já nascem com `notas_criticas` no escopo dos amigos.
-- Sem isso o Feed, o bloco Amigos e o ranking dos amigos aparecem vazios para quem acabou de entrar.
--
-- Só muda o DEFAULT da coluna: vale para linhas de `perfis` criadas daqui para frente (o perfil nasce
-- sob demanda, em amigos_escopo_atualizar/feed_ativar etc., sempre sem informar o escopo).
-- NÃO há UPDATE em massa: quem já tem perfil fica exatamente como está (privacidade). A tela de
-- amigos mostra um aviso dispensável para quem tem amigos sem `notas_criticas` no escopo.
-- Crítica marcada como privada continua fora de qualquer compartilhamento (filtro nas funções 0018/0019).
begin;

alter table perfis
  alter column escopo_amigos set default array['colecao', 'series', 'lidos', 'notas_criticas']::text[];

commit;
