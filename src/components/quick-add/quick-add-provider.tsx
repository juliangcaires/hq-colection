'use client'

import { createContext, useContext, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { QuickAddForm } from './quick-add-form'

const QuickAddContext = createContext<{ abrir: () => void } | null>(null)

export function useQuickAdd() {
  const ctx = useContext(QuickAddContext)
  if (!ctx) throw new Error('useQuickAdd precisa estar dentro de <QuickAddProvider>')
  return ctx
}

export function QuickAddProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <QuickAddContext.Provider value={{ abrir: () => setOpen(true) }}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-auto bottom-0 max-h-[90dvh] max-w-lg translate-y-0 overflow-y-auto rounded-b-none rounded-t-3xl border-t border-border-strong bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] ring-0 sm:max-w-lg lg:top-1/2 lg:bottom-auto lg:max-w-[560px] lg:-translate-y-1/2 lg:rounded-[20px] lg:border lg:p-6">
          <DialogHeader>
            <DialogTitle>Adicionar à lista de desejos</DialogTitle>
          </DialogHeader>
          <QuickAddForm onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </QuickAddContext.Provider>
  )
}
