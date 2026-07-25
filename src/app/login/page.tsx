import { signIn, signUp } from './actions'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>
}) {
  const params = await searchParams

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Minha Coleção</h1>
        <p className="text-sm text-neutral-400">HQs e mangás — uso pessoal</p>
      </div>

      {params.error && (
        <p className="rounded border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
          {params.error}
        </p>
      )}
      {params.message && (
        <p className="rounded border border-emerald-900 bg-emerald-950 px-3 py-2 text-sm text-emerald-300">
          {params.message}
        </p>
      )}

      <form className="flex flex-col gap-3">
        <input
          name="email"
          type="email"
          placeholder="E-mail"
          required
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        <input
          name="password"
          type="password"
          placeholder="Senha"
          required
          minLength={6}
          className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
        <div className="flex gap-2">
          <button
            formAction={signIn}
            className="flex-1 rounded bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900"
          >
            Entrar
          </button>
          <button
            formAction={signUp}
            className="flex-1 rounded border border-neutral-700 px-3 py-2 text-sm font-medium"
          >
            Criar conta
          </button>
        </div>
      </form>
    </main>
  )
}
