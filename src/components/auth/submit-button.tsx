'use client'

import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'

export function SubmitButton({ children, pendingLabel }: { children: React.ReactNode; pendingLabel: string }) {
  // useFormStatus só enxerga o <form> pai, por isso o botão precisa ser um componente separado.
  const { pending } = useFormStatus()

  return (
    <Button type="submit" disabled={pending} className="mt-2 h-10 w-full">
      {pending ? pendingLabel : children}
    </Button>
  )
}
