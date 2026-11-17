import Image from 'next/image'
import { corDoAvatar, iniciaisDoApelido, urlDeAvatarValida } from '@/lib/avatar'
import { cn } from '@/lib/utils'

/**
 * Avatar único do app: a foto da pessoa ou, sem foto, as iniciais do apelido num círculo de cor fixa.
 * Sem hooks nem estado, então serve em componentes de servidor e de cliente.
 * `nome` é só o texto alternativo; a cor e as iniciais vêm de `apelido` (cai em `nome` se não houver).
 */
export function Avatar({
  apelido,
  nome,
  url,
  size = 40,
  className,
}: {
  apelido?: string | null
  nome?: string | null
  url?: string | null
  size?: number
  className?: string
}) {
  const base = apelido || nome || ''
  const foto = urlDeAvatarValida(url)
  const estilo = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.4)) }
  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-heading font-bold text-white select-none', className)}
      style={{ ...estilo, backgroundColor: foto ? undefined : corDoAvatar(base) }}
      role="img"
      aria-label={`Foto de ${nome || apelido || 'perfil'}`}
    >
      {foto ? <Image unoptimized src={foto} alt="" width={size} height={size} className="size-full object-cover" /> : iniciaisDoApelido(base)}
    </span>
  )
}
