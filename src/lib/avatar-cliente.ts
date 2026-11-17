import { LADO_AVATAR } from '@/lib/avatar'

/**
 * No navegador: corta o centro da imagem em quadrado, reduz para 256x256 e reencoda. Redesenhar no canvas
 * já descarta Exif/GPS e aplica a orientação da foto de celular. O servidor revalida tudo de qualquer jeito.
 */
export async function prepararFotoDePerfil(arquivo: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(arquivo.type)) throw new Error('Use uma imagem JPEG, PNG ou WebP.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(arquivo, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('Não consegui abrir essa imagem.')
  }
  try {
    const lado = Math.min(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = LADO_AVATAR
    canvas.height = LADO_AVATAR
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Seu navegador não conseguiu preparar a imagem.')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, (bitmap.width - lado) / 2, (bitmap.height - lado) / 2, lado, lado, 0, 0, LADO_AVATAR, LADO_AVATAR)
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/webp', 0.85))
    // Navegador sem encoder WebP devolve PNG; JPEG é mais leve para foto.
    if (blob && blob.type === 'image/webp') return blob
    const jpeg = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.88))
    if (!jpeg) throw new Error('Não consegui preparar a imagem.')
    return jpeg
  } finally {
    bitmap.close()
  }
}
