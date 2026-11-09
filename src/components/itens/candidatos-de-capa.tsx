'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Flag, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { denunciarCapa } from '@/app/(app)/itens/actions'
import { desembrulhar } from '@/lib/resultado'
import { rotuloDeUsos, type CandidatoCapa } from '@/lib/capa-busca'

/**
 * Grade de capas candidatas. As da comunidade mostram o selo "usada por N colecionadores"; com 2 ou mais
 * ficam em destaque e aparecem primeiro. Em cada uma há "Capa errada ou imprópria" (3 denúncias de pessoas
 * diferentes tiram a capa das sugestões).
 */
export function CandidatosDeCapa({
  candidatos,
  aplicando,
  onEscolher,
  onCancelar,
}: {
  candidatos: CandidatoCapa[]
  aplicando: boolean
  onEscolher: (c: CandidatoCapa) => void
  onCancelar: () => void
}) {
  const [denunciadas, setDenunciadas] = useState<Set<string>>(new Set())
  const [denunciando, startDenuncia] = useTransition()
  const visiveis = candidatos.filter((c) => !(c.provedor === 'comunidade' && c.ref && denunciadas.has(c.ref)))

  function denunciar(c: CandidatoCapa) {
    if (!c.ref) return
    const ref = c.ref
    startDenuncia(async () => {
      try {
        desembrulhar(await denunciarCapa(ref))
        setDenunciadas((atual) => new Set(atual).add(ref))
        toast.success('Obrigado — essa capa não aparece mais para você', {
          description: 'Com 3 denúncias ela sai das sugestões até ser revisada.',
        })
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível denunciar')
      }
    })
  }

  if (visiveis.length === 0) return null

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
      <p className="text-sm text-foreground">
        Encontrei {visiveis.length} {visiveis.length === 1 ? 'candidato' : 'candidatos'} — escolha a capa certa:
      </p>
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {visiveis.map((c, i) => {
          const daComunidade = c.provedor === 'comunidade'
          return (
            <li key={`${c.url}-${i}`} className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => onEscolher(c)}
                disabled={aplicando}
                title={c.label}
                aria-label={`Usar esta capa: ${c.label}`}
                className={cn(
                  'relative aspect-[2/3] overflow-hidden rounded border-2 transition hover:border-primary disabled:pointer-events-none disabled:opacity-50',
                  c.destaque ? 'border-success' : 'border-transparent'
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- candidato de provedor externo ou do bucket público */}
                <img src={c.url} alt={c.label} className="size-full object-cover" />
                {c.destaque && (
                  <span className="absolute inset-x-0 top-0 bg-success px-1 py-0.5 text-center text-[10px] font-bold text-primary-foreground">
                    Mais usada
                  </span>
                )}
              </button>
              {daComunidade && (
                <>
                  <span className="flex items-center gap-1 text-[11px] leading-tight text-muted-foreground">
                    <Users className="size-3 shrink-0" aria-hidden />
                    {c.usos && c.usos > 0 ? rotuloDeUsos(c.usos) : 'da comunidade'}
                  </span>
                  <button
                    type="button"
                    onClick={() => denunciar(c)}
                    disabled={denunciando}
                    className="flex min-h-8 items-center gap-1 text-left text-[11px] leading-tight text-danger-text underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    <Flag className="size-3 shrink-0" aria-hidden />
                    Capa errada ou imprópria
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>
      <Button variant="ghost" size="sm" className="w-fit" onClick={onCancelar}>
        Cancelar
      </Button>
    </div>
  )
}
