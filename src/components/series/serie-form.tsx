'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { TagTypeCombobox } from '@/components/tags/tag-type-combobox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { deleteSerie, updateSerie } from '@/app/(app)/series/actions'
import { agruparTagsPorTipo, TIPOS_TAG_DEDICADOS } from '@/lib/tags-por-tipo'
import type { Serie, TagLite, TipoObra, TipoTag } from '@/lib/types'

export function SerieForm({ serie, allTags }: { serie: Serie & { tagIds: string[] }; allTags: TagLite[] }) {
  const router = useRouter()
  const [nome, setNome] = useState(serie.nome)
  const [tipo, setTipo] = useState<TipoObra>(serie.tipo)
  const [totalVolumes, setTotalVolumes] = useState(serie.total_volumes?.toString() ?? '')
  const [emPublicacao, setEmPublicacao] = useState(serie.em_publicacao)
  // `Boolean(...)` porque a coluna é nova: antes da migration rodar o campo vem
  // undefined e o Checkbox viraria não-controlado.
  const [temNumeracao, setTemNumeracao] = useState(Boolean(serie.tem_numeracao))
  const [observacoes, setObservacoes] = useState(serie.observacoes ?? '')
  const [tagsPorTipo, setTagsPorTipo] = useState<Record<TipoTag, TagLite[]>>(() =>
    agruparTagsPorTipo(serie.tagIds, allTags)
  )
  const [isPending, startTransition] = useTransition()
  const [deleteOpen, setDeleteOpen] = useState(false)

  function handleSave() {
    startTransition(async () => {
      try {
        const tagIds = Object.values(tagsPorTipo).flatMap((tags) => tags.map((t) => t.id))
        await updateSerie(serie.id, {
          nome: nome.trim(),
          tipo,
          total_volumes: totalVolumes ? Number(totalVolumes) : null,
          em_publicacao: emPublicacao,
          tem_numeracao: temNumeracao,
          observacoes: observacoes || null,
          tagIds,
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
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="nome">Nome</Label>
        <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label>Tipo</Label>
          <Select
            items={[
              { value: 'hq', label: 'HQ' },
              { value: 'manga', label: 'Mangá' },
            ]}
            value={tipo}
            onValueChange={(v) => v && setTipo(v as TipoObra)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hq">HQ</SelectItem>
              <SelectItem value="manga">Mangá</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
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

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Checkbox checked={emPublicacao} onCheckedChange={(v) => setEmPublicacao(Boolean(v))} id="em_pub" />
          <Label htmlFor="em_pub" className="font-normal">
            Ainda em publicação
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            checked={temNumeracao}
            onCheckedChange={(v) => setTemNumeracao(Boolean(v))}
            id="tem_num"
          />
          <Label htmlFor="tem_num" className="font-normal">
            Tem numeração
          </Label>
        </div>
        <p className="text-xs text-muted-foreground">
          Com numeração ligada, &ldquo;Adicionar volumes&rdquo; passa a exigir o número de cada volume
          marcado, sem repetir número dentro da série.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="obs">Observações</Label>
        <Textarea id="obs" value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} />
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">
          Tags desta série — valem para todos os volumes dela (herança automática)
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {TIPOS_TAG_DEDICADOS.map(({ tipo: tipoTag, label, multiple }) => (
            <TagTypeCombobox
              key={tipoTag}
              tipo={tipoTag}
              label={label}
              multiple={multiple}
              value={tagsPorTipo[tipoTag]}
              onChange={(tags) => setTagsPorTipo((prev) => ({ ...prev, [tipoTag]: tags }))}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? 'Salvando...' : 'Salvar alterações'}
        </Button>
        <Button variant="ghost" onClick={() => setDeleteOpen(true)} disabled={isPending} className="text-destructive">
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
