import { ExportarColecao } from '@/components/importar/exportar-colecao'
import { ImportarUploader } from '@/components/importar/importar-uploader'
import { ScrollRestore } from '@/components/ui/scroll-restore'

export default function ImportarPage() {
  return (
    <div className="flex flex-col gap-6">
      <ScrollRestore />
      <div>
        <h1 className="font-heading text-[28px] font-extrabold tracking-tight text-foreground">Importar e exportar</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Suba um CSV já revisado (vindo do Notion ou de fotos das prateleiras analisadas por IA).
          Colunas aceitas: <code>titulo, serie, numero_volume, tipo, estado, editora, universo,
          personagem, selo, autor, isbn, tags_extra, critica, nota, lido_em, id</code>. Rodar o mesmo arquivo duas
          vezes não duplica nada — itens com a mesma série+número (ou mesmo título avulso) são
          ignorados na segunda vez. Linha com <code>id</code> (ou ISBN de um item seu) atualiza esse item.
          <code>isbn</code> é validado (dígito verificador) e guardado como ISBN-13. <code>tipo</code>: hq ou manga (aceita &quot;Mangá&quot;);{' '}
          <code>estado</code>: desejo, comprado ou lido (vazio = comprado); <code>numero_volume</code>
          aceita vírgula (1,5). Linhas com valor desconhecido são recusadas e listadas no resumo, em
          vez de importadas com um palpite.
        </p>
      </div>
      <ExportarColecao />
      <ImportarUploader />
    </div>
  )
}
