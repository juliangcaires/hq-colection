import Link from 'next/link'

function BrandMark() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(28 28)">
        <rect
          x={-56 * 0.19}
          y={-56 * 0.24}
          width={56 * 0.32}
          height={56 * 0.48}
          rx={56 * 0.05}
          transform="rotate(-14)"
          fill="#7566d6"
        />
        <rect x={-56 * 0.16} y={-56 * 0.24} width={56 * 0.32} height={56 * 0.48} rx={56 * 0.05} fill="#8b6cf5" />
        <rect
          x={-56 * 0.13}
          y={-56 * 0.24}
          width={56 * 0.32}
          height={56 * 0.48}
          rx={56 * 0.05}
          transform="rotate(14)"
          fill="#f1eef7"
        />
      </g>
    </svg>
  )
}

const MOSAICO = ['#8b6cf5', '#2fbf9a', '#e0912a', '#d16a5c', '#c85fd6', '#8fb4f0', '#7566d6', '#d98ae3']

/** Mosaico decorativo de "capas": blocos de cor girados, só ornamento (aria-hidden). */
function Mosaico({ className }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none grid -rotate-6 grid-cols-4 gap-2 ${className ?? ''}`}>
      {MOSAICO.map((cor, i) => (
        <span key={i} className="aspect-[2/3] rounded-md opacity-80" style={{ background: cor }} />
      ))}
    </div>
  )
}

export function AuthShell({
  title,
  description,
  children,
  footer,
  aba,
}: {
  title: string
  description: string
  children: React.ReactNode
  footer: React.ReactNode
  /** Aba ativa do par Entrar / Criar conta (duas rotas, estilizadas como segmented). */
  aba: 'entrar' | 'criar'
}) {
  return (
    <main className="relative flex min-h-screen overflow-hidden">
      <section className="hidden flex-1 flex-col justify-between gap-10 overflow-hidden border-r border-border bg-card p-12 lg:flex">
        <div className="flex items-center gap-3">
          <BrandMark />
          <span className="font-heading text-2xl font-extrabold text-foreground">Minha Coleção</span>
        </div>
        <Mosaico className="mx-auto w-full max-w-md" />
        <p className="font-heading text-4xl leading-tight font-extrabold text-foreground">
          Saiba o que tem na estante — e o que falta nela.
        </p>
      </section>

      <div className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="flex w-full max-w-[400px] flex-col gap-6">
          <div className="flex flex-col items-center gap-4 text-center lg:hidden">
            <Mosaico className="w-48" />
            <div>
              <h1 className="font-heading text-3xl font-extrabold tracking-tight text-foreground">Minha Coleção</h1>
              <p className="mt-1 text-sm text-muted-foreground">HQs e mangás — uso pessoal</p>
            </div>
          </div>

          <nav aria-label="Entrar ou criar conta" className="flex gap-1 rounded-xl border border-border bg-card p-1">
            {[
              { id: 'entrar', href: '/login', label: 'Entrar' },
              { id: 'criar', href: '/criar-conta', label: 'Criar conta' },
            ].map((t) => (
              <Link
                key={t.id}
                href={t.href}
                aria-current={aba === t.id ? 'page' : undefined}
                className={`flex h-11 flex-1 items-center justify-center rounded-lg text-sm ${
                  aba === t.id ? 'bg-foreground font-semibold text-background' : 'text-muted-foreground'
                }`}
              >
                {t.label}
              </Link>
            ))}
          </nav>

          <div className="flex flex-col gap-1">
            <h2 className="font-heading text-xl font-semibold text-foreground">{title}</h2>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>

          {children}

          <div className="text-center text-sm text-muted-foreground">{footer}</div>
        </div>
      </div>
    </main>
  )
}
