'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import type { TipoTag } from '@/lib/types'
import { createTag, deleteTag, mergeTags, updateTag } from '@/app/(app)/tags/actions'
import { desembrulhar } from '@/lib/resultado'

const TIPOS: { value: TipoTag; label: string }[] = [
  { value: 'personagem', label: 'Personagem' },
  { value: 'editora', label: 'Editora' },
  { value: 'arco', label: 'Arco' },
  { value: 'selo', label: 'Selo' },
  { value: 'autor', label: 'Autor' },
  { value: 'universo', label: 'Universo' },
  { value: 'outro', label: 'Outro' },
]

type TagRow = { id: string; nome: string; tipo: TipoTag; cor: string | null }

export function TagsManager({ initialTags }: { initialTags: TagRow[] }) {
  const [novos, setNovos] = useState<Partial<Record<TipoTag, string>>>({})
  const [tipoAtivo, setTipoAtivo] = useState<TipoTag>('editora')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mergeTarget, setMergeTarget] = useState<string>('')
  const [isPending, startTransition] = useTransition()

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleCreate(tipo: TipoTag) {
    const nome = (novos[tipo] ?? '').trim()
    if (!nome) return
    startTransition(async () => {
      try {
        desembrulhar(await createTag({ nome, tipo }))
        setNovos((prev) => ({ ...prev, [tipo]: '' }))
        toast.success('Tag criada')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao criar tag')
      }
    })
  }

  function handleMerge() {
    if (!mergeTarget || selected.size === 0) return
    const sourceIds = Array.from(selected)
    startTransition(async () => {
      try {
        desembrulhar(await mergeTags(sourceIds, mergeTarget))
        setSelected(new Set())
        setMergeTarget('')
        toast.success('Tags mescladas')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao mesclar')
      }
    })
  }

  const selectedList = initialTags.filter((t) => selected.has(t.id))

  return (
    <div className="flex flex-col gap-6">
      <div role="group" aria-label="Tipo de tag" className="-mx-5 flex gap-2 overflow-x-auto px-5 lg:hidden">
        {TIPOS.map((t) => (
          <button
            key={t.value}
            type="button"
            aria-pressed={tipoAtivo === t.value}
            onClick={() => setTipoAtivo(t.value)}
            className={cn(
              'h-11 shrink-0 rounded-full border px-3.5 text-sm',
              tipoAtivo === t.value ? 'border-primary bg-primary/15 text-foreground' : 'border-border bg-card text-muted-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {selected.size >= 2 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/45 bg-warning/10 p-3 text-sm">
          <span>
            Mesclar {selected.size} tags ({selectedList.map((t) => t.nome).join(', ')}) em:
          </span>
          <Select
            items={selectedList.map((t) => ({ value: t.id, label: t.nome }))}
            value={mergeTarget || null}
            onValueChange={(v) => setMergeTarget(v ?? '')}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="tag de destino" />
            </SelectTrigger>
            <SelectContent>
              {selectedList.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={handleMerge} disabled={!mergeTarget || isPending}>
            Mesclar
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[repeat(auto-fill,minmax(380px,1fr))]">
        {TIPOS.map((t) => {
          const doTipo = initialTags.filter((tag) => tag.tipo === t.value)
          return (
            <section
              key={t.value}
              className={cn('flex-col gap-3 rounded-xl border border-border bg-card p-4', tipoAtivo === t.value ? 'flex' : 'hidden lg:flex')}
            >
              <h2 className="font-heading text-[19px] font-bold text-foreground">
                {t.label} <span className="text-sm font-normal text-muted-foreground">· {doTipo.length}</span>
              </h2>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  handleCreate(t.value)
                }}
              >
                <Input
                  aria-label={`Nova tag de ${t.label.toLowerCase()}`}
                  placeholder={`Nova tag de ${t.label.toLowerCase()}`}
                  value={novos[t.value] ?? ''}
                  onChange={(e) => setNovos((prev) => ({ ...prev, [t.value]: e.target.value }))}
                  className="h-11 rounded-xl bg-surface-2"
                />
                <Button type="submit" className="h-11" disabled={isPending || !(novos[t.value] ?? '').trim()}>
                  Criar
                </Button>
              </form>
              {doTipo.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma tag deste tipo.</p>}
              <div className="flex flex-col divide-y divide-border">
                {doTipo.map((tag) => (
                  <TagRow
                    key={tag.id}
                    tag={tag}
                    selected={selected.has(tag.id)}
                    onToggleSelected={() => toggleSelected(tag.id)}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function TagRow({
  tag,
  selected,
  onToggleSelected,
}: {
  tag: TagRow
  selected: boolean
  onToggleSelected: () => void
}) {
  const [nome, setNome] = useState(tag.nome)
  const [tipo, setTipo] = useState<TipoTag>(tag.tipo)
  const [isPending, startTransition] = useTransition()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const dirty = nome !== tag.nome || tipo !== tag.tipo

  function handleSave() {
    startTransition(async () => {
      try {
        desembrulhar(await updateTag(tag.id, { nome: nome.trim(), tipo }))
        toast.success('Tag atualizada')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao salvar')
      }
    })
  }

  function handleDelete() {
    startTransition(async () => {
      try {
        desembrulhar(await deleteTag(tag.id))
        toast.success('Tag excluída')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao excluir')
        setDeleteOpen(false)
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <Checkbox checked={selected} onCheckedChange={onToggleSelected} aria-label={`Selecionar ${tag.nome} para mesclar`} />
      <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ background: tag.cor ?? 'var(--muted-foreground)' }} />
      <Input
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        className="h-11 min-w-0 flex-1 rounded-xl bg-surface-2"
      />
      <Select items={TIPOS} value={tipo} onValueChange={(v) => v && setTipo(v as TipoTag)}>
        <SelectTrigger className="h-11 w-32 rounded-xl bg-surface-2">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TIPOS.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="ml-auto flex gap-2">
        {dirty && (
          <Button variant="secondary" className="h-11" onClick={handleSave} disabled={isPending}>
            Salvar
          </Button>
        )}
        <Button
          variant="ghost"
          className="size-11 p-0 text-danger-text"
          aria-label={`Excluir ${tag.nome}`}
          onClick={() => setDeleteOpen(true)}
          disabled={isPending}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Excluir a tag "${tag.nome}"?`}
        description="Ela será removida de todas as séries e itens onde está aplicada."
        confirmLabel="Excluir"
        onConfirm={handleDelete}
        isPending={isPending}
      />
    </div>
  )
}
