import { ImportarUploader } from '@/components/importar/importar-uploader'
import { ScrollRestore } from '@/components/ui/scroll-restore'

export default function ImportarPage() {
  return (
    <div className="flex flex-col gap-6">
      <ScrollRestore />
      <div>
        <h1 className="text-2xl font-semibold">Importar</h1>
        <p className="max-w-2xl text-sm text-neutral-500">
          Suba um CSV já revisado (vindo do Notion ou de fotos das prateleiras analisadas por IA).
          Colunas aceitas: <code>titulo, serie, numero_volume, tipo, estado, editora, universo,
          personagem, selo, autor, isbn, tags_extra, observacoes</code>. Rodar o mesmo arquivo duas
          vezes não duplica nada — itens com a mesma série+número (ou mesmo título avulso) são
          ignorados na segunda vez. <code>tipo</code>: hq ou manga (aceita &quot;Mangá&quot;);{' '}
          <code>estado</code>: desejo, comprado ou lido (vazio = comprado); <code>numero_volume</code>
          aceita vírgula (1,5). Linhas com valor desconhecido são recusadas e listadas no resumo, em
          vez de importadas com um palpite.
        </p>
      </div>
      <ImportarUploader />
    </div>
  )
}
