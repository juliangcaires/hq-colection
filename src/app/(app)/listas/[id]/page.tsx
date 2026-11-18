import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { AdicionarItem } from '@/components/listas/adicionar-item'
import { ApagarLista } from '@/components/listas/apagar-lista'
import { InteracaoDaLista } from '@/components/listas/interacao-da-lista'
import { ItensDaLista } from '@/components/listas/itens-da-lista'
import { Avatar } from '@/components/ui/avatar'
import { buttonVariants } from '@/components/ui/button'
import { carregarItensDaLista, carregarLista, MAX_ITENS_DA_LISTA, resumoDaSituacao, ROTULOS_TIPO_DE_LISTA, rotuloDeItens } from '@/lib/listas'
import { cn } from '@/lib/utils'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const metadata = { title: 'Lista' }

export default async function ListaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const supabase = await createClient()
  // Lista que não existe, de quem não é amigo ou de amizade desfeita: o banco devolve vazio e a página vira 404.
  const lista = await carregarLista(supabase, id)
  if (!lista) notFound()
  const itens = await carregarItensDaLista(supabase, id)
  const situacao = resumoDaSituacao(itens)
  const nome = lista.nome || lista.apelido || 'Alguém'

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-5">
      <Link href="/listas" className="w-fit text-sm text-muted-foreground hover:text-foreground">
        ← Listas
      </Link>

      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-[28px] leading-tight font-extrabold tracking-tight break-words text-foreground">{lista.titulo}</h1>
        <p className="text-sm text-muted-foreground">
          {[lista.tipo ? ROTULOS_TIPO_DE_LISTA[lista.tipo] : null, lista.ordenada ? 'ordenada' : null, rotuloDeItens(lista.qtd)].filter(Boolean).join(' · ')}
        </p>
        {!lista.proprio && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Avatar apelido={lista.apelido} nome={lista.nome} url={lista.avatarUrl} size={24} />
            <span>
              por {nome}
              {lista.apelido ? ` (@${lista.apelido})` : ''}
            </span>
          </p>
        )}
        {lista.descricao && <p className="text-sm break-words whitespace-pre-wrap text-foreground/90">{lista.descricao}</p>}
        {!lista.proprio && itens.length > 0 && (
          <p className="text-sm text-foreground">
            Você leu {situacao.li} de {situacao.total}
            {situacao.tenho > situacao.li ? ` e tem mais ${situacao.tenho - situacao.li}` : ''}.
          </p>
        )}
        {lista.proprio && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Link href={`/listas/${lista.id}/editar`} className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}>
              <Pencil aria-hidden /> Editar dados
            </Link>
          </div>
        )}
      </header>

      <ItensDaLista listaId={lista.id} ordenada={lista.ordenada} proprio={lista.proprio} itens={itens} />

      {lista.proprio && <AdicionarItem listaId={lista.id} cheia={itens.length >= MAX_ITENS_DA_LISTA} />}

      <section aria-label="Curtidas e comentários" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
        <InteracaoDaLista listaId={lista.id} curti={lista.curti} curtidas={lista.curtidas} comentarios={lista.comentarios} />
      </section>

      {lista.proprio && (
        <div className="pt-2">
          <ApagarLista listaId={lista.id} titulo={lista.titulo} />
        </div>
      )}
    </div>
  )
}
