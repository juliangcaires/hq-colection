'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatarFaixasDeVolumes, parseFaixasDeVolumes } from '@/lib/faixas-volumes'

const MAX_PREVIA = 30

export type AnaliseVolumes = {
  numeros: number[]
  /** Erro de leitura do texto (faixa invertida, lixo digitado). */
  erro: string | null
  /** Números que a série já tem. */
  repetidos: number[]
  bloqueado: boolean
}

/**
 * Lê o campo e confronta com o que a série já tem.
 *
 * Espelha a validação da server action para apontar o problema antes de gastar
 * a ida — a autoridade continua sendo o servidor, como em `adicionarItensASerie`.
 * Em série numerada, repetir número é erro; sem numeração, o repetido é só pulado.
 */
export function analisarVolumes({
  texto,
  numerosOcupados,
  temNumeracao,
}: {
  texto: string
  numerosOcupados: number[]
  temNumeracao: boolean
}): AnaliseVolumes {
  const { numeros, erro } = parseFaixasDeVolumes(texto)
  const ocupados = new Set(numerosOcupados)
  const repetidos = numeros.filter((n) => ocupados.has(n))

  return {
    numeros,
    erro,
    repetidos,
    bloqueado: Boolean(erro) || numeros.length === 0 || (temNumeracao && repetidos.length > 0),
  }
}

/** Quantos volumes serão de fato criados (os repetidos são pulados). */
export function volumesQueSeraoCriados(analise: AnaliseVolumes): number[] {
  const repetidos = new Set(analise.repetidos)
  return analise.numeros.filter((n) => !repetidos.has(n))
}

export function CriarVolumesFields({
  id,
  texto,
  onTextoChange,
  analise,
  faltantes,
  temNumeracao,
  disabled,
}: {
  id: string
  texto: string
  onTextoChange: (valor: string) => void
  analise: AnaliseVolumes
  /** Furos da série, para o atalho de preenchimento. Vazio esconde o botão. */
  faltantes: number[]
  temNumeracao: boolean
  disabled?: boolean
}) {
  const aCriar = volumesQueSeraoCriados(analise)
  const exibidos = aCriar.slice(0, MAX_PREVIA)
  const ocultos = aCriar.length - exibidos.length

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id}>Volumes</Label>
        <Input
          id={id}
          value={texto}
          onChange={(e) => onTextoChange(e.target.value)}
          placeholder="1-3, 5-7"
          inputMode="numeric"
          aria-invalid={Boolean(analise.erro)}
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          Aceita faixas e números soltos. Exemplo: <code>1-3, 5-7, 10</code>.
        </p>
      </div>

      {faltantes.length > 0 && (
        <div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => onTextoChange(formatarFaixasDeVolumes(faltantes))}
          >
            Preencher os que faltam ({faltantes.length})
          </Button>
        </div>
      )}

      {analise.erro && <p className="text-xs text-destructive">{analise.erro}</p>}

      {!analise.erro && analise.repetidos.length > 0 && (
        <p
          className={`text-xs ${temNumeracao ? 'text-destructive' : 'text-amber-400'}`}
        >
          {temNumeracao
            ? `Esta série já tem ${analise.repetidos.map((n) => `#${n}`).join(', ')} — tire da lista.`
            : `${analise.repetidos.map((n) => `#${n}`).join(', ')} já existem na série e serão pulados.`}
        </p>
      )}

      {aCriar.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {aCriar.length === 1 ? 'Será criado 1 volume:' : `Serão criados ${aCriar.length} volumes:`}
          </span>{' '}
          {exibidos.map((n) => `#${n}`).join(', ')}
          {ocultos > 0 ? ` e mais ${ocultos}` : ''}
        </p>
      )}
    </div>
  )
}
