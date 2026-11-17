'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { buscarObrasDeAmigos, desvincularObra, vincularObra } from '@/app/(app)/amigos/actions'
import { desembrulhar } from '@/lib/resultado'
import { rotuloObraDeAmigo, type ObraDeAmigo } from '@/lib/notas-amigos'

/**
 * "É a mesma obra que…": o usuário escolhe um volume de um amigo e passa a ver as notas daquele amigo como
 * se fossem desta obra. Vale só na visão dele; desfazer a qualquer momento.
 */
export function VinculoDeObra({
  itemId,
  obraChave,
  vinculos,
}: {
  itemId: string
  obraChave: string
  vinculos: (ObraDeAmigo & { disponivel: boolean })[]
}) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState<ObraDeAmigo[] | null>(null)
  const [escolhido, setEscolhido] = useState<ObraDeAmigo | null>(null)
  const [pendente, startTransition] = useTransition()

  function fechar() {
    setAberto(false)
    setTermo('')
    setResultados(null)
    setEscolhido(null)
  }

  function buscar() {
    startTransition(async () => {
      try {
        setResultados(desembrulhar(await buscarObrasDeAmigos(termo)))
        setEscolhido(null)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível buscar')
      }
    })
  }

  function vincular() {
    if (!escolhido) return
    startTransition(async () => {
      try {
        desembrulhar(await vincularObra(obraChave, escolhido.obraChave, itemId))
        toast.success('Vínculo criado: só você vê essa ligação')
        fechar()
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível vincular')
      }
    })
  }

  function desfazer(chaveAmigo: string) {
    startTransition(async () => {
      try {
        desembrulhar(await desvincularObra(obraChave, chaveAmigo, itemId))
        toast.success('Vínculo desfeito')
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível desfazer')
      }
    })
  }

  return (
    <section aria-label="Vínculo com obra de amigo" className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2/60 p-3 text-sm">
      {vinculos.length > 0 && (
        <ul className="flex flex-col gap-2">
          {vinculos.map((v) => (
            <li key={v.obraChave} className="flex flex-wrap items-center gap-3">
              <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <p className="min-w-0 flex-1">
                <span className="font-medium">Mesma obra que </span>
                {v.disponivel ? rotuloObraDeAmigo(v) : 'um item de amigo que não está mais disponível'}
              </p>
              <Button variant="outline" className="h-10" disabled={pendente} onClick={() => desfazer(v.obraChave)}>
                Desfazer
              </Button>
            </li>
          ))}
        </ul>
      )}
      {!aberto ? (
        <div>
          <Button variant="outline" className="h-10 gap-2" onClick={() => setAberto(true)}>
            <Link2 className="size-4" aria-hidden />É a mesma obra que…
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="font-medium">É a mesma obra que… (um volume de um amigo)</p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              buscar()
            }}
          >
            <Input value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Título ou série do amigo" aria-label="Buscar entre os itens dos amigos" maxLength={80} />
            <Button type="submit" className="h-10" disabled={pendente || termo.trim().length < 2}>
              Buscar
            </Button>
          </form>
          {resultados && resultados.length === 0 && <p className="text-muted-foreground">Nenhum item de amigo encontrado (só aparece o que eles compartilham).</p>}
          {resultados && resultados.length > 0 && (
            <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto">
              {resultados.map((r) => (
                <li key={`${r.apelido}|${r.obraChave}`}>
                  <button
                    type="button"
                    onClick={() => setEscolhido(r)}
                    aria-pressed={escolhido === r}
                    className={`min-h-10 w-full rounded-lg border px-3 py-2 text-left ${escolhido === r ? 'border-primary bg-primary/10' : 'border-border bg-card'}`}
                  >
                    {rotuloObraDeAmigo(r)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">Vale só na sua visão: não muda este item nem o que o seu amigo vê. Dá para desfazer quando quiser.</p>
          <div className="flex gap-2">
            <Button className="h-10" disabled={!escolhido || pendente} onClick={vincular}>
              Vincular
            </Button>
            <Button variant="outline" className="h-10" disabled={pendente} onClick={fechar}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
