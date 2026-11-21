'use client'

import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SerieForm } from '@/components/series/serie-form'
import { resumoDaSerie } from '@/lib/serie-resumo'
import type { Serie, TagLite } from '@/lib/types'

/**
 * Página da série em modo leitura: só o que a série tem preenchido, em tamanho pequeno. "Editar" abre o formulário
 * completo (inclusive os campos vazios) num modal; salvar fecha o modal e excluir leva à coleção, como antes.
 */
export function SerieResumo({ serie, allTags }: { serie: Serie & { tagIds: string[] }; allTags: TagLite[] }) {
  const [aberto, setAberto] = useState(false)
  const resumo = resumoDaSerie(serie, allTags)

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading text-sm font-semibold text-foreground/90">Sobre a série</h2>
        <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
          <Pencil data-icon="inline-start" />
          Editar
        </Button>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {resumo.campos.map((c) => (
          <div key={c.rotulo} className="col-span-2 grid grid-cols-subgrid">
            <dt className="text-muted-foreground">{c.rotulo}</dt>
            <dd className="min-w-0 text-foreground">{c.valor}</dd>
          </div>
        ))}
        {resumo.tags.map((g) => (
          <div key={g.tipo} className="col-span-2 grid grid-cols-subgrid">
            <dt className="pt-0.5 text-muted-foreground">{g.rotulo}</dt>
            <dd className="flex min-w-0 flex-wrap gap-1">
              {g.nomes.map((nome) => (
                <Badge key={nome} variant="secondary">
                  {nome}
                </Badge>
              ))}
            </dd>
          </div>
        ))}
        {resumo.observacoes && (
          <div className="col-span-2 grid grid-cols-subgrid">
            <dt className="text-muted-foreground">Observações</dt>
            <dd className="min-w-0 break-words whitespace-pre-wrap text-foreground">{resumo.observacoes}</dd>
          </div>
        )}
      </dl>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar série</DialogTitle>
            <DialogDescription className="truncate">{serie.nome}</DialogDescription>
          </DialogHeader>
          <SerieForm serie={serie} allTags={allTags} semMoldura onSalvo={() => setAberto(false)} />
        </DialogContent>
      </Dialog>
    </section>
  )
}
