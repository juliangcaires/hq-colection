import { ImportarUploader } from '@/components/importar/importar-uploader'

export default function ImportarPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Importar</h1>
        <p className="max-w-2xl text-sm text-neutral-500">
          Suba um CSV já revisado (vindo do Notion ou de fotos das prateleiras analisadas por IA).
          Colunas aceitas: <code>titulo, serie, numero_volume, tipo, estado, editora, universo,
          personagem, selo, autor, isbn, tags_extra, observacoes</code>. Rodar o mesmo arquivo duas
          vezes não duplica nada — itens com a mesma série+número (ou mesmo título avulso) são
          ignorados na segunda vez.
        </p>
      </div>
      <ImportarUploader />
    </div>
  )
}
