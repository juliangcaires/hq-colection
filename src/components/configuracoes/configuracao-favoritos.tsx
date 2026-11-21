'use client'

import Image from 'next/image'
import { useMemo, useState, useTransition } from 'react'
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FaixaFavoritos } from '@/components/favoritos/faixa-favoritos'
import { salvarFavoritos } from '@/app/(app)/configuracoes/actions'
import { adicionarFavorito, buscarCandidatas, LIMITE_FAVORITOS, moverFavorito, paraSalvar, podeAdicionar, removerFavorito, ROTULO_DA_ORIGEM, type Favorito, type FavoritoCandidato } from '@/lib/favoritos'
import { desembrulhar } from '@/lib/resultado'

const MAX_RESULTADOS = 8

/** Explica quando a configuração de compartilhamento esconde parte da faixa dos amigos (série pede "Séries"; volume único pede "Coleção"). */
function avisoDeVisibilidade(series: boolean, colecao: boolean): string | null {
  if (series && colecao) return null
  if (!series && !colecao) return 'Hoje seus amigos não veem: libere as seções "Séries" (para as séries) e "Coleção" (para os volumes únicos) para a faixa aparecer no seu perfil.'
  if (!series) return 'Hoje seus amigos não veem as séries: libere a seção "Séries" para elas aparecerem no seu perfil.'
  return 'Hoje seus amigos não veem os volumes únicos: libere a seção "Coleção" para eles aparecerem no seu perfil.'
}

function Miniatura({ favorito }: { favorito: Favorito }) {
  return (
    <div className="relative aspect-[2/3] w-9 shrink-0 overflow-hidden rounded bg-surface-2 ring-1 ring-white/10">
      {favorito.capa && <Image unoptimized src={favorito.capa} alt="" fill sizes="36px" className="object-cover" />}
    </div>
  )
}

/** Rótulo pequeno do tipo do favorito: "Série" ou "Volume único". */
function Rotulo({ favorito }: { favorito: Favorito }) {
  return <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{ROTULO_DA_ORIGEM[favorito.origem]}</span>
}

/** Escolhe, reordena e tira até 4 favoritos (séries e volumes únicos). Cada mudança é gravada na hora (volta ao anterior se falhar). */
export function ConfiguracaoFavoritos({
  favoritosIniciais,
  candidatos,
  amigosVeemSeries,
  amigosVeemColecao,
}: {
  favoritosIniciais: Favorito[]
  candidatos: FavoritoCandidato[]
  /** A seção "Séries" está liberada para os amigos (sem ela, eles não veem as séries da faixa). */
  amigosVeemSeries: boolean
  /** A seção "Coleção" está liberada para os amigos (sem ela, eles não veem os volumes únicos da faixa). */
  amigosVeemColecao: boolean
}) {
  const [favoritos, setFavoritos] = useState(favoritosIniciais)
  const [termo, setTermo] = useState('')
  const [isPending, startTransition] = useTransition()
  const resultados = useMemo(() => buscarCandidatas(candidatos, termo, favoritos), [candidatos, termo, favoritos])
  const cheio = !podeAdicionar(favoritos)
  const aviso = avisoDeVisibilidade(amigosVeemSeries, amigosVeemColecao)

  function aplicar(nova: Favorito[], mensagem: string) {
    const anterior = favoritos
    setFavoritos(nova)
    startTransition(async () => {
      try {
        desembrulhar(await salvarFavoritos(paraSalvar(nova)))
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
        <h2 className="font-heading text-[19px] font-bold">Favoritos</h2>
        <p className="text-sm text-muted-foreground">
          Escolha até {LIMITE_FAVORITOS} favoritos da sua coleção para mostrar no seu perfil, na ordem que quiser: séries e volumes únicos (sem série) juntos. Só os seus amigos aceitos veem.
          {aviso && ` ${aviso}`}
        </p>
      </div>

      {favoritos.length > 0 ? (
        <>
          <FaixaFavoritos favoritos={favoritos} hrefDoFavorito={(f) => (f.origem === 'serie' ? `/serie/${f.id}` : `/item/${f.id}`)} titulo="Seu perfil" />
          <ol className="flex flex-col gap-2" aria-label="Ordem dos favoritos">
            {favoritos.map((f, i) => (
              <li key={f.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-2">
                <span className="w-5 shrink-0 text-center font-heading text-base font-extrabold text-muted-foreground tabular-nums">{i + 1}</span>
                <Miniatura favorito={f} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{f.nome}</span>
                <Rotulo favorito={f} />
                <div className="flex shrink-0 items-center gap-1">
                  <Button type="button" variant="ghost" size="icon" disabled={isPending || i === 0} aria-label={`Subir ${f.nome}`} onClick={() => aplicar(moverFavorito(favoritos, f.id, -1), 'Ordem atualizada')}>
                    <ChevronUp />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" disabled={isPending || i === favoritos.length - 1} aria-label={`Descer ${f.nome}`} onClick={() => aplicar(moverFavorito(favoritos, f.id, 1), 'Ordem atualizada')}>
                    <ChevronDown />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" disabled={isPending} aria-label={`Tirar ${f.nome} dos favoritos`} onClick={() => aplicar(removerFavorito(favoritos, f.id), 'Removido dos favoritos')}>
                    <X />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">Nenhum favorito ainda. Seu perfil fica sem a faixa até você escolher.</p>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="busca-favoritos" className="text-sm font-medium text-foreground">
          Adicionar favorito {cheio && <span className="font-normal text-muted-foreground">(já são {LIMITE_FAVORITOS}: tire um para escolher outro)</span>}
        </label>
        <Input id="busca-favoritos" type="search" value={termo} disabled={cheio} placeholder="Buscar série ou volume único pelo nome" onChange={(e) => setTermo(e.target.value)} />
        {!cheio && (
          <ul className="flex flex-col gap-1" aria-label="Séries e volumes únicos da sua coleção">
            {resultados.slice(0, MAX_RESULTADOS).map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-muted/50">
                <Miniatura favorito={s} />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{s.nome}</span>
                <Rotulo favorito={s} />
                <Button type="button" variant="outline" size="sm" disabled={isPending} aria-label={`Adicionar ${s.nome} aos favoritos`} onClick={() => aplicar(adicionarFavorito(favoritos, s), 'Adicionado aos favoritos')}>
                  <Plus /> Adicionar
                </Button>
              </li>
            ))}
            {resultados.length === 0 && (
              <li className="text-sm text-muted-foreground">{candidatos.length === 0 ? 'Você ainda não tem séries com volumes nem volumes únicos na coleção.' : 'Nada encontrado.'}</li>
            )}
            {resultados.length > MAX_RESULTADOS && <li className="text-xs text-muted-foreground">Mostrando {MAX_RESULTADOS} de {resultados.length}. Digite para filtrar.</li>}
          </ul>
        )}
      </div>
    </section>
  )
}
