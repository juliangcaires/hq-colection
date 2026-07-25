'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { deleteSerie, updateSerie } from '@/app/(app)/series/actions'
import type { Serie, TagLite, TipoObra } from '@/lib/types'

export function SerieForm({ serie, allTags }: { serie: Serie & { tagIds: string[] }; allTags: TagLite[] }) {
  const router = useRouter()
  const [nome, setNome] = useState(serie.nome)
  const [tipo, setTipo] = useState<TipoObra>(serie.tipo)
  const [editora, setEditora] = useState(serie.editora ?? '')
  const [totalVolumes, setTotalVolumes] = useState(serie.total_volumes?.toString() ?? '')
  const [emPublicacao, setEmPublicacao] = useState(serie.em_publicacao)
  const [observacoes, setObservacoes] = useState(serie.observacoes ?? '')
  const [tagIds, setTagIds] = useState<Set<string>>(new Set(serie.tagIds))
  const [isPending, startTransition] = useTransition()
  const [deleteOpen, setDeleteOpen] = useState(false)

  function toggleTag(id: string) {
    setTagIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSave() {
    startTransition(async () => {
      try {
        await updateSerie(serie.id, {
          nome: nome.trim(),
          tipo,
          editora: editora || null,
          total_volumes: totalVolumes ? Number(totalVolumes) : null,
          em_publicacao: emPublicacao,
          observacoes: observacoes || null,
          tagIds: Array.from(tagIds),
        })
        toast.success('Série atualizada')
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao salvar')
      }
    })
  }

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteSerie(serie.id)
        toast.success('Série excluída')
        router.push('/colecao')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Erro ao excluir')
        setDeleteOpen(false)
      }
    })
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="nome">Nome</Label>
        <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Tipo</Label>
          <Select
            items={[
              { value: 'hq', label: 'HQ' },
              { value: 'manga', label: 'Mangá' },
            ]}
            value={tipo}
            onValueChange={(v) => v && setTipo(v as TipoObra)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hq">HQ</SelectItem>
              <SelectItem value="manga">Mangá</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="editora">Editora</Label>
          <Input id="editora" value={editora} onChange={(e) => setEditora(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="total">Total de volumes</Label>
          <Input
            id="total"
            type="number"
            value={totalVolumes}
            onChange={(e) => setTotalVolumes(e.target.value)}
            placeholder="desconhecido"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox checked={emPublicacao} onCheckedChange={(v) => setEmPublicacao(Boolean(v))} id="em_pub" />
        <Label htmlFor="em_pub" className="font-normal">
          Ainda em publicação
        </Label>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="obs">Observações</Label>
        <Textarea id="obs" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Tags (valem para todos os volumes desta série)</Label>
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((t) => {
            const active = tagIds.has(t.id)
            return (
              <Badge
                key={t.id}
                variant={active ? 'default' : 'outline'}
                className="cursor-pointer text-xs"
                onClick={() => toggleTag(t.id)}
              >
                {t.nome}
              </Badge>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? 'Salvando...' : 'Salvar alterações'}
        </Button>
        <Button variant="ghost" onClick={() => setDeleteOpen(true)} disabled={isPending} className="text-red-400">
          Excluir série
        </Button>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Excluir a série "${serie.nome}"?`}
        description="Os itens ficam avulsos (não são excluídos)."
        confirmLabel="Excluir"
        onConfirm={handleDelete}
        isPending={isPending}
      />
    </div>
  )
}
