'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { buscarTagsPorTipo, createTag } from '@/app/(app)/tags/actions'
import type { TagLite, TipoTag } from '@/lib/types'

export function TagTypeCombobox({
  tipo,
  label,
  value,
  onChange,
  multiple = true,
  placeholder,
}: {
  tipo: TipoTag
  label: string
  value: TagLite[]
  onChange: (tags: TagLite[]) => void
  multiple?: boolean
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TagLite[]>([])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      buscarTagsPorTipo(tipo, query).then(setResults).catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [tipo, query, open])

  function isSelected(id: string) {
    return value.some((t) => t.id === id)
  }

  function toggle(tag: TagLite) {
    if (multiple) {
      onChange(isSelected(tag.id) ? value.filter((t) => t.id !== tag.id) : [...value, tag])
    } else {
      onChange([tag])
      setOpen(false)
    }
  }

  async function handleCreate() {
    const nome = query.trim()
    if (!nome) return
    try {
      const id = await createTag({ nome, tipo })
      const novaTag = { id, nome, tipo, cor: null }
      onChange(multiple ? [...value, novaTag] : [novaTag])
      setQuery('')
      if (!multiple) setOpen(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Erro ao criar ${label.toLowerCase()}`)
    }
  }

  const triggerLabel =
    value.length === 0
      ? placeholder || `${label}...`
      : multiple
        ? `${value.length} selecionada(s)`
        : value[0].nome

  const semResultadoExato = query.trim() && !results.some((r) => r.nome.toLowerCase() === query.trim().toLowerCase())

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-neutral-400">{label}</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={cn(buttonVariants({ variant: 'outline' }), 'w-full justify-start font-normal')}
        >
          {triggerLabel}
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder={`Buscar ${label.toLowerCase()}...`} value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>
                {semResultadoExato ? (
                  <button
                    className="w-full px-2 py-1.5 text-left text-sm hover:text-neutral-100"
                    onClick={handleCreate}
                  >
                    + Criar &quot;{query.trim()}&quot;
                  </button>
                ) : (
                  'Nenhuma tag encontrada'
                )}
              </CommandEmpty>
              <CommandGroup>
                {results.map((tag) => (
                  <CommandItem key={tag.id} value={tag.id} onSelect={() => toggle(tag)}>
                    {isSelected(tag.id) ? '✓ ' : ''}
                    {tag.nome}
                  </CommandItem>
                ))}
              </CommandGroup>
              {semResultadoExato && results.length > 0 && (
                <div className="border-t border-neutral-800 p-1">
                  <button
                    className="w-full px-2 py-1.5 text-left text-sm hover:text-neutral-100"
                    onClick={handleCreate}
                  >
                    + Criar &quot;{query.trim()}&quot;
                  </button>
                </div>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {multiple && value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((tag) => (
            <Badge
              key={tag.id}
              variant="outline"
              className="cursor-pointer text-xs"
              onClick={() => onChange(value.filter((t) => t.id !== tag.id))}
            >
              {tag.nome} ×
            </Badge>
          ))}
        </div>
      )}
      {!multiple && value.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit self-start text-xs text-neutral-500"
          onClick={() => onChange([])}
        >
          limpar
        </Button>
      )}
    </div>
  )
}
