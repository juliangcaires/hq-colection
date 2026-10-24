import Link from 'next/link'
import { AuthShell } from '@/components/auth/auth-shell'
import { SubmitButton } from '@/components/auth/submit-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ERROS_AUTH } from '@/lib/auth-mensagens'
import { signUp } from './actions'

export default async function CriarContaPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>
}) {
  const params = await searchParams
  const erro = params.erro && Object.hasOwn(ERROS_AUTH, params.erro) ? ERROS_AUTH[params.erro as keyof typeof ERROS_AUTH] : null

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
        {erro && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {erro}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" name="email" type="email" placeholder="voce@email.com" required className="h-10" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Senha</Label>
          <Input id="password" name="password" type="password" placeholder="Mínimo 8 caracteres" required minLength={8} maxLength={72} className="h-10" />
        </div>

        <SubmitButton pendingLabel="Criando conta...">Criar conta</SubmitButton>
      </form>
    </AuthShell>
  )
}
