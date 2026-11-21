import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ler = (rel: string) => readFileSync(path.resolve(__dirname, '../../app', rel), 'utf8')

const alvos = [
  { nome: 'perfil do amigo', pasta: '(app)/amigos/[apelido]', leitura: 'lerFavoritosDoAmigo' },
  { nome: 'link compartilhado', pasta: 'c/[token]', leitura: 'lerFavoritosDoLink' },
]

describe.each(alvos)('Favoritos só na página principal: $nome', ({ pasta, leitura }) => {
  it('o layout não lê nem mostra os favoritos', () => {
    const layout = ler(`${pasta}/layout.tsx`)
    expect(layout).not.toContain(leitura)
    expect(layout).not.toContain('FaixaFavoritos')
  })

  it('a página raiz lê e mostra a faixa', () => {
    const pagina = ler(`${pasta}/page.tsx`)
    expect(pagina).toContain(leitura)
    expect(pagina).toContain('<FaixaFavoritos')
  })

  it('as subpáginas não leem nem mostram os favoritos', () => {
    // Percorre todas as subpastas do segmento.
    const raiz = path.resolve(__dirname, '../../app', pasta)
    const arquivos: string[] = []
    const andar = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const cheio = path.join(dir, nome)
        if (statSync(cheio).isDirectory()) andar(cheio)
        else if (/\.tsx?$/.test(nome)) arquivos.push(cheio)
      }
    }
    andar(raiz)
    const subpaginas = arquivos.filter((f) => path.dirname(f) !== raiz)
    expect(subpaginas.length).toBeGreaterThan(0)
    for (const f of subpaginas) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toContain(leitura)
      expect(src, f).not.toContain('FaixaFavoritos')
    }
  })
})
