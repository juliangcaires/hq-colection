'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { QuickAddForm } from './quick-add-form'

export function QuickAddButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Adicionar item"
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-neutral-100 text-neutral-900 shadow-lg transition-transform hover:scale-105 active:scale-95"
      >
        <Plus className="h-6 w-6" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar à lista de desejos</DialogTitle>
          </DialogHeader>
          <QuickAddForm onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  )
}
