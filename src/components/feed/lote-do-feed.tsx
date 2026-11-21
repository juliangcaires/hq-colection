'use client'

import { useId, useState } from 'react'
import Image from 'next/image'
import { ChevronDown } from 'lucide-react'
import { Estrelas } from '@/components/ui/estrelas'
import { CriticaSpoiler } from '@/components/ui/critica-spoiler'
import { avaliacaoDoPost, tituloDoPost, urlDeCapaDoVolumeDoLote, type PostDoFeed, type VolumeDoLoteNoFeed } from '@/lib/feed'
import { formatarNota } from '@/lib/nota'
import { cn } from '@/lib/utils'

/** Quantas capas aparecem lado a lado antes do "+N". */
const CAPAS_VISIVEIS = 5

function Miniatura({ volume, className }: { volume: VolumeDoLoteNoFeed; className: string }) {
  const url = urlDeCapaDoVolumeDoLote(volume)
  return (
    <div className={cn('relative shrink-0 overflow-hidden rounded-md bg-surface-2', className)}>
      {url && <Image unoptimized src={url} alt="" fill sizes="72px" className="object-cover" />}
    </div>
  )
}

/**
 * Corpo do card de lote do "Li hoje" (0035): as capas dos volumes lidos juntos e, recolhida por padrão, a lista com título,
 * série, nota e crítica de cada um. A visibilidade (nota só entre amigos, spoiler fechado) já vem decidida pelo banco.
 */
export function LoteDoFeed({ post, volumes }: { post: Pick<PostDoFeed, 'qtd' | 'proprio' | 'notaMedia' | 'avaliados' | 'nota' | 'critica' | 'criticaSpoiler' | 'criticaGrupo' | 'criticaGrupoSpoiler' | 'criticaGrupoVolume' | 'serieNota' | 'serieCritica'>; volumes: VolumeDoLoteNoFeed[] }) {
  const [aberto, setAberto] = useState(false)
  const idLista = useId()
  const total = volumes.length
  const av = avaliacaoDoPost({ ...post, qtd: total, serieNota: null, serieCritica: null })
  const excedente = total - CAPAS_VISIVEIS

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <h3 className="font-heading text-base font-bold text-foreground">{`${total} volumes`}</h3>
        <ul className="flex items-end gap-2" aria-label="Capas dos volumes">
          {volumes.slice(0, CAPAS_VISIVEIS).map((v) => (
            <li key={v.itemId}>
              <Miniatura volume={v} className="h-[84px] w-14" />
            </li>
          ))}
          {excedente > 0 && (
            <li className="flex h-[84px] w-14 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-sm font-medium text-muted-foreground">+{excedente}</li>
          )}
        </ul>
        {av.nota !== null && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Estrelas valor={av.nota} tamanho={16} mostrarValor={false} />
            <span className="text-sm font-medium text-foreground">{formatarNota(av.nota)}</span>
            {av.rotuloNota && <span className="text-xs text-muted-foreground">{av.rotuloNota}</span>}
          </div>
        )}
      </div>

      <button
        type="button"
        aria-expanded={aberto}
        aria-controls={idLista}
        onClick={() => setAberto((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-border bg-surface-2 px-3 text-left text-sm text-foreground hover:bg-white/[0.04] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span>{aberto ? 'Esconder os volumes' : `Ver os ${total} volumes`}</span>
        <ChevronDown aria-hidden className={cn('size-4 shrink-0 transition-transform', aberto && 'rotate-180')} />
      </button>

      {aberto && (
        <ul id={idLista} className="flex flex-col gap-3">
          {volumes.map((v) => (
            <li key={v.itemId} className="flex gap-3">
              <Miniatura volume={v} className="h-[72px] w-12" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-sm font-semibold break-words text-foreground">{tituloDoPost({ serieNome: v.serieNome, titulo: v.titulo, numeroVolume: v.numeroVolume, qtd: 1 })}</p>
                {v.serieNome && !tituloDoPost({ serieNome: v.serieNome, titulo: v.titulo, numeroVolume: v.numeroVolume, qtd: 1 }).startsWith(v.serieNome) && (
                  <p className="text-xs text-muted-foreground">{v.serieNome}</p>
                )}
                {v.nota !== null && (
                  <div className="flex items-center gap-2">
                    <Estrelas valor={v.nota} tamanho={14} mostrarValor={false} />
                    <span className="text-xs font-medium text-foreground">{formatarNota(v.nota)}</span>
                  </div>
                )}
                {v.critica && <CriticaSpoiler texto={v.critica} spoiler={v.criticaSpoiler} proprio={post.proprio} textoClassName="text-xs" />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
