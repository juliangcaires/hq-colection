'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { buscarPrincipaisDeVariante, type CandidatoVariante } from '@/app/(app)/itens/actions'

export function rotuloDoCandidato(c: Pick<CandidatoVariante, 'titulo' | 'numero_volume' | 'serie_nome'>) {
  const numero = c.numero_volume !== null ? ` #${c.numero_volume}` : ''
  return c.serie_nome && !c.titulo.toLowerCase().includes(c.serie_nome.toLowerCase()) ? `${c.titulo}${numero} · ${c.serie_nome}` : `${c.titulo}${numero}`
}

/**
 * "É variante de...": busca o volume normal entre os da própria coleção (pelo título).
 * Controlado: o pai guarda o escolhido; aqui só se busca e se escolhe.
 */
export function VariantePicker({
  valor,
  onChange,
  excluirId,
  sugestoes = [],
  disabled,
}: {
  valor: CandidatoVariante | null
  onChange: (c: CandidatoVariante | null) => void
  /** O próprio item (na página do volume) não pode ser o volume normal dele mesmo. */
  excluirId?: string | null
  /** Candidatos prontos (ex.: mesmo número na mesma série) mostrados antes de digitar. */
  sugestoes?: CandidatoVariante[]
  disabled?: boolean
}) {
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState<CandidatoVariante[]>([])
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const requisicao = useRef(0)

  useEffect(() => {
    const t = termo.trim()
    if (t.length < 2) return
    const minha = ++requisicao.current
    const espera = setTimeout(async () => {
      setBuscando(true)
      const r = await buscarPrincipaisDeVariante(t, excluirId)
      if (minha !== requisicao.current) return
      setBuscando(false)
      if (r.ok) {
        setResultados(r.data)
        setErro(null)
      } else {
        setResultados([])
        setErro(r.erro)
      }
    }, 250)
    return () => clearTimeout(espera)
  }, [termo, excluirId])

  if (valor) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-[10px] bg-surface-2 px-3 py-2 text-sm">
        <span className="min-w-0 truncate">{rotuloDoCandidato(valor)}</span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Tirar vínculo" onClick={() => onChange(null)} disabled={disabled}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>
    )
  }

  const digitando = termo.trim().length >= 2
  const lista = digitando ? resultados : sugestoes
  return (
    <div className="flex flex-col gap-2">
      <Input
        className="h-11 rounded-[10px] bg-surface-2"
        placeholder="Buscar o volume normal pelo título"
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        disabled={disabled}
        aria-label="Buscar o volume normal"
      />
      {erro && <p className="text-xs text-danger-text">{erro}</p>}
      {buscando && <p className="text-xs text-muted-foreground">Buscando…</p>}
      {!buscando && digitando && lista.length === 0 && !erro && <p className="text-xs text-muted-foreground">Nenhum volume encontrado.</p>}
      {lista.length > 0 && (
        <ul className="flex max-h-56 flex-col overflow-y-auto rounded-[10px] border border-border">
          {lista.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center px-3 py-2 text-left text-sm hover:bg-surface-2 focus-visible:bg-surface-2"
                onClick={() => {
                  onChange(c)
                  setTermo('')
                  setResultados([])
                }}
              >
                <span className="truncate">{rotuloDoCandidato(c)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
