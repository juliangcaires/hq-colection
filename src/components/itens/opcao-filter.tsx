'use client'

import { useState } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/** Só o que o filtro precisa da opção — `TagLite` e `{ id, nome }` de série satisfazem os dois. */
export type Opcao = { id: string; nome: string }

/**
 * Filtro em combobox (digitável) para uma lista já carregada em memória — a
 * filtragem por digitação é a do cmdk, sem ida ao servidor. Serve tanto para
 * tags quanto para séries.
 */
export function OpcaoFilter({
  label,
  options,
  selectedIds,
  onChange,
  multiple,
  /** Rótulo do item que limpa a seleção (ex. "Todas séries"). Só faz sentido em single. */
  limparLabel,
  /** Resolve o rótulo do trigger. Útil quando `options` está filtrada por outro
   *  filtro (cascata) e a opção selecionada pode não estar mais na lista. */
  nomeSelecionado,
}: {
  label: string
  options: Opcao[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  multiple: boolean
  limparLabel?: string
  nomeSelecionado?: (id: string) => string | undefined
}) {
  const [open, setOpen] = useState(false)

  if (options.length === 0 && selectedIds.length === 0) return null

  const selected = options.filter((o) => selectedIds.includes(o.id))
  const primeiroNome =
    selected[0]?.nome ?? (selectedIds[0] ? nomeSelecionado?.(selectedIds[0]) : undefined)

  const triggerLabel =
    selectedIds.length === 0
      ? label
      : multiple
        ? `${label}: ${selectedIds.length}`
        : (primeiroNome ?? label)

  function toggle(id: string) {
    if (multiple) {
      onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id])
    } else {
      onChange(selectedIds.includes(id) ? [] : [id])
      setOpen(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          buttonVariants({ variant: selectedIds.length > 0 ? 'secondary' : 'outline' }),
          'justify-start font-normal'
        )}
      >
        {triggerLabel}
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Buscar ${label.toLowerCase()}...`} />
          <CommandList>
            <CommandEmpty>Nada encontrado</CommandEmpty>
            <CommandGroup>
              {limparLabel && !multiple && (
                <CommandItem
                  value={limparLabel}
                  onSelect={() => {
                    onChange([])
                    setOpen(false)
                  }}
                >
                  {selectedIds.length === 0 ? '✓ ' : ''}
                  {limparLabel}
                </CommandItem>
              )}
              {options.map((o) => (
                <CommandItem key={o.id} value={o.nome} onSelect={() => toggle(o.id)}>
                  {selectedIds.includes(o.id) ? '✓ ' : ''}
                  {o.nome}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
