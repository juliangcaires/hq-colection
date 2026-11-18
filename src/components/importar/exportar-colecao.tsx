import { Download } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Baixa a coleção em CSV (UTF-8 com BOM, separador `;`): abre direto no Excel e volta pelo importador. */
export function ExportarColecao() {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-[18px]">
      <h2 className="font-heading text-[19px] font-bold">Exportar a coleção</h2>
      <p className="text-sm text-muted-foreground">
        Baixa todos os seus itens (coleção e desejos) numa planilha CSV que o Excel abre direto. A coluna{' '}
        <code>id</code> identifica cada item: edite o que quiser (por exemplo, preencher o ISBN), salve como CSV e
        suba aqui embaixo. Itens com <code>id</code> são <strong>atualizados</strong>, não duplicados; célula vazia
        não apaga nada e você vê a prévia do que muda antes de aplicar. Mantenha a coluna <code>id</code> e não
        apague o hífen do ISBN (é o que impede o Excel de transformá-lo em 9,78E+12).
      </p>
      <a href="/api/exportar" download className={cn(buttonVariants({ variant: 'outline' }), 'h-11 w-fit gap-2')}>
        <Download className="size-4" aria-hidden />
        Baixar planilha (CSV)
      </a>
    </section>
  )
}
