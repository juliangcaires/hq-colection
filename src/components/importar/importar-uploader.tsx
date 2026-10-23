'use client'

import { useRef, useState, useTransition } from 'react'
import Papa from 'papaparse'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { importarCsv, type RascunhoRow, type ResumoImportacao } from '@/app/(app)/importar/actions'
import { desembrulhar } from '@/lib/resultado'

export function ImportarUploader() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<RascunhoRow[] | null>(null)
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [resumo, setResumo] = useState<ResumoImportacao | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setResumo(null)

    Papa.parse<RascunhoRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        setRows(result.data)
        setParseErrors(result.errors.map((err) => `linha ${err.row}: ${err.message}`))
      },
      error: (err) => {
        toast.error(`Erro ao ler CSV: ${err.message}`)
      },
    })
  }

  function handleImport() {
    if (!rows || rows.length === 0) return
    startTransition(async () => {
      try {
        const r = desembrulhar(await importarCsv(rows))
        setResumo(r)
        toast.success('Importação concluída')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao importar')
      }
    })
  }

  const preview = rows?.slice(0, 15) ?? []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
        <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
          Escolher CSV
        </Button>
        {fileName && <span className="text-sm text-neutral-400">{fileName}</span>}
      </div>

      {parseErrors.length > 0 && (
        <div className="rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
          {parseErrors.slice(0, 5).map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}

      {rows && rows.length > 0 && !resumo && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-neutral-400">
            {rows.length} linha(s) no arquivo — mostrando as primeiras {preview.length}
          </p>
          <div className="overflow-x-auto rounded-lg border border-neutral-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-900 text-neutral-400">
                <tr>
                  {['titulo', 'serie', 'numero_volume', 'tipo', 'estado', 'editora', 'universo', 'personagem'].map(
                    (h) => (
                      <th key={h} className="whitespace-nowrap px-2 py-1.5">
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {preview.map((r, i) => (
                  <tr key={i}>
                    <td className="px-2 py-1.5">{r.titulo}</td>
                    <td className="px-2 py-1.5">{r.serie}</td>
                    <td className="px-2 py-1.5">{r.numero_volume}</td>
                    <td className="px-2 py-1.5">{r.tipo}</td>
                    <td className="px-2 py-1.5">{r.estado}</td>
                    <td className="px-2 py-1.5">{r.editora}</td>
                    <td className="px-2 py-1.5">{r.universo}</td>
                    <td className="px-2 py-1.5">{r.personagem}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button onClick={handleImport} disabled={isPending} className="w-fit">
            {isPending ? 'Importando...' : `Importar ${rows.length} item(ns)`}
          </Button>
        </div>
      )}

      {resumo && (
        <div className="flex flex-col gap-2 rounded-lg border border-emerald-900 bg-emerald-950/30 p-4 text-sm">
          <p>{resumo.itensCriados} item(ns) criado(s)</p>
          <p>{resumo.itensIgnorados} já existiam e foram ignorados (idempotente)</p>
          <p>{resumo.seriesCriadas} série(s) nova(s)</p>
          <p>{resumo.tagsCriadas} tag(s) nova(s)</p>
          <p>{resumo.capasAplicadas} capa(s) aplicada(s) automaticamente (via ISBN)</p>
          {resumo.erros.length > 0 && (
            <details className="text-amber-300">
              <summary className="cursor-pointer">{resumo.erros.length} linha(s) com problema</summary>
              <ul className="mt-1 list-disc pl-5">
                {resumo.erros.slice(0, 20).map((e, i) => (
                  <li key={i}>
                    linha {e.linha}: {e.motivo}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
