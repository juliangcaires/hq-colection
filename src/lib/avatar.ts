/**
 * Foto de perfil: cor e iniciais do fallback, e validação da URL guardada em `perfis.avatar_url`.
 * Tudo puro (sem DOM), para o mesmo `Avatar` servir servidor e cliente.
 */

/**
 * Paleta do fallback: fundos escuros o bastante para o texto branco passar de 4,5:1 (WCAG AA) tanto no tema
 * claro quanto no escuro. Cores fixas (não variáveis de tema), então a mesma pessoa tem a mesma cor em
 * qualquer tela, tema ou aparelho.
 */
export const PALETA_AVATAR = [
  '#b91c1c', // vermelho
  '#c2410c', // laranja
  '#a16207', // âmbar
  '#15803d', // verde
  '#0f766e', // azul-petróleo
  '#0369a1', // azul
  '#4338ca', // índigo
  '#7e22ce', // roxo
  '#be185d', // rosa
  '#475569', // ardósia
] as const

/** FNV-1a de 32 bits: estável, sem dependência e bem distribuído para textos curtos. */
function hash(texto: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Cor de fundo fixa por pessoa, derivada do apelido (sem diferenciar maiúsculas). */
export function corDoAvatar(apelido: string | null | undefined): string {
  const base = (apelido ?? '').trim().toLowerCase()
  return PALETA_AVATAR[hash(base) % PALETA_AVATAR.length]
}

/** Até duas letras: "maria_silva" → "MS", "julian" → "JU". Sem nome, "?". */
export function iniciaisDoApelido(apelido: string | null | undefined): string {
  const partes = (apelido ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
  if (partes.length === 0) return '?'
  const letras = partes.length > 1 ? partes[0][0] + partes[1][0] : partes[0].slice(0, 2)
  return letras.toUpperCase()
}

export const BUCKET_AVATARES = 'avatares'

/** Prefixo público do bucket de avatares (usado pela CSP e por `urlDeAvatarValida`). */
export function prefixoPublicoDeAvatares(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null
  try {
    const u = new URL(supabaseUrl)
    if (u.protocol !== 'https:') return null
    return `${u.origin}/storage/v1/object/public/${BUCKET_AVATARES}/`
  } catch {
    return null
  }
}

/**
 * Só mostra a foto se a URL for exatamente `<bucket público>/<uid>/<32 hex>.<ext>`. `perfis.avatar_url`
 * aceita qualquer https (a pessoa pode gravá-la direto), e uma URL externa viraria rastreador para quem
 * abre o perfil; qualquer outra coisa cai no fallback de iniciais.
 */
export function urlDeAvatarValida(url: string | null | undefined, supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  const prefixo = prefixoPublicoDeAvatares(supabaseUrl)
  if (!url || !prefixo || !url.startsWith(prefixo)) return null
  const resto = url.slice(prefixo.length)
  return /^[0-9a-f-]{36}\/[0-9a-f]{32}\.(jpg|png|webp)$/.test(resto) ? url : null
}

export function urlPublicaDeAvatar(caminho: string, supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  const prefixo = prefixoPublicoDeAvatares(supabaseUrl)
  return prefixo ? `${prefixo}${caminho}` : null
}

/** Caminho no bucket (`<uid>/<arquivo>`) a partir da URL pública válida; usado para apagar o arquivo antigo. */
export function caminhoDeAvatar(url: string | null | undefined, supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  const ok = urlDeAvatarValida(url, supabaseUrl)
  const prefixo = prefixoPublicoDeAvatares(supabaseUrl)
  return ok && prefixo ? ok.slice(prefixo.length) : null
}

/** Lado da foto salva, em pixels (quadrada). */
export const LADO_AVATAR = 256
/** Teto de bytes do arquivo já processado (o bucket repete o limite). */
export const MAX_BYTES_AVATAR = 300 * 1024
