-- 0034 — endurecer o Web Push e esconder o aviso de amizade de ex-amigo
--
-- Pré-requisito: 0033 aplicada. SÓ troca duas funções com `create or replace` (mesma assinatura, mesmas colunas):
-- o app antigo continua funcionando com este banco, e nenhuma tabela ou dado muda.
--
--  1. `push_assinar` aceita só endpoint https dos serviços de push dos navegadores: o servidor do app faz POST para
--     esse endereço, então um endereço livre seria um pedido a um destino escolhido pelo usuário (SSRF cego).
--       - fcm.googleapis.com ................ Chrome / Android
--       - *.push.services.mozilla.com ....... Firefox
--       - *.push.apple.com .................. Safari / iPhone (web.push.apple.com)
--       - *.notify.windows.com .............. Edge / Windows (WNS)
--     Só o host é comparado (letras minúsculas ou maiúsculas, porta :443 opcional, sem usuário nem senha). O servidor do
--     app valida a mesma lista antes de enviar (`src/lib/push-endpoint.ts`). Assinaturas já gravadas com outro host
--     não são mexidas aqui; o envio as ignora e apaga.
--  2. `privado.notificacoes_visiveis` (usada por `notificacoes_listar` e `notificacoes_contar_nao_lidas`, que por isso
--     seguem iguais e sempre concordam) esconde `amizade_aceita` quando as duas pessoas não são mais amigas. Se
--     voltarem a ser amigas, o aviso antigo volta a aparecer.

begin;

create or replace function push_assinar(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql
security definer
set search_path = public, privado
as $$
begin
  if auth.uid() is null then
    raise exception 'nao_autenticado';
  end if;
  if p_endpoint is null or char_length(p_endpoint) > 2048
     or p_endpoint !~* '^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)+push\.services\.mozilla\.com|([a-z0-9-]+\.)+push\.apple\.com|([a-z0-9-]+\.)+notify\.windows\.com)(:443)?(/|$)'
     or coalesce(char_length(p_p256dh), 0) not between 1 and 256 or coalesce(char_length(p_auth), 0) not between 1 and 256 then
    raise exception 'push_assinatura_invalida';
  end if;
  insert into push_assinaturas (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 400))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
  insert into push_preferencias (user_id) values (auth.uid()) on conflict do nothing;
end;
$$;

-- Pedido de amizade vale sempre; "aceitou seu pedido" só enquanto são amigos; curtida e comentário como antes.
create or replace function privado.notificacoes_visiveis(p_user uuid)
returns setof notificacoes
language sql
stable
security definer
set search_path = public, privado
as $$
  select n.*
    from notificacoes n
   where n.user_id = p_user
     and (
       n.tipo = 'amizade_pedido'
       or (n.tipo = 'amizade_aceita' and privado.sao_amigos(p_user, n.autor_id))
       or (n.tipo in ('curtida', 'comentario') and privado.sao_amigos(p_user, n.autor_id) and privado.feed_item_visivel(p_user, n.item_id))
     )
$$;

commit;
