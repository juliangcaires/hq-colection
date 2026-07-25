'use client'

import { useState } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { TagLite } from '@/lib/types'

export function TagTypeFilter({
  label,
  options,
  selectedIds,
  onChange,
  multiple,
}: {
  label: string
  options: TagLite[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  multiple: boolean
}) {
  const [open, setOpen] = useState(false)

  if (options.length === 0) return null

  const selected = options.filter((o) => selectedIds.includes(o.id))
  const triggerLabel =
    selected.length === 0 ? label : multiple ? `${label}: ${selected.length}` : selected[0].nome

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
          buttonVariants({ variant: selected.length > 0 ? 'secondary' : 'outline' }),
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
