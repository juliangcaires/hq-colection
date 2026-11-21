'use client'

import Link from 'next/link'
import { Bell } from 'lucide-react'
import { useNotificacoes, rotuloDoContador } from './notificacoes-provider'

/** Selo com o número de não lidas; some quando não há nenhuma. */
export function SeloDoContador({ className = '' }: { className?: string }) {
  const { naoLidas } = useNotificacoes()
  if (naoLidas <= 0) return null
  return (
    <span
      aria-hidden
      className={`flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-bold text-primary-foreground ${className}`}
    >
      {rotuloDoContador(naoLidas)}
    </span>
  )
}

/** Sininho do cabeçalho do celular: leva a /notificacoes. */
export function Sino() {
  const { naoLidas } = useNotificacoes()
  return (
    <Link
      href="/notificacoes"
      aria-label={naoLidas > 0 ? `Notificações, ${naoLidas} não ${naoLidas === 1 ? 'lida' : 'lidas'}` : 'Notificações'}
      className="relative flex size-11 items-center justify-center rounded-full text-foreground"
    >
      <Bell className="size-5" aria-hidden />
      <SeloDoContador className="absolute top-1 right-0.5" />
    </Link>
  )
}
