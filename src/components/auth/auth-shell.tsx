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

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description: string
  children: React.ReactNode
  footer: React.ReactNode
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-[120px]"
      />

      <div className="relative flex w-full max-w-md flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">Minha Coleção</h1>
            <p className="mt-1 text-sm text-muted-foreground">HQs e mangás — uso pessoal</p>
          </div>
        </div>

        <div className="w-full rounded-2xl border border-border bg-card p-8 shadow-xl shadow-black/20">
          <div className="mb-6 flex flex-col gap-1">
            <h2 className="font-heading text-xl font-semibold text-foreground">{title}</h2>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>

          {children}
        </div>

        <div className="text-sm text-muted-foreground">{footer}</div>
      </div>
    </main>
  )
}
