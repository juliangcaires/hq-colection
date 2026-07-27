import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Minha Coleção',
    short_name: 'Coleção',
    description: 'Coleção pessoal de HQs e mangás',
    start_url: '/',
    display: 'standalone',
    background_color: '#100d16',
    theme_color: '#100d16',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  }
}
