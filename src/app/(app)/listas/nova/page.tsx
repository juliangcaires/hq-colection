import { FormDeLista } from '@/components/listas/form-de-lista'

export const metadata = { title: 'Nova lista' }

export default function NovaListaPage() {
  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-4">
      <h1 className="font-heading text-[28px] font-extrabold tracking-tight text-foreground">Nova lista</h1>
      <FormDeLista />
    </div>
  )
}
