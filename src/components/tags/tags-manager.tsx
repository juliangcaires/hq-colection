'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
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
import type { TipoTag } from '@/lib/types'
import { createTag, deleteTag, mergeTags, updateTag } from '@/app/(app)/tags/actions'

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
  const [novoNome, setNovoNome] = useState('')
  const [novoTipo, setNovoTipo] = useState<TipoTag>('outro')
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

  function handleCreate() {
    if (!novoNome.trim()) return
    startTransition(async () => {
      try {
        await createTag({ nome: novoNome.trim(), tipo: novoTipo })
        setNovoNome('')
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
        await mergeTags(sourceIds, mergeTarget)
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
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-neutral-400">Nova tag</label>
          <Input
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            placeholder="Nome"
            className="w-48"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-neutral-400">Tipo</label>
          <Select items={TIPOS} value={novoTipo} onValueChange={(v) => v && setNovoTipo(v as TipoTag)}>
            <SelectTrigger className="w-40">
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
        </div>
        <Button onClick={handleCreate} disabled={isPending || !novoNome.trim()}>
          Adicionar
        </Button>
      </div>

      {selected.size >= 2 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-900 bg-amber-950/40 p-3 text-sm">
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

      <div className="flex flex-col divide-y divide-neutral-800 rounded-lg border border-neutral-800">
        {initialTags.length === 0 && (
          <p className="p-4 text-sm text-neutral-500">Nenhuma tag cadastrada ainda.</p>
        )}
        {initialTags.map((tag) => (
          <TagRow
            key={tag.id}
            tag={tag}
            selected={selected.has(tag.id)}
            onToggleSelected={() => toggleSelected(tag.id)}
          />
        ))}
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
  const dirty = nome !== tag.nome || tipo !== tag.tipo

  function handleSave() {
    startTransition(async () => {
      try {
        await updateTag(tag.id, { nome: nome.trim(), tipo })
        toast.success('Tag atualizada')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao salvar')
      }
    })
  }

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteTag(tag.id)
        toast.success('Tag excluída')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao excluir')
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2 p-3">
      <Checkbox checked={selected} onCheckedChange={onToggleSelected} />
      <Input
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        className="w-44"
      />
      <Select items={TIPOS} value={tipo} onValueChange={(v) => v && setTipo(v as TipoTag)}>
        <SelectTrigger className="w-36">
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
          <Button size="sm" variant="secondary" onClick={handleSave} disabled={isPending}>
            Salvar
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={handleDelete} disabled={isPending}>
          Excluir
        </Button>
      </div>
    </div>
  )
}
