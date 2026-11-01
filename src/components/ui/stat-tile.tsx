import { cn } from '@/lib/utils'

export function StatTile({
  value,
  label,
  hint,
  variant = 'default',
  className,
}: {
  value: React.ReactNode
  label: string
  hint?: string
  variant?: 'default' | 'success' | 'desejo'
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-[14px] border bg-card p-3 lg:p-4',
        variant === 'desejo' ? 'border-dashed border-warning' : 'border-border',
        className
      )}
    >
      <p
        className={cn(
          'font-heading text-[26px] leading-none font-extrabold lg:text-[34px]',
          variant === 'success' && 'text-success-text',
          variant === 'desejo' && 'text-warning-text'
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground lg:text-[13px]">{label}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
