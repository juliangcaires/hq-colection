'use client'

import { createContext, useContext, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { QuickAddForm } from './quick-add-form'
import { QuickAddIsbn } from './quick-add-isbn'

const QuickAddContext = createContext<{ abrir: () => void } | null>(null)

export function useQuickAdd() {
  const ctx = useContext(QuickAddContext)
  if (!ctx) throw new Error('useQuickAdd precisa estar dentro de <QuickAddProvider>')
  return ctx
}

export function QuickAddProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [aba, setAba] = useState<'manual' | 'isbn'>('manual')
  // ISBN que a busca não achou: o cadastro manual abre com ele preenchido.
  const [isbnManual, setIsbnManual] = useState('')

  function fechar() {
    setOpen(false)
    setIsbnManual('')
  }

  return (
    <QuickAddContext.Provider value={{ abrir: () => setOpen(true) }}>
      {children}
      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : fechar())}>
        <DialogContent className="top-auto bottom-0 max-h-[90dvh] max-w-lg translate-y-0 overflow-y-auto rounded-b-none rounded-t-3xl border-t border-border-strong bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] ring-0 sm:max-w-lg lg:top-1/2 lg:bottom-auto lg:max-w-[560px] lg:-translate-y-1/2 lg:rounded-[20px] lg:border lg:p-6">
          <DialogHeader>
            <DialogTitle>Adicionar à lista de desejos</DialogTitle>
          </DialogHeader>
          <SegmentedControl
            ariaLabel="Forma de cadastro"
            value={aba}
            onChange={setAba}
            options={[
              { value: 'manual', label: 'Manual' },
              { value: 'isbn', label: 'Por ISBN' },
            ]}
          />
          {aba === 'isbn' ? (
            <QuickAddIsbn
              onDone={fechar}
              onCadastroManual={(isbn13) => {
                setIsbnManual(isbn13)
                setAba('manual')
              }}
            />
          ) : (
            // `key` remonta o formulário quando chega um ISBN novo da busca que não achou nada.
            <QuickAddForm key={isbnManual} onDone={fechar} isbnInicial={isbnManual} />
          )}
        </DialogContent>
      </Dialog>
    </QuickAddContext.Provider>
  )
}
