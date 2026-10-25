import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { calcularVolumesFaltantes, serieEstaCompleta } from '@/lib/volumes'

/**
 * Roda as migrations num PostgreSQL em memória (PGlite) com stubs mínimos de `auth` e `storage`.
 * Valida a lógica das funções SQL — e a paridade de `series_com_resumo` com `volumes.ts`.
 * Depois de carregar tudo, os testes rodam como o papel `authenticated` (sem privilégio de superusuário),
 * então a RLS das migrations 0001/0006 vale de verdade — foi assim que se pegou o erro de item_tags no
 * mesmo comando que insere os itens. O que o PGlite não cobre: Storage e o PostgREST.
 */
const PASTA = path.resolve(__dirname, '../../../supabase/migrations')
const U = '11111111-1111-1111-1111-111111111111'
const OUTRO = '99999999-9999-9999-9999-999999999999'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true),'')::uuid $$;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(bucket_id text, name text);
    create function storage.foldername(n text) returns text[] language sql as $$ select string_to_array(n,'/') $$;
    create role authenticated; create role anon;
  `)
  for (const f of ['0001_init', '0002_editora_vira_tag', '0003_busca_capa_serie', '0004_serie_tem_numeracao', '0005_remove_view_tags_efetivas', '0006_integridade_indices_e_limites', '0007_funcoes_transacionais_e_resumo']) {
    await db.exec(readFileSync(path.join(PASTA, `${f}.sql`), 'utf8'))
  }
  await db.exec(`
    insert into auth.users values ('${U}'), ('${OUTRO}');
    grant usage on schema public, auth to authenticated;
    grant all on all tables in schema public to authenticated;
    grant execute on all functions in schema public to authenticated;
    grant execute on function auth.uid() to authenticated;
    select set_config('app.uid','${U}',false);
    set role authenticated;
  `)
}, 60_000)

const rnd = (n: number) => Math.floor(Math.random() * n)
const ESTADOS = ['desejo', 'comprado', 'lido'] as const

describe('series_com_resumo', () => {
  it('dá o mesmo resultado que calcularVolumesFaltantes/serieEstaCompleta', async () => {
    const divergentes: unknown[] = []
    for (let k = 0; k < 150; k++) {
      const total = [null, null, 0, 1, 3, 5, 8, 12][rnd(8)]
      const numerada = Math.random() < 0.5
      const { rows } = await db.query<{ id: string }>(
        `insert into series(user_id,nome,tipo,total_volumes,tem_numeracao) values ($1,$2,'hq',$3,$4) returning id`,
        [U, `Paridade ${k}`, total, numerada]
      )
      const volumes = Array.from({ length: rnd(9) }, () => ({
        numero_volume: [null, 1, 2, 3, 4, 5, 6, 7, 9, 12, 1.5, 2.5, 20][rnd(13)],
        estado: ESTADOS[rnd(3)],
      }))
      for (const v of volumes) {
        await db.query(`insert into itens(user_id,serie_id,titulo,numero_volume,estado) values ($1,$2,'t',$3,$4)`, [U, rows[0].id, v.numero_volume, v.estado])
      }
      const { rows: r } = await db.query<{ faltantes: number[]; completa: boolean }>(
        `select faltantes, completa from series_com_resumo(null) where id = $1`,
        [rows[0].id]
      )
      const faltantes = calcularVolumesFaltantes(volumes, total)
      const completa = serieEstaCompleta({ totalVolumes: total, temNumeracao: numerada, volumes })
      if (JSON.stringify(r[0].faltantes) !== JSON.stringify(faltantes) || r[0].completa !== completa) {
        divergentes.push({ total, numerada, volumes, sql: r[0], ts: { faltantes, completa } })
      }
    }
    expect(divergentes).toEqual([])
  }, 60_000)

  it('filtra pelo padrão ILIKE', async () => {
    const { rows } = await db.query<{ nome: string }>(`select nome from series_com_resumo('%Paridade 14%')`)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.nome.includes('Paridade 14'))).toBe(true)
  })
})

describe('funções transacionais', () => {
  it('item_salvar cria, edita, troca tags e recusa item inexistente', async () => {
    const { rows: [tag] } = await db.query<{ id: string }>(`insert into tags(user_id,nome,tipo) values ($1,'T1','outro') returning id`, [U])
    const dados = { titulo: 'X', tipo: 'hq', estado: 'comprado', prioridade: 2, numero_volume: 1.5, preco: 9.9, loja: '', data_aquisicao: '2026-10-24', nota: null, observacoes: null, serie_id: null, isbn: '' }
    const { rows: [criado] } = await db.query<{ id: string }>(`select item_salvar(null, $1::jsonb, $2::uuid[]) as id`, [JSON.stringify(dados), [tag.id]])
    const item = (await db.query<{ titulo: string; loja: string | null; tags: number }>(`select titulo, loja, (select count(*)::int from item_tags where item_id = itens.id) tags from itens where id = $1`, [criado.id])).rows[0]
    expect(item).toEqual({ titulo: 'X', loja: null, tags: 1 })

    await db.query(`select item_salvar($1, $2::jsonb, '{}')`, [criado.id, JSON.stringify({ ...dados, titulo: 'Y' })])
    const editado = (await db.query<{ titulo: string; tags: number }>(`select titulo, (select count(*)::int from item_tags where item_id = itens.id) tags from itens where id = $1`, [criado.id])).rows[0]
    expect(editado).toEqual({ titulo: 'Y', tags: 0 })

    await expect(db.query(`select item_salvar('33333333-3333-3333-3333-333333333333', $1::jsonb, '{}')`, [JSON.stringify(dados)])).rejects.toThrow('item_nao_encontrado')
  })

  it('item_salvar com tag inexistente desfaz tudo (nada de item pela metade)', async () => {
    const dados = { titulo: 'Atômico', tipo: 'hq', estado: 'desejo', prioridade: 0 }
    await expect(
      db.query(`select item_salvar(null, $1::jsonb, $2::uuid[])`, [JSON.stringify(dados), ['22222222-2222-2222-2222-222222222222']])
    ).rejects.toThrow()
    const { rows } = await db.query(`select 1 from itens where titulo = 'Atômico'`)
    expect(rows).toHaveLength(0)
  })

  it('tags_mesclar reaponta vínculos e apaga as de origem', async () => {
    const mk = async (nome: string) => (await db.query<{ id: string }>(`insert into tags(user_id,nome,tipo) values ($1,$2,'outro') returning id`, [U, nome])).rows[0].id
    const [a, b] = [await mk('MA'), await mk('MB')]
    const { rows: [i] } = await db.query<{ id: string }>(`insert into itens(user_id,titulo) values ($1,'m') returning id`, [U])
    await db.query(`insert into item_tags values ($1,$2)`, [i.id, a])
    await db.query(`select tags_mesclar($1::uuid[], $2)`, [[a], b])
    expect((await db.query(`select 1 from tags where id = $1`, [a])).rows).toHaveLength(0)
    expect((await db.query(`select 1 from item_tags where item_id = $1 and tag_id = $2`, [i.id, b])).rows).toHaveLength(1)
  })

  it('volumes_criar_em_lote: série numerada recusa repetido sem criar nada; sem numeração pula', async () => {
    const { rows: [num] } = await db.query<{ s: string }>(`select serie_salvar(null, '{"nome":"Num","tipo":"hq","tem_numeracao":true}', '{}') s`)
    await db.query(`select volumes_criar_em_lote($1, '{1,2,3}', '{"estado":"comprado"}', '{}')`, [num.s])
    await expect(db.query(`select volumes_criar_em_lote($1, '{3,4}', '{"estado":"comprado"}', '{}')`, [num.s])).rejects.toThrow('volumes_repetidos:3')
    expect((await db.query(`select 1 from itens where serie_id = $1 and numero_volume = 4`, [num.s])).rows).toHaveLength(0)

    const { rows: [sem] } = await db.query<{ s: string }>(`select serie_salvar(null, '{"nome":"Sem","tipo":"hq","tem_numeracao":false}', '{}') s`)
    await db.query(`select volumes_criar_em_lote($1, '{1}', '{"estado":"comprado"}', '{}')`, [sem.s])
    const { rows: [r] } = await db.query<{ r: { criados: unknown[]; ignorados: number[] } }>(`select volumes_criar_em_lote($1, '{1,2}', '{"estado":"comprado"}', '{}') r`, [sem.s])
    expect(r.r.criados).toHaveLength(1)
    expect(r.r.ignorados).toEqual([1])
  })

  it('volumes_criar_em_lote com tags funciona sob RLS (itens e item_tags em comandos separados)', async () => {
    const { rows: [t] } = await db.query<{ id: string }>(`insert into tags(user_id,nome,tipo) values ($1,'VT','outro') returning id`, [U])
    const { rows: [s] } = await db.query<{ s: string }>(`select serie_salvar(null, '{"nome":"ComTags","tipo":"hq","tem_numeracao":true}', '{}') s`)
    await db.query(`select volumes_criar_em_lote($1, '{1,2}', '{"estado":"comprado"}', $2::uuid[])`, [s.s, [t.id]])
    const { rows } = await db.query(`select 1 from item_tags it join itens i on i.id = it.item_id where i.serie_id = $1`, [s.s])
    expect(rows).toHaveLength(2)
  })

  it('outro usuário não usa as funções com dados alheios (RLS)', async () => {
    const { rows: [serie] } = await db.query<{ s: string }>(`select serie_salvar(null, '{"nome":"Minha","tipo":"hq"}', '{}') s`)
    const { rows: [tag] } = await db.query<{ id: string }>(`insert into tags(user_id,nome,tipo) values ($1,'Minha tag','outro') returning id`, [U])
    await db.query(`select set_config('app.uid','${OUTRO}',false)`)
    try {
      await expect(db.query(`select serie_salvar($1, '{"nome":"HACK","tipo":"hq"}', '{}')`, [serie.s])).rejects.toThrow('serie_nao_encontrada')
      await expect(db.query(`select volumes_criar_em_lote($1, '{9}', '{"estado":"comprado"}', '{}')`, [serie.s])).rejects.toThrow('serie_nao_encontrada')
      await expect(db.query(`select item_salvar(null, $1::jsonb, '{}')`, [JSON.stringify({ titulo: 'x', tipo: 'hq', estado: 'desejo', serie_id: serie.s })])).rejects.toThrow()
      await expect(db.query(`select tags_mesclar($1::uuid[], $2)`, [[tag.id], tag.id])).rejects.toThrow('tag_nao_encontrada')
      expect((await db.query(`select 1 from series_com_resumo(null)`)).rows).toHaveLength(0)
    } finally {
      await db.query(`select set_config('app.uid','${U}',false)`)
    }
  })
})
