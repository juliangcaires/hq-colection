'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { criarLista, editarLista } from '@/app/(app)/listas/actions'
import { MAX_DESCRICAO_LISTA, MAX_TITULO_LISTA, ROTULOS_TIPO_DE_LISTA, TIPOS_DE_LISTA, type TipoDeLista } from '@/lib/listas'
import { desembrulhar } from '@/lib/resultado'

/** Criar ou editar os dados de uma lista (título, descrição, ordenada, tipo). Sem `lista`, cria e abre a nova. */
export function FormDeLista({ lista }: { lista?: { id: string; titulo: string; descricao: string | null; ordenada: boolean; tipo: TipoDeLista | null } }) {
  const router = useRouter()
  const [titulo, setTitulo] = useState(lista?.titulo ?? '')
  const [descricao, setDescricao] = useState(lista?.descricao ?? '')
  const [ordenada, setOrdenada] = useState(lista?.ordenada ?? false)
  const [tipo, setTipo] = useState<TipoDeLista | ''>(lista?.tipo ?? '')
  const [pendente, startTransition] = useTransition()

  function enviar(e: React.FormEvent) {
    e.preventDefault()
    const dados = { titulo, descricao: descricao.trim() || null, ordenada, tipo: tipo || null }
    startTransition(async () => {
      try {
        if (lista) {
          desembrulhar(await editarLista(lista.id, dados))
          toast.success('Lista salva')
          router.push(`/listas/${lista.id}`)
        } else {
          const id = desembrulhar(await criarLista(dados))
          toast.success('Lista criada. Agora adicione itens da sua coleção.')
          router.push(`/listas/${id}`)
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Não foi possível salvar a lista')
      }
    })
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="lista-titulo">Título</Label>
        <Input id="lista-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={MAX_TITULO_LISTA} placeholder="Ordem de leitura de Batman" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="lista-descricao">Descrição (opcional)</Label>
        <Textarea id="lista-descricao" value={descricao} onChange={(e) => setDescricao(e.target.value)} maxLength={MAX_DESCRICAO_LISTA} rows={3} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="lista-tipo">Tipo (opcional)</Label>
        <select
          id="lista-tipo"
          value={tipo}
          onChange={(e) => setTipo(e.target.value as TipoDeLista | '')}
          className="h-11 w-full rounded-xl border border-input bg-surface-2 px-3 text-base text-foreground md:text-sm"
        >
          <option value="">Sem tipo</option>
          {TIPOS_DE_LISTA.map((t) => (
            <option key={t} value={t}>
              {ROTULOS_TIPO_DE_LISTA[t]}
            </option>
          ))}
        </select>
      </div>
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface-2 p-3">
        <Checkbox className="mt-0.5" checked={ordenada} onCheckedChange={(v) => setOrdenada(v === true)} disabled={pendente} />
        <span className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">Lista ordenada</span>
          <span className="text-xs text-muted-foreground">Mostra os números 1, 2, 3… e deixa você mudar a ordem dos itens (bom para ordem de leitura).</span>
        </span>
      </label>
      <p className="text-xs text-muted-foreground">Só você e os seus amigos aceitos veem as listas. Elas não aparecem no link público da coleção.</p>
      <div className="flex gap-2">
        <Button type="submit" size="lg" disabled={pendente || !titulo.trim()}>
          {lista ? 'Salvar' : 'Criar lista'}
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={() => router.back()} disabled={pendente}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
