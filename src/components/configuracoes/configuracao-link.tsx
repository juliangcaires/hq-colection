'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Copy, Link2, Link2Off } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SeletorDeSecoes } from '@/components/configuracoes/seletor-de-secoes'
import { atualizarEscopoDoLink, gerarLink, revogarLink } from '@/app/(app)/configuracoes/actions'
import { caminhoDoLink, NUNCA_COMPARTILHADO, type SecaoCompartilhavel } from '@/lib/compartilhamento'
import { desembrulhar } from '@/lib/resultado'

/** Link público somente leitura: gerar, escolher as seções, copiar e revogar. */
export function ConfiguracaoLink({
  tokenInicial,
  escopoInicial,
}: {
  tokenInicial: string | null
  escopoInicial: SecaoCompartilhavel[]
}) {
  const [token, setToken] = useState(tokenInicial)
  const [escopo, setEscopo] = useState<SecaoCompartilhavel[]>(escopoInicial.length ? escopoInicial : ['colecao', 'series'])
  const [salvo, setSalvo] = useState<SecaoCompartilhavel[]>(escopoInicial)
  const [revogando, setRevogando] = useState(false)
  const [isPending, startTransition] = useTransition()

  const url = token && typeof window !== 'undefined' ? `${window.location.origin}${caminhoDoLink(token)}` : token ? caminhoDoLink(token) : ''
  const escopoMudou = token !== null && [...escopo].sort().join() !== [...salvo].sort().join()

  function gerar() {
    startTransition(async () => {
      try {
        const novo = desembrulhar(await gerarLink(escopo))
        setToken(novo)
        setSalvo(escopo)
        toast.success(token ? 'Novo link criado — o anterior deixou de funcionar' : 'Link criado')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível criar o link')
      }
    })
  }

  function salvarEscopo() {
    startTransition(async () => {
      try {
        desembrulhar(await atualizarEscopoDoLink(escopo))
        setSalvo(escopo)
        toast.success('Seções atualizadas')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível salvar')
      }
    })
  }

  function revogar() {
    startTransition(async () => {
      try {
        desembrulhar(await revogarLink())
        setToken(null)
        setSalvo([])
        setRevogando(false)
        toast.success('Link desativado. Quem tinha o endereço não consegue mais abrir.')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível desativar')
      }
    })
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copiado')
    } catch {
      toast.error('Não consegui copiar. Selecione o endereço e copie à mão.')
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-[18px]">
      <h2 className="font-heading text-[19px] font-bold">Compartilhar minha coleção</h2>
      <p className="text-sm text-muted-foreground">
        Gera um link somente leitura que qualquer pessoa pode abrir, sem conta. {NUNCA_COMPARTILHADO} A página não é
        indexada por buscadores.
      </p>

      <SeletorDeSecoes valor={escopo} onChange={setEscopo} disabled={isPending} idBase="link" />

      {token ? (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="link-publico" className="text-sm font-medium">Seu link</label>
            <div className="flex gap-2">
              <Input id="link-publico" readOnly value={url} className="h-11 rounded-[10px] bg-surface-2 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="outline" className="h-11 shrink-0 gap-2" onClick={copiar}>
                <Copy className="size-4" aria-hidden />
                Copiar
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {escopoMudou && (
              <Button className="h-11" onClick={salvarEscopo} disabled={isPending || escopo.length === 0}>
                Salvar seções
              </Button>
            )}
            <Button variant="outline" className="h-11 gap-2" onClick={gerar} disabled={isPending || escopo.length === 0}>
              <Link2 className="size-4" aria-hidden />
              Gerar novo link
            </Button>
            <Button variant="outline" className="h-11 gap-2 border-read/50 text-danger-soft-text" onClick={() => setRevogando(true)} disabled={isPending}>
              <Link2Off className="size-4" aria-hidden />
              Desativar link
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">&quot;Gerar novo link&quot; desativa o endereço atual na hora.</p>
        </>
      ) : (
        <Button className="h-11 w-fit gap-2" onClick={gerar} disabled={isPending || escopo.length === 0}>
          <Link2 className="size-4" aria-hidden />
          Gerar link
        </Button>
      )}

      <ConfirmDialog
        open={revogando}
        onOpenChange={setRevogando}
        title="Desativar o link?"
        description="Quem tem o endereço deixa de conseguir abrir a sua coleção. Você pode gerar outro depois."
        confirmLabel="Desativar"
        onConfirm={revogar}
        isPending={isPending}
      />
    </section>
  )
}
