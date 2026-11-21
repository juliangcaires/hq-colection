import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      // O pacote `server-only` lança fora do Next; nos testes (Node puro) ele não faz nada.
      'server-only': path.resolve(import.meta.dirname, 'vitest.server-only.ts'),
    },
  },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
})
