'use client'

import { useRef, useState, useTransition } from 'react'
import Papa from 'papaparse'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { importarCsv, type RascunhoRow, type ResumoImportacao } from '@/app/(app)/importar/actions'
import { desembrulhar } from '@/lib/resultado'
import { COLUNAS_CSV, LINHAS_POR_LOTE, MAX_LINHAS_CSV, normalizarCabecalho } from '@/lib/csv-importacao'

const RESUMO_VAZIO: ResumoImportacao = {
  itensCriados: 0,
  itensIgnorados: 0,
  seriesCriadas: 0,
  tagsCriadas: 0,
  capasAplicadas: 0,
  erros: [],
}

function somar(a: ResumoImportacao, b: ResumoImportacao): ResumoImportacao {
  return {
    itensCriados: a.itensCriados + b.itensCriados,
    itensIgnorados: a.itensIgnorados + b.itensIgnorados,
    seriesCriadas: a.seriesCriadas + b.seriesCriadas,
    tagsCriadas: a.tagsCriadas + b.tagsCriadas,
    capasAplicadas: a.capasAplicadas + b.capasAplicadas,
    erros: [...a.erros, ...b.erros],
  }
}

/** UTF-8 primeiro; se os bytes não forem UTF-8 válido, é Excel/Windows-1252 (senão "Coleção" vira "Cole��o"). */
function decodificar(buffer: ArrayBuffer): { texto: string; windows1252: boolean } {
  try {
    return { texto: new TextDecoder('utf-8', { fatal: true }).decode(buffer), windows1252: false }
  } catch {
    return { texto: new TextDecoder('windows-1252').decode(buffer), windows1252: true }
  }
}

export function ImportarUploader() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<RascunhoRow[] | null>(null)
  /** Impedem importar: arquivo vazio, aspas abertas, cabeçalho irreconhecível... */
  const [bloqueios, setBloqueios] = useState<string[]>([])
  const [avisos, setAvisos] = useState<string[]>([])
  const [resumo, setResumo] = useState<ResumoImportacao | null>(null)
  const [progresso, setProgresso] = useState<{ feitas: number; total: number } | null>(null)
  const [interrompidoNaLinha, setInterrompidoNaLinha] = useState<number | null>(null)
  const [isPending, startTransition] = useTransition()

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Permite escolher o mesmo arquivo de novo (o `change` não dispara com o mesmo valor).
    e.target.value = ''
    if (!file) return
    setFileName(file.name)
    setResumo(null)
    setRows(null)
    setBloqueios([])
    setAvisos([])
    setInterrompidoNaLinha(null)

    const { texto, windows1252 } = decodificar(await file.arrayBuffer())
    const resultado = Papa.parse<RascunhoRow>(texto.replace(/^\uFEFF/, ''), {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: normalizarCabecalho,
    })

    const bloq: string[] = []
    const av: string[] = []

    // Uma aspa aberta faz o parser engolir o resto do arquivo numa "linha" só.
    const aspas = resultado.errors.find((err) => err.type === 'Quotes')
    if (aspas) {
      bloq.push(
        `Aspas sem fechar${aspas.row != null ? ` perto da linha ${aspas.row + 2}` : ''}: corrija o arquivo antes de importar.`
      )
    }

    const colunas = resultado.meta.fields ?? []
    const conhecidas = colunas.filter((c) => (COLUNAS_CSV as readonly string[]).includes(c))
    if (!conhecidas.includes('titulo') && !conhecidas.includes('serie')) {
      bloq.push(
        `Não encontrei as colunas "titulo" ou "serie" no cabeçalho (vi: ${colunas.slice(0, 6).join(', ') || 'nenhuma'}).`
      )
    }
    const desconhecidas = colunas.filter((c) => c && !(COLUNAS_CSV as readonly string[]).includes(c))
    if (desconhecidas.length > 0) av.push(`Colunas ignoradas: ${desconhecidas.join(', ')}.`)

    if (resultado.data.length === 0) bloq.push('O arquivo não tem nenhuma linha de dados (só o cabeçalho ou está vazio).')
    if (resultado.data.length > MAX_LINHAS_CSV) {
      bloq.push(`O arquivo tem ${resultado.data.length} linhas; o máximo é ${MAX_LINHAS_CSV}. Divida em arquivos menores.`)
    }
    if (windows1252) av.push('O arquivo não estava em UTF-8; li como Windows-1252 (Excel). Confira os acentos na prévia.')
    const outros = resultado.errors.filter((err) => err.type !== 'Quotes')
    for (const err of outros.slice(0, 3)) av.push(`linha ${(err.row ?? 0) + 2}: ${err.message}`)

    setBloqueios(bloq)
    setAvisos(av)
    setRows(bloq.length === 0 ? resultado.data : null)
  }

  function handleImport() {
    if (!rows || rows.length === 0) return
    setResumo(null)
    setInterrompidoNaLinha(null)
    startTransition(async () => {
      let acumulado = RESUMO_VAZIO
      setProgresso({ feitas: 0, total: rows.length })
      for (let inicio = 0; inicio < rows.length; inicio += LINHAS_POR_LOTE) {
        const lote = rows.slice(inicio, inicio + LINHAS_POR_LOTE)
        try {
          // +2: cabeçalho é a linha 1 e a primeira linha de dados é a 2.
          const parcial = desembrulhar(await importarCsv(lote, inicio + 2))
          acumulado = somar(acumulado, parcial)
          setResumo(acumulado)
          setProgresso({ feitas: Math.min(inicio + lote.length, rows.length), total: rows.length })
        } catch (e) {
          setInterrompidoNaLinha(inicio + 2)
          toast.error(e instanceof Error ? e.message : 'Erro ao importar')
          setProgresso(null)
          return
        }
      }
      setProgresso(null)
      toast.success('Importação concluída')
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

      {bloqueios.length > 0 && (
        <div role="alert" className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {bloqueios.map((m, i) => (
            <p key={i}>{m}</p>
          ))}
        </div>
      )}

      {avisos.length > 0 && (
        <div className="rounded border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
          {avisos.map((m, i) => (
            <p key={i}>{m}</p>
          ))}
        </div>
      )}

      {rows && rows.length > 0 && !resumo && !isPending && (
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
          <Button onClick={handleImport} className="w-fit">
            Importar {rows.length} item(ns)
          </Button>
        </div>
      )}

      {progresso && (
        <div role="status" className="flex flex-col gap-1.5 text-sm text-neutral-400">
          <p>
            Importando… {progresso.feitas} de {progresso.total} linhas (não feche esta página)
          </p>
          <progress className="h-2 w-full" value={progresso.feitas} max={progresso.total} />
        </div>
      )}

      {interrompidoNaLinha && (
        <div role="alert" className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          A importação parou na linha {interrompidoNaLinha}. O que está abaixo já foi gravado; escolha o mesmo
          arquivo e importe de novo — as linhas que já existem são ignoradas.
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
