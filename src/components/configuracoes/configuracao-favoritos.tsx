'use client'

import Image from 'next/image'
import { useMemo, useState, useTransition } from 'react'
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FaixaFavoritos } from '@/components/favoritos/faixa-favoritos'
import { salvarFavoritosSeries } from '@/app/(app)/configuracoes/actions'
import { adicionarFavorito, buscarCandidatas, LIMITE_FAVORITOS, moverFavorito, podeAdicionar, removerFavorito, type FavoritoSerie, type SerieCandidata } from '@/lib/favoritos-series'
import { desembrulhar } from '@/lib/resultado'

const MAX_RESULTADOS = 8

function Miniatura({ serie }: { serie: FavoritoSerie }) {
  return (
    <div className="relative aspect-[2/3] w-9 shrink-0 overflow-hidden rounded bg-surface-2 ring-1 ring-white/10">
      {serie.capa && <Image unoptimized src={serie.capa} alt="" fill sizes="36px" className="object-cover" />}
    </div>
  )
}

/** Escolhe, reordena e tira até 4 séries favoritas. Cada mudança é gravada na hora (volta ao anterior se falhar). */
export function ConfiguracaoFavoritos({
  favoritosIniciais,
  candidatas,
  amigosVeemSeries,
}: {
  favoritosIniciais: FavoritoSerie[]
  candidatas: SerieCandidata[]
  /** A seção "Séries" está liberada para os amigos (sem ela, eles não veem a faixa). */
  amigosVeemSeries: boolean
}) {
  const [favoritos, setFavoritos] = useState(favoritosIniciais)
  const [termo, setTermo] = useState('')
  const [isPending, startTransition] = useTransition()
  const resultados = useMemo(() => buscarCandidatas(candidatas, termo, favoritos), [candidatas, termo, favoritos])
  const cheio = !podeAdicionar(favoritos)

  function aplicar(nova: FavoritoSerie[], mensagem: string) {
    const anterior = favoritos
    setFavoritos(nova)
    startTransition(async () => {
      try {
        desembrulhar(await salvarFavoritosSeries(nova.map((f) => f.id)))
        toast.success(mensagem)
      } catch (e) {
        setFavoritos(anterior)
        toast.error(e instanceof Error ? e.message : 'Não foi possível salvar')
      }
    })
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-[18px]">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-[19px] font-bold">Séries favoritas</h2>
        <p className="text-sm text-muted-foreground">
          Escolha até {LIMITE_FAVORITOS} séries da sua coleção para mostrar no seu perfil, na ordem que quiser. Só os seus amigos aceitos veem.
          {!amigosVeemSeries && ' Hoje seus amigos não veem: libere a seção "Séries" para os amigos para a faixa aparecer no seu perfil.'}
        </p>
      </div>

      {favoritos.length > 0 ? (
        <>
          <FaixaFavoritos favoritos={favoritos} hrefDaSerie={(id) => `/serie/${id}`} titulo="Seu perfil" />
          <ol className="flex flex-col gap-2" aria-label="Ordem dos favoritos">
            {favoritos.map((f, i) => (
              <li key={f.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-2">
                <span className="w-5 shrink-0 text-center font-heading text-base font-extrabold text-muted-foreground tabular-nums">{i + 1}</span>
                <Miniatura serie={f} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{f.nome}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <Button type="button" variant="ghost" size="icon" disabled={isPending || i === 0} aria-label={`Subir ${f.nome}`} onClick={() => aplicar(moverFavorito(favoritos, f.id, -1), 'Ordem atualizada')}>
                    <ChevronUp />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" disabled={isPending || i === favoritos.length - 1} aria-label={`Descer ${f.nome}`} onClick={() => aplicar(moverFavorito(favoritos, f.id, 1), 'Ordem atualizada')}>
                    <ChevronDown />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" disabled={isPending} aria-label={`Tirar ${f.nome} dos favoritos`} onClick={() => aplicar(removerFavorito(favoritos, f.id), 'Série removida dos favoritos')}>
                    <X />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">Nenhuma série favorita ainda. Seu perfil fica sem a faixa até você escolher.</p>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="busca-favoritos" className="text-sm font-medium text-foreground">
          Adicionar série {cheio && <span className="font-normal text-muted-foreground">(já são {LIMITE_FAVORITOS}: tire uma para escolher outra)</span>}
        </label>
        <Input id="busca-favoritos" type="search" value={termo} disabled={cheio} placeholder="Buscar pelo nome da série" onChange={(e) => setTermo(e.target.value)} />
        {!cheio && (
          <ul className="flex flex-col gap-1" aria-label="Séries da sua coleção">
            {resultados.slice(0, MAX_RESULTADOS).map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-muted/50">
                <Miniatura serie={s} />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{s.nome}</span>
                <Button type="button" variant="outline" size="sm" disabled={isPending} aria-label={`Adicionar ${s.nome} aos favoritos`} onClick={() => aplicar(adicionarFavorito(favoritos, s), 'Série adicionada aos favoritos')}>
                  <Plus /> Adicionar
                </Button>
              </li>
            ))}
            {resultados.length === 0 && (
              <li className="text-sm text-muted-foreground">{candidatas.length === 0 ? 'Você ainda não tem séries com volumes na coleção.' : 'Nenhuma série encontrada.'}</li>
            )}
            {resultados.length > MAX_RESULTADOS && <li className="text-xs text-muted-foreground">Mostrando {MAX_RESULTADOS} de {resultados.length}. Digite para filtrar.</li>}
          </ul>
        )}
      </div>
    </section>
  )
}
