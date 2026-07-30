import Link from 'next/link'
import { AuthShell } from '@/components/auth/auth-shell'
import { SubmitButton } from '@/components/auth/submit-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { signIn } from './actions'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>
}) {
  const params = await searchParams

  return (
    <AuthShell
      title="Entrar"
      description="Acesse sua coleção pessoal de HQs e mangás."
      footer={
        <>
          Não tem conta?{' '}
          <Link href="/criar-conta" className="font-medium text-primary hover:underline">
            Criar conta
          </Link>
        </>
      }
    >
      <form action={signIn} className="flex flex-col gap-4">
        {params.error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {params.error}
          </p>
        )}
        {params.message && (
          <p className="rounded-lg border border-chart-2/30 bg-chart-2/10 px-3 py-2 text-sm text-chart-2">
            {params.message}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" name="email" type="email" placeholder="voce@email.com" required className="h-10" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Senha</Label>
          <Input id="password" name="password" type="password" placeholder="••••••••" required minLength={6} className="h-10" />
        </div>

        <SubmitButton pendingLabel="Entrando...">Entrar</SubmitButton>
      </form>
    </AuthShell>
  )
}
