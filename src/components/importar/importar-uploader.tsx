'use client'

import { useRef, useState, useTransition } from 'react'
import Papa from 'papaparse'
import { toast } from 'sonner'
import { FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ProgressBar } from '@/components/ui/progress-bar'
import { StatTile } from '@/components/ui/stat-tile'
import {
  importarCsv,
  previaImportacao,
  type PreviaImportacao,
  type RascunhoRow,
  type ResumoImportacao,
} from '@/app/(app)/importar/actions'
import { desembrulhar } from '@/lib/resultado'
import { COLUNAS_CSV, LINHAS_POR_LOTE, MAX_LINHAS_CSV, normalizarCabecalho } from '@/lib/csv-importacao'
import { COLUNAS_PLANILHA, LINHAS_POR_LOTE_PREVIA, MAX_BYTES_PLANILHA } from '@/lib/planilha'

const COLUNAS_CONHECIDAS: readonly string[] = [...new Set([...COLUNAS_CSV, ...COLUNAS_PLANILHA])]

const PREVIA_VAZIA: PreviaImportacao = { novos: 0, atualizados: 0, semMudanca: 0, erros: [], atualizacoes: [], novosItens: [], avisos: [] }

function somarPrevia(a: PreviaImportacao, b: PreviaImportacao): PreviaImportacao {
  return {
    novos: a.novos + b.novos,
    atualizados: a.atualizados + b.atualizados,
    semMudanca: a.semMudanca + b.semMudanca,
    erros: [...a.erros, ...b.erros],
    atualizacoes: [...a.atualizacoes, ...b.atualizacoes],
    novosItens: [...a.novosItens, ...b.novosItens],
    avisos: [...a.avisos, ...b.avisos],
  }
}

const RESUMO_VAZIO: ResumoImportacao = {
  itensCriados: 0,
  itensAtualizados: 0,
  itensSemMudanca: 0,
  itensIgnorados: 0,
  seriesCriadas: 0,
  tagsCriadas: 0,
  capasAplicadas: 0,
  erros: [],
}

