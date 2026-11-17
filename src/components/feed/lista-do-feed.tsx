'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PostDoFeed } from '@/components/feed/post-do-feed'
import { maisPosts } from '@/app/(app)/feed/actions'
import { TAMANHO_PAGINA_FEED, type PostDoFeed as Post } from '@/lib/feed'
import { desembrulhar } from '@/lib/resultado'

/** Posts já carregados no servidor + "Ver mais" (paginado pelo instante da marcação do último post). */
export function ListaDoFeed({ iniciais }: { iniciais: Post[] }) {
  const [posts, setPosts] = useState(iniciais)
  const [acabou, setAcabou] = useState(iniciais.length < TAMANHO_PAGINA_FEED)
  const [pendente, startTransition] = useTransition()

  function carregarMais() {
    const ultimo = posts[posts.length - 1]
    if (!ultimo) return
    startTransition(async () => {
      try {
        const novos = desembrulhar(await maisPosts(ultimo.marcadoEm))
        setPosts((atual) => [...atual, ...novos.filter((n) => !atual.some((a) => a.itemId === n.itemId))])
        if (novos.length < TAMANHO_PAGINA_FEED) setAcabou(true)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível carregar mais')
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {posts.map((p) => (
        <PostDoFeed key={p.itemId} post={p} onOcultar={(id) => setPosts((atual) => atual.filter((a) => a.itemId !== id))} />
      ))}
      {!acabou && (
        <Button type="button" variant="outline" onClick={carregarMais} disabled={pendente} className="self-center">
          {pendente ? 'Carregando…' : 'Ver mais'}
        </Button>
      )}
    </div>
  )
}
