import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { APELIDOS_DE_EDITORA } from '@/lib/editoras'
import { normalizarTexto } from '@/lib/texto'

describe('APELIDOS_DE_EDITORA', () => {
  it('bate com a semente da migration 0011', () => {
    const sql = readFileSync(path.resolve(__dirname, '../../../supabase/migrations/0011_catalogo_edicoes.sql'), 'utf8')
    const bloco = sql.slice(sql.indexOf('insert into editora_apelidos'), sql.indexOf(';', sql.indexOf('insert into editora_apelidos')))
    const doSql = Array.from(bloco.matchAll(/\('([^']+)', '([^']+)'\)/g), (m) => [m[1], m[2]])
    expect(APELIDOS_DE_EDITORA.map((p) => [...p])).toEqual(doSql)
  })

  it('todo apelido já está normalizado', () => {
    for (const [apelido] of APELIDOS_DE_EDITORA) expect(normalizarTexto(apelido)).toBe(apelido)
  })
})