function somar(a: ResumoImportacao, b: ResumoImportacao): ResumoImportacao {
  return {
    itensCriados: a.itensCriados + b.itensCriados,
    itensAtualizados: a.itensAtualizados + b.itensAtualizados,
    itensSemMudanca: a.itensSemMudanca + b.itensSemMudanca,
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

const LIMITE_LISTA = 100

function abreviar(texto: string, max = 80) {
  return texto.length > max ? `${texto.slice(0, max)}…` : texto
}

export function ImportarUploader() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<RascunhoRow[] | null>(null)
  /** Impedem importar: arquivo vazio, aspas abertas, cabeçalho irreconhecível... */
  const [bloqueios, setBloqueios] = useState<string[]>([])
  const [avisos, setAvisos] = useState<string[]>([])
  const [resumo, setResumo] = useState<ResumoImportacao | null>(null)
  const [previa, setPrevia] = useState<PreviaImportacao | null>(null)
  const [analisando, setAnalisando] = useState<{ feitas: number; total: number } | null>(null)
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
    setPrevia(null)
    setAnalisando(null)
    setRows(null)
    setBloqueios([])
    setAvisos([])
    setInterrompidoNaLinha(null)

    if (file.size > MAX_BYTES_PLANILHA) {
      setBloqueios([`O arquivo tem ${(file.size / 1024 / 1024).toFixed(1)} MB; o máximo é ${MAX_BYTES_PLANILHA / 1024 / 1024} MB. Divida em arquivos menores.`])
      return
    }

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
    const conhecidas = colunas.filter((c) => COLUNAS_CONHECIDAS.includes(c))
    if (!conhecidas.includes('titulo') && !conhecidas.includes('serie') && !conhecidas.includes('id')) {
      bloq.push(
        `Não encontrei as colunas "id", "titulo" ou "serie" no cabeçalho (vi: ${colunas.slice(0, 6).join(', ') || 'nenhuma'}).`
      )
    }
    const desconhecidas = colunas.filter((c) => c && !COLUNAS_CONHECIDAS.includes(c))
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
    const linhas = bloq.length === 0 ? resultado.data : null
    setRows(linhas)
    if (linhas) await analisar(linhas)
  }

  /** Prévia obrigatória: lê o arquivo todo no servidor, sem gravar, e mostra o que mudaria. */
  async function analisar(linhas: RascunhoRow[]) {
    let acumulada = PREVIA_VAZIA
    setAnalisando({ feitas: 0, total: linhas.length })
    try {
      for (let inicio = 0; inicio < linhas.length; inicio += LINHAS_POR_LOTE_PREVIA) {
        const lote = linhas.slice(inicio, inicio + LINHAS_POR_LOTE_PREVIA)
        acumulada = somarPrevia(acumulada, desembrulhar(await previaImportacao(lote, inicio + 2)))
        setAnalisando({ feitas: Math.min(inicio + lote.length, linhas.length), total: linhas.length })
      }
      setPrevia(acumulada)
    } catch (e) {
      setBloqueios([e instanceof Error ? e.message : 'Não foi possível analisar o arquivo'])
      setRows(null)
    } finally {
      setAnalisando(null)
    }
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

  const passo = resumo || progresso ? 3 : rows ? 2 : 1
  const aplicaveis = previa ? previa.novos + previa.atualizados : 0

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex gap-1.5" aria-label="Etapas da importação">
        {['Arquivo', 'Revisar', 'Importar'].map((nome, i) => (
          <li
            key={nome}
            aria-current={passo === i + 1 ? 'step' : undefined}
            className={cn('flex-1 border-t-4 pt-1.5 text-xs', passo >= i + 1 ? 'border-primary text-foreground' : 'border-border text-muted-foreground')}
          >
            {i + 1}. {nome}
          </li>
        ))}
      </ol>

      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
        <FileText className="size-6 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {fileName ?? 'Nenhum arquivo escolhido'}
          {rows && <span className="block text-xs text-muted-foreground">{rows.length} linhas</span>}
        </span>
        <Button variant="outline" className="h-11" onClick={() => fileInputRef.current?.click()}>
          {fileName ? 'Trocar' : 'Escolher CSV'}
        </Button>
      </div>

      {bloqueios.length > 0 && (
        <div role="alert" className="rounded border border-read/50 bg-read/10 p-3 text-sm text-danger-soft-text">
          {bloqueios.map((m, i) => (
            <p key={i}>{m}</p>
          ))}
        </div>
      )}

      {avisos.length > 0 && (
        <div className="rounded border border-warning/45 bg-warning/10 p-3 text-sm text-warning-text">
          {avisos.map((m, i) => (
            <p key={i}>{m}</p>
          ))}
        </div>
      )}

      {analisando && (
        <div role="status" className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          <p>
            Analisando o arquivo… {analisando.feitas} de {analisando.total} linhas (nada foi gravado ainda)
          </p>
          <ProgressBar value={analisando.feitas} max={analisando.total} label="Progresso da análise" />
        </div>
      )}

      {rows && previa && !resumo && !isPending && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Prévia de {rows.length} linha(s). Nada foi gravado: confira abaixo e confirme para aplicar.
          </p>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <StatTile value={previa.novos} label="novo(s)" variant="success" />
            <StatTile value={previa.atualizados} label="atualizado(s)" />
            <StatTile value={previa.semMudanca} label="sem mudança" />
            <StatTile value={previa.erros.length} label="com erro" />
          </div>

          {previa.atualizacoes.length > 0 && (
            <details open className="rounded-xl border border-border bg-card p-3 text-sm">
              <summary className="cursor-pointer font-medium">O que vai mudar ({previa.atualizacoes.length})</summary>
              <ul className="mt-2 flex flex-col gap-2">
                {previa.atualizacoes.slice(0, LIMITE_LISTA).map((a) => (
                  <li key={a.linha} className="rounded-lg bg-surface-2 p-2">
                    <p className="text-foreground">
                      <span className="text-xs text-muted-foreground">linha {a.linha} · </span>
                      {a.rotulo}
                    </p>
                    <ul className="mt-1 text-xs text-muted-foreground">
                      {a.mudancas.map((m) => (
                        <li key={m.campo}>
                          <code>{m.campo}</code>: {abreviar(m.antes)} → <span className="text-foreground">{abreviar(m.depois)}</span>
                        </li>
                      ))}
                      {a.avisos.map((t, i) => (
                        <li key={i} className="text-warning-text">
                          {t}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              {previa.atualizacoes.length > LIMITE_LISTA && (
                <p className="mt-2 text-xs text-muted-foreground">
                  …e mais {previa.atualizacoes.length - LIMITE_LISTA} (todas serão aplicadas).
                </p>
              )}
            </details>
          )}

          {previa.novosItens.length > 0 && (
            <details className="rounded-xl border border-border bg-card p-3 text-sm">
              <summary className="cursor-pointer font-medium">Itens novos ({previa.novosItens.length})</summary>
              <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
                {previa.novosItens.slice(0, LIMITE_LISTA).map((n) => (
                  <li key={n.linha}>
                    linha {n.linha}: {n.rotulo}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {previa.avisos.length > 0 && (
            <details className="rounded-xl border border-warning/45 bg-warning/10 p-3 text-sm text-warning-text">
              <summary className="cursor-pointer">{previa.avisos.length} aviso(s)</summary>
              <ul className="mt-1 list-disc pl-5">
                {previa.avisos.slice(0, LIMITE_LISTA).map((a, i) => (
                  <li key={i}>
                    linha {a.linha}: {a.texto}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {previa.erros.length > 0 && (
            <details open className="rounded-xl border border-read/50 bg-read/10 p-3 text-sm text-danger-soft-text">
              <summary className="cursor-pointer">{previa.erros.length} linha(s) com erro (serão puladas)</summary>
              <ul className="mt-1 list-disc pl-5">
                {previa.erros.slice(0, LIMITE_LISTA).map((e, i) => (
                  <li key={i}>
                    linha {e.linha}: {e.motivo}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <Button onClick={handleImport} disabled={aplicaveis === 0} className="h-12 w-full lg:w-fit">
            {aplicaveis === 0
              ? 'Nada para aplicar'
              : `Confirmar e aplicar (${previa.novos} novo(s), ${previa.atualizados} atualizado(s))`}
          </Button>
        </div>
      )}

      {progresso && (
        <div role="status" className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          <p>
            Importando… {progresso.feitas} de {progresso.total} linhas (não feche esta página)
          </p>
          <ProgressBar value={progresso.feitas} max={progresso.total} label="Progresso da importação" />
        </div>
      )}

      {interrompidoNaLinha && (
        <div role="alert" className="rounded border border-read/50 bg-read/10 p-3 text-sm text-danger-soft-text">
          A importação parou na linha {interrompidoNaLinha}. O que está abaixo já foi gravado; escolha o mesmo
          arquivo e importe de novo — o que já foi aplicado aparece como sem mudança.
        </div>
      )}

      {resumo && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <StatTile value={resumo.itensCriados} label="item(ns) criado(s)" variant="success" />
            <StatTile value={resumo.itensAtualizados} label="item(ns) atualizado(s)" variant="success" />
            <StatTile value={resumo.itensIgnorados + resumo.itensSemMudanca} label="sem mudança" />
            <StatTile value={resumo.seriesCriadas + resumo.tagsCriadas} label="série(s)/tag(s) nova(s)" />
          </div>
          <p className="text-sm text-muted-foreground">{resumo.capasAplicadas} capa(s) aplicada(s) automaticamente (via ISBN)</p>
          {resumo.erros.length > 0 && (
            <details className="rounded-xl border border-warning/45 bg-warning/10 p-3 text-sm text-warning-text">
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
