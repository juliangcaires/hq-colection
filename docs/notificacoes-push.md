# Notificações: sininho no app e Web Push

Pedido de 20/11/2026: avisar no app **e no celular**, **sem e-mail** (não há envio de e-mail e não deve haver).

## O que existe

| Evento | Quem é avisado | Texto no app | Texto do push (sem spoiler) |
|---|---|---|---|
| Curtida numa leitura do feed | dono da leitura | "Beto curtiu sua leitura de *Obra*" | "Beto curtiu sua leitura" |
| Comentário numa leitura do feed | dono da leitura | "Ana comentou na sua leitura de *Obra*" | "Ana comentou na sua leitura" |
| Pedido de amizade recebido | destinatário | "Carla enviou um pedido de amizade" | igual |
| Amizade aceita | quem pediu | "Dani aceitou seu pedido de amizade" | igual |

Nunca vão para a notificação: nota, crítica nem o texto do comentário. O banco só guarda ids; o texto é montado na tela.
O texto de amizade é neutro quanto ao gênero de propósito.

## Como funciona

1. **Banco (migration `0033_notificacoes.sql`)** — a tabela `notificacoes` é preenchida por *trigger* em `feed_curtidas`,
   `feed_comentarios` e `amizades`; `feed_curtir`/`feed_comentar`/`amizade_*` não mudaram (o app antigo segue funcionando).
   Regras: a própria ação não notifica; uma curtida por autor + item (curtir de novo depois de lida não duplica); um aviso por
   comentário; descurtir, apagar o comentário ou recusar/cancelar o pedido apaga o aviso **não lido**.
   Só se lê pelas funções `notificacoes_listar`, `notificacoes_contar_nao_lidas` e `notificacoes_marcar_lidas`
   (curtida/comentário só aparecem enquanto o item ainda está visível no feed e o autor segue sendo amigo).
   `push_assinaturas` (um aparelho por *endpoint*) e `push_preferencias` (interruptores por tipo, padrão ligado) guardam o push.
2. **App** — sininho no cabeçalho (celular) e na barra lateral (desktop), contador atualizado ao trocar de tela, ao voltar para
   a aba e a cada minuto, e a tela `/notificacoes` (marcar uma ao abrir ou todas de uma vez).
3. **Push** — `public/sw.js` (service worker: mostra o aviso e abre o app no clique), seção "Notificações" em `/configuracoes`
   e envio **no servidor** (`src/lib/push.ts`, `src/lib/push-servidor.ts`) logo depois de `curtir`, `comentar`, `solicitarAmizade`,
   `responderAmizade` (aceitando) e `aceitarConvite`. O envio nunca faz a ação falhar: erro de push é só registrado, e
   assinatura que o serviço de push responde 404/410 é apagada.

## Configurar o Web Push (uma vez)

1. Gerar o par de chaves VAPID (na sua máquina, **não** commitar):

   ```bash
   npx web-push generate-vapid-keys
   ```

2. Na Netlify (*Site configuration → Environment variables*) criar:

   | Variável | Valor | Observação |
   |---|---|---|
   | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | a *Public Key* gerada | vai para o navegador; é lida no servidor e repassada à tela de Configurações |
   | `VAPID_PRIVATE_KEY` | a *Private Key* gerada | **só servidor**, nunca com o prefixo `NEXT_PUBLIC_` |
   | `VAPID_SUBJECT` | `mailto:seu-email@exemplo.com` (ou uma URL `https://`) | contato exigido pelo serviço de push |
   | `SUPABASE_SERVICE_ROLE_KEY` | já existe se as capas de amigos funcionam | o envio usa para ler as assinaturas do destinatário |

   Para testar localmente, as mesmas variáveis em `.env.local` (já ignorado pelo git).
3. Aplicar a migration **antes** do deploy (`supabase db push`) e fazer um novo deploy para as variáveis valerem.
4. Sem qualquer uma das variáveis o botão some e a seção avisa "indisponível": o sininho continua funcionando.

Trocar o par de chaves invalida todas as assinaturas existentes: cada aparelho precisa desativar e ativar de novo.

## Testar no celular

- **Android/desktop (Chrome, Edge, Firefox):** Configurações → Notificações → *Ativar neste aparelho* → permitir.
  Peça a um amigo para curtir ou comentar uma leitura sua (com o feed ligado).
- **iPhone/iPad:** só funciona com o app **instalado na tela inicial** (Safari → Compartilhar → *Adicionar à Tela de Início*)
  e iOS 16.4 ou mais recente. Abra o app instalado (não o Safari) e ative em Configurações.
- Push exige HTTPS; localmente use `next dev --experimental-https`.

## Segurança

- `/sw.js` é público de propósito (o navegador o busca sozinho para atualizar) e não tem nada secreto; é servido sem cache e
  com CSP própria. A CSP do app ganhou `worker-src 'self'`.
- A chave de serviço e a chave VAPID privada só existem no servidor. As tabelas de notificação e push não têm acesso direto.

## Próximos passos (fora desta entrega)

- Lembretes por horário (ex.: empréstimo atrasado): exigem um agendador (cron da Netlify ou do Supabase) que chame o mesmo envio.
- "Amigo leu algo": volume de avisos alto; pede agrupamento ("3 amigos leram hoje") antes de virar push.
- Tipo novo de aviso: trigger novo no banco (e trocar o `CHECK` de `notificacoes.tipo`) + um caso em `textoDaNotificacao`,
  `hrefDaNotificacao` (`src/lib/notificacoes.ts`) e em `conteudoDoPush`/`preferenciaPermite` (`src/lib/push.ts`).
- Sair da conta num aparelho não desativa o push dele: quem entrar depois com outra conta e ativar passa a ser o dono da assinatura.
