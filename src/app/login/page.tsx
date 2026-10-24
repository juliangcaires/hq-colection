import Link from 'next/link'
import { AuthShell } from '@/components/auth/auth-shell'
import { SubmitButton } from '@/components/auth/submit-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AVISOS_AUTH, ERROS_AUTH } from '@/lib/auth-mensagens'
import { signIn } from './actions'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; aviso?: string }>
}) {
  const params = await searchParams
  // Só códigos conhecidos viram texto; qualquer outro valor na URL é ignorado.
  const erro = params.erro && Object.hasOwn(ERROS_AUTH, params.erro) ? ERROS_AUTH[params.erro as keyof typeof ERROS_AUTH] : null
  const aviso = params.aviso && Object.hasOwn(AVISOS_AUTH, params.aviso) ? AVISOS_AUTH[params.aviso as keyof typeof AVISOS_AUTH] : null

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
        {erro && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {erro}
          </p>
        )}
        {aviso && (
          <p className="rounded-lg border border-chart-2/30 bg-chart-2/10 px-3 py-2 text-sm text-chart-2">
            {aviso}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" name="email" type="email" placeholder="voce@email.com" required className="h-10" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Senha</Label>
          <Input id="password" name="password" type="password" placeholder="••••••••" required maxLength={72} className="h-10" />
        </div>

        <SubmitButton pendingLabel="Entrando...">Entrar</SubmitButton>
      </form>
    </AuthShell>
  )
}
