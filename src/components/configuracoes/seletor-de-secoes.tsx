'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { SECOES_COMPARTILHAVEIS, type SecaoCompartilhavel } from '@/lib/compartilhamento'

/** Lista de seções com caixas de seleção (link público e escopo dos amigos usam a mesma). */
export function SeletorDeSecoes({
  valor,
  onChange,
  disabled,
  idBase,
}: {
  valor: SecaoCompartilhavel[]
  onChange: (v: SecaoCompartilhavel[]) => void
  disabled?: boolean
  idBase: string
}) {
  return (
    <ul className="flex flex-col gap-2" aria-label="Seções que aparecem">
      {SECOES_COMPARTILHAVEIS.map((s) => {
        const marcada = valor.includes(s.valor)
        return (
          <li key={s.valor}>
            <label htmlFor={`${idBase}-${s.valor}`} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-2 p-3">
              <Checkbox
                id={`${idBase}-${s.valor}`}
                className="mt-0.5"
                checked={marcada}
                disabled={disabled}
                onCheckedChange={(v) => onChange(v === true ? [...valor, s.valor] : valor.filter((x) => x !== s.valor))}
              />
              <span className="flex flex-col">
                <span className="text-sm font-medium text-foreground">{s.rotulo}</span>
                <span className="text-xs text-muted-foreground">{s.descricao}</span>
              </span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}
