'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { definirContribuirCapas } from '@/app/(app)/configuracoes/actions'
import { desembrulhar } from '@/lib/resultado'

/** Opt-in de contribuição de fotos de capa para o catálogo compartilhado. Desligado por padrão. */
export function ConfiguracaoCapas({ contribuirInicial }: { contribuirInicial: boolean }) {
  const [contribuir, setContribuir] = useState(contribuirInicial)
  const [isPending, startTransition] = useTransition()

  function alterar(valor: boolean) {
    const anterior = contribuir
    setContribuir(valor)
    startTransition(async () => {
      try {
        desembrulhar(await definirContribuirCapas(valor))
        toast.success(valor ? 'Suas próximas fotos de capa serão compartilhadas' : 'Suas fotos de capa voltam a ser só suas')
      } catch (e) {
        setContribuir(anterior)
        toast.error(e instanceof Error ? e.message : 'Não foi possível salvar')
      }
    })
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-[18px]">
      <h2 className="font-heading text-[19px] font-bold">Capas compartilhadas</h2>
      <p className="text-sm text-muted-foreground">
        Capas encontradas automaticamente (Google Books, Open Library, AniList, MangaDex) ficam disponíveis para
        outros colecionadores e as capas deles aparecem para você primeiro nas sugestões.
      </p>
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-2 p-3">
        <Checkbox
          className="mt-0.5"
          checked={contribuir}
          disabled={isPending}
          onCheckedChange={(v) => alterar(v === true)}
          aria-describedby="contribuir-capas-texto"
        />
        <span className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">Contribuir com as capas que eu enviar</span>
          <span id="contribuir-capas-texto" className="text-xs text-muted-foreground">
            Desligado por padrão. Ligado, as fotos de capa que você enviar ficam visíveis para todos os usuários do app,
            sem dados de localização ou do aparelho. Se você apagar a sua capa ou o item, a imagem continua no catálogo
            compartilhado: é uma contribuição. Fotos já enviadas antes de ligar continuam só suas.
          </span>
        </span>
      </label>
    </section>
  )
}
