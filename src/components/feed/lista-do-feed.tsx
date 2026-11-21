'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PostDoFeed } from '@/components/feed/post-do-feed'
import { definirOcultosDoFeed, maisPosts, tirarPostDoFeed } from '@/app/(app)/feed/actions'
import { chaveDoPost, reinserirPost, TAMANHO_PAGINA_FEED, tituloDoOculto, type OcultoDoFeed, type PostDoFeed as Post } from '@/lib/feed'
import { desembrulhar } from '@/lib/resultado'

/**
 * Posts já carregados no servidor + "Ver mais" (paginado pelo instante da marcação do último post).
 * "Tirar do feed" tira o card inteiro, avisa com "Desfazer" e guarda o que saiu na lista "Tirados do feed",
 * de onde dá para recolocar depois.
 */
export function ListaDoFeed({ iniciais, ocultosIniciais }: { iniciais: Post[]; ocultosIniciais: OcultoDoFeed[] }) {
  const router = useRouter()
  const [posts, setPosts] = useState(iniciais)
  const [ocultos, setOcultos] = useState(ocultosIniciais)
  const [acabou, setAcabou] = useState(iniciais.length < TAMANHO_PAGINA_FEED)
  const [pendente, startTransition] = useTransition()

  function carregarMais() {
    const ultimo = posts[posts.length - 1]
    if (!ultimo) return
    startTransition(async () => {
      try {
        const novos = desembrulhar(await maisPosts(ultimo.marcadoEm))
        setPosts((atual) => [...atual, ...novos.filter((n) => !atual.some((a) => chaveDoPost(a) === chaveDoPost(n)))])
        if (novos.length < TAMANHO_PAGINA_FEED) setAcabou(true)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível carregar mais')
      }
    })
  }

  async function tirar(post: Post) {
    const varios = post.qtd > 1 && !post.releitura
    try {
      const ids = desembrulhar(await tirarPostDoFeed(post.itemId, varios))
      const saiu = new Set(ids)
      const removidos = posts.filter((p) => saiu.has(p.itemId))
      const oculto: OcultoDoFeed = { itemIds: ids, serieNome: post.serieNome, titulo: post.titulo, numeroVolume: post.numeroVolume, qtd: ids.length, marcadoEm: post.marcadoEm }
      setPosts((atual) => atual.filter((p) => !saiu.has(p.itemId)))
      setOcultos((atual) => [oculto, ...atual])
      toast(varios ? `Tirei do feed o post com ${ids.length} volumes. A nota e a crítica continuam nos itens.` : 'Tirei do feed. A nota e a crítica continuam no seu item.', {
        duration: 10_000,
        action: { label: 'Desfazer', onClick: () => void desfazer(ids, removidos) },
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível tirar do feed')
    }
  }

  async function desfazer(ids: string[], removidos: Post[]) {
    try {
      desembrulhar(await definirOcultosDoFeed(ids, false))
      setPosts((atual) => removidos.reduce(reinserirPost, atual))
      setOcultos((atual) => atual.filter((o) => !o.itemIds.some((id) => ids.includes(id))))
      toast.success('Voltou para o feed.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível desfazer')
    }
  }

  function recolocar(o: OcultoDoFeed) {
    startTransition(async () => {
      try {
        desembrulhar(await definirOcultosDoFeed(o.itemIds, false))
        setOcultos((atual) => atual.filter((x) => x !== o))
        toast.success('Voltou para o feed.')
        router.refresh() // traz o post de volta na lista
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Não foi possível recolocar no feed')
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {posts.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nada por aqui ainda. Quando você ou um amigo marcar uma leitura (com o feed ligado), ela aparece aqui.
        </p>
      )}
      {posts.map((p) => (
        <PostDoFeed key={chaveDoPost(p)} post={p} onOcultar={tirar} />
      ))}
      {!acabou && (
        <Button type="button" variant="outline" onClick={carregarMais} disabled={pendente} className="self-center">
          {pendente ? 'Carregando…' : 'Ver mais'}
        </Button>
      )}
      {ocultos.length > 0 && (
        <details className="rounded-2xl border border-border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium text-foreground">Tirados do feed ({ocultos.length})</summary>
          <p className="mt-2 text-xs text-muted-foreground">Os amigos não veem estes posts. A nota e a crítica continuam nos itens. Recolocar devolve o post ao feed.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {ocultos.map((o) => (
              <li key={o.itemIds.join(',')} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{tituloDoOculto(o)}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => recolocar(o)} disabled={pendente} aria-label={`Recolocar no feed: ${tituloDoOculto(o)}`}>
                  <Undo2 aria-hidden /> Recolocar
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
