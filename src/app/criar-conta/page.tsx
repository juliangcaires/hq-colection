import Link from 'next/link'
import { AuthShell } from '@/components/auth/auth-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { signUp } from './actions'

export default async function CriarContaPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const params = await searchParams

  return (
    <AuthShell
      title="Criar conta"
      description="Crie sua conta pessoal para começar a catalogar sua coleção."
      footer={
        <>
          Já tem conta?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <form action={signUp} className="flex flex-col gap-4">
        {params.error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {params.error}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" name="email" type="email" placeholder="voce@email.com" required className="h-10" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Senha</Label>
          <Input id="password" name="password" type="password" placeholder="Mínimo 6 caracteres" required minLength={6} className="h-10" />
        </div>

        <Button type="submit" className="mt-2 h-10 w-full">
          Criar conta
        </Button>
      </form>
    </AuthShell>
  )
}
