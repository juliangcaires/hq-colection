import { cn } from '@/lib/utils'
import { dicaDoTotal, type ProgressoDaSerie } from '@/lib/progresso-serie'

/**
 * "Tenho X de Y" com barra (R8). A barra é só o reforço visual: o texto ao lado carrega a informação (e o
 * `progressbar` leva o mesmo texto em `aria-valuetext`). Sem Y (nem total informado nem volume numerado) não há
 * barra — só "tenho X" e a explicação, em vez de um total inventado.
 *
 * `compacto`: linha única e barra fina, para caber nas linhas do ranking no celular.
 */
export function ProgressoDaSerieBarra({
  progresso,
  compacto = false,
  className,
}: {
  progresso: ProgressoDaSerie
  compacto?: boolean
  className?: string
}) {
  const { tenho, lidos, total, origem, fracaoTenho, fracaoLidos } = progresso
  const conhecidos = origem === 'conhecidos' ? ' conhecidos' : ''
  const textoTenho = total === null ? `Tenho ${tenho}` : `Tenho ${tenho} de ${total}${conhecidos}`
  const textoLidos = total === null ? `lidos ${lidos}` : `lidos ${lidos} de ${total}${conhecidos}`
  const dica = dicaDoTotal(progresso)

  if (compacto) {
    return (
      <div className={cn('flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground', className)}>
        {total !== null && <Barra tenho={tenho} lidos={lidos} total={total} texto={textoTenho} fracaoTenho={fracaoTenho} fracaoLidos={fracaoLidos} className="h-1 w-14 shrink-0" />}
        <span className="truncate tabular-nums" title={dica || undefined}>{textoTenho}</span>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {total !== null && <Barra tenho={tenho} lidos={lidos} total={total} texto={textoTenho} fracaoTenho={fracaoTenho} fracaoLidos={fracaoLidos} className="h-2" />}
      <p className="text-xs text-muted-foreground tabular-nums">
        <span className="font-medium text-foreground">{textoTenho}</span>
        {tenho > 0 && <> · {textoLidos}</>}
      </p>
      {dica && <p className="text-[11px] text-muted-foreground">{dica}</p>}
    </div>
  )
}

function Barra({
  tenho,
  lidos,
  total,
  texto,
  fracaoTenho,
  fracaoLidos,
  className,
}: {
  tenho: number
  lidos: number
  total: number
  texto: string
  fracaoTenho: number | null
  fracaoLidos: number | null
  className?: string
}) {
  return (
    <div
      role="progressbar"
      aria-label="Volumes que você tem"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={Math.min(tenho, total)}
      aria-valuetext={`${texto}; ${lidos} lidos`}
      className={cn('relative overflow-hidden rounded-full bg-surface-2 ring-1 ring-white/10', className)}
    >
      <span className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${(fracaoTenho ?? 0) * 100}%` }} />
      <span className="absolute inset-y-0 left-0 rounded-full bg-success" style={{ width: `${(fracaoLidos ?? 0) * 100}%` }} />
    </div>
  )
}
