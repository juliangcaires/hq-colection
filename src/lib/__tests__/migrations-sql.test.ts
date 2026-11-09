import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { calcularVolumesFaltantes, serieEstaCompleta, serieEstaLida } from '@/lib/volumes'

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
  for (const f of ['0001_init', '0002_editora_vira_tag', '0003_busca_capa_serie', '0004_serie_tem_numeracao', '0005_remove_view_tags_efetivas', '0006_integridade_indices_e_limites', '0007_funcoes_transacionais_e_resumo', '0008_nota_meia_estrela_e_critica', '0009_nota_e_critica_da_serie', '0010_serie_lida_e_lido_em']) {
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
      const { rows: r } = await db.query<{ faltantes: number[]; completa: boolean; lida: boolean }>(
        `select faltantes, completa, lida from series_com_resumo(null) where id = $1`,
        [rows[0].id]
      )
      const faltantes = calcularVolumesFaltantes(volumes, total)
      const completa = serieEstaCompleta({ totalVolumes: total, temNumeracao: numerada, volumes })
      const lida = serieEstaLida(volumes)
      if (JSON.stringify(r[0].faltantes) !== JSON.stringify(faltantes) || r[0].completa !== completa || r[0].lida !== lida) {
        divergentes.push({ total, numerada, volumes, sql: r[0], ts: { faltantes, completa, lida } })
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
    const dados = { titulo: 'X', tipo: 'hq', estado: 'comprado', prioridade: 2, numero_volume: 1.5, preco: 9.9, loja: '', data_aquisicao: '2026-10-24', nota: null, critica: null, serie_id: null, isbn: '' }
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

describe('nota e crítica (migration 0008)', () => {
  const dados = (extra: object) => JSON.stringify({ titulo: 'N', tipo: 'hq', estado: 'lido', prioridade: 0, ...extra })

  it('item_salvar grava nota de meia estrela e a crítica', async () => {
    const { rows: [{ id }] } = await db.query<{ id: string }>(`select item_salvar(null, $1::jsonb, '{}') as id`, [dados({ nota: 4.5, critica: 'Ótimo' })])
    const { rows: [i] } = await db.query<{ nota: string; critica: string }>(`select nota, critica from itens where id = $1`, [id])
    expect(Number(i.nota)).toBe(4.5)
    expect(i.critica).toBe('Ótimo')
  })

  it('recusa nota fora de 0,5–5 ou que não seja de meia em meia estrela', async () => {
    for (const nota of [4.3, 5.5, 0, -1]) {
      await expect(db.query(`select item_salvar(null, $1::jsonb, '{}')`, [dados({ nota })])).rejects.toThrow()
    }
    for (const nota of [0.5, 1, 2.5, 5]) {
      await expect(db.query(`select item_salvar(null, $1::jsonb, '{}')`, [dados({ nota })])).resolves.toBeDefined()
    }
  })

  it('avaliação da série: própria, replicada só nos lidos da série, ou média (nota nula)', async () => {
    const mk = async (nome: string) =>
      (await db.query<{ s: string }>(`select serie_salvar(null, $1::jsonb, '{}') s`, [JSON.stringify({ nome, tipo: 'hq', tem_numeracao: true })])).rows[0].s
    const serie = await mk('Avaliada')
    const outra = await mk('Outra')
    const item = async (serie_id: string, n: number, estado: string, nota: number | null = null) =>
      (await db.query<{ id: string }>(`select item_salvar(null, $1::jsonb, '{}') as id`, [dados({ serie_id, numero_volume: n, estado, nota })])).rows[0].id
    const lido1 = await item(serie, 1, 'lido', 2)
    const lido2 = await item(serie, 2, 'lido')
    const comprado = await item(serie, 3, 'comprado')
    const deOutra = await item(outra, 1, 'lido', 1)
    const notaItem = async (id: string) => Number((await db.query<{ nota: string | null }>(`select nota from itens where id = $1`, [id])).rows[0].nota)
    const notaSerie = async (id: string) => (await db.query<{ nota: string | null; critica: string | null }>(`select nota, critica from series where id = $1`, [id])).rows[0]

    // Modo "serie": só a série muda, volumes intocados.
    await db.query(`update series set nota = 4.5, critica = 'ótima' where id = $1`, [serie])
    expect(await notaSerie(serie)).toEqual({ nota: '4.5', critica: 'ótima' })
    expect(await notaItem(lido1)).toBe(2)

    // Modo "serie_e_volumes": mesmo filtro da action — só os lidos da própria série.
    const { rows } = await db.query<{ id: string }>(`update itens set nota = 4.5, critica = 'ótima' where serie_id = $1 and estado = 'lido' returning id`, [serie])
    expect(rows.map((r) => r.id).sort()).toEqual([lido1, lido2].sort())
    expect(await notaItem(lido2)).toBe(4.5)
    expect((await db.query<{ nota: string | null }>(`select nota from itens where id = $1`, [comprado])).rows[0].nota).toBeNull()
    expect(await notaItem(deOutra)).toBe(1)

    // Modo "media": nota própria vai a null; a crítica fica.
    await db.query(`update series set nota = null where id = $1`, [serie])
    expect(await notaSerie(serie)).toEqual({ nota: null, critica: 'ótima' })

    // Nota inválida da série é rejeitada pelo banco.
    await expect(db.query(`update series set nota = 4.3 where id = $1`, [serie])).rejects.toThrow()
    await expect(db.query(`update series set nota = 6 where id = $1`, [serie])).rejects.toThrow()
  })

  it('marcar como lido só vale para itens comprados', async () => {
    const mk = async (estado: string) =>
      (await db.query<{ id: string }>(`select item_salvar(null, $1::jsonb, '{}') as id`, [dados({ estado })])).rows[0].id
    const comprado = await mk('comprado')
    const desejo = await mk('desejo')
    const { rows } = await db.query(`update itens set estado = 'lido', nota = 4, critica = 'ok' where id = any($1::uuid[]) and estado = 'comprado' returning id`, [[comprado, desejo]])
    expect(rows).toHaveLength(1)
    expect((await db.query<{ estado: string }>(`select estado from itens where id = $1`, [desejo])).rows[0].estado).toBe('desejo')
  })
})

describe('serie_marcar_lida (migration 0010)', () => {
  const dados = (extra: object) => JSON.stringify({ titulo: 'V', tipo: 'hq', prioridade: 0, ...extra })
  const mkSerie = async (nome: string) =>
    (await db.query<{ s: string }>(`select serie_salvar(null, $1::jsonb, '{}') s`, [JSON.stringify({ nome, tipo: 'hq', tem_numeracao: true })])).rows[0].s
  const mkItem = async (serie_id: string, n: number, estado: string, nota: number | null = null, critica: string | null = null) =>
    (await db.query<{ id: string }>(`select item_salvar(null, $1::jsonb, '{}') as id`, [dados({ serie_id, numero_volume: n, estado, nota, critica })])).rows[0].id
  const estadoDe = async (id: string) =>
    (await db.query<{ estado: string; nota: string | null; critica: string | null; lido_em: string | null }>(`select estado, nota, critica, lido_em::text from itens where id = $1`, [id])).rows[0]
  const marcar = async (serie: string, nota: number | null, critica: string | null, modo: string, marcar = true) =>
    (await db.query<{ r: { marcados: number; avaliados: number; criticas: number; desejos_ignorados: number; snapshot: unknown } }>(
      `select serie_marcar_lida($1, $2, $3, $4, $5) r`, [serie, nota, critica, modo, marcar])).rows[0].r

  it('só comprado vira lido; desejo fica de fora e é contado', async () => {
    const s = await mkSerie('Lida 1')
    const c1 = await mkItem(s, 1, 'comprado')
    const c2 = await mkItem(s, 2, 'comprado')
    const l3 = await mkItem(s, 3, 'lido')
    const d4 = await mkItem(s, 4, 'desejo')
    const r = await marcar(s, null, null, 'serie')
    expect(r.marcados).toBe(2)
    expect(r.desejos_ignorados).toBe(1)
    expect((await estadoDe(c1)).estado).toBe('lido')
    expect((await estadoDe(c2)).lido_em).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect((await estadoDe(l3)).estado).toBe('lido')
    expect((await estadoDe(d4)).estado).toBe('desejo')
  })

  it("modo 'serie': nota só na série, volumes sem nota nova; crítica só nos volumes sem crítica", async () => {
    const s = await mkSerie('Lida 2')
    const a = await mkItem(s, 1, 'comprado')
    const b = await mkItem(s, 2, 'lido', 2, 'minha crítica')
    const r = await marcar(s, 4.5, 'da série', 'serie')
    expect(r.avaliados).toBe(0)
    expect(r.criticas).toBe(1)
    expect(Number((await estadoDe(b)).nota)).toBe(2)
    expect((await estadoDe(b)).critica).toBe('minha crítica')
    expect((await estadoDe(a)).nota).toBeNull()
    expect((await estadoDe(a)).critica).toBe('da série')
    const { rows: [ser] } = await db.query<{ nota: string; critica: string }>(`select nota, critica from series where id = $1`, [s])
    expect(ser).toEqual({ nota: '4.5', critica: 'da série' })
  })

  it("modo 'serie_e_sem_nota' não toca volume já avaliado", async () => {
    const s = await mkSerie('Lida 3')
    const sem = await mkItem(s, 1, 'comprado')
    const com = await mkItem(s, 2, 'lido', 1.5)
    const r = await marcar(s, 5, null, 'serie_e_sem_nota')
    expect(r.avaliados).toBe(1)
    expect(Number((await estadoDe(sem)).nota)).toBe(5)
    expect(Number((await estadoDe(com)).nota)).toBe(1.5)
  })

  it("modo 'serie_e_todos' substitui as notas, mas nunca a crítica do volume", async () => {
    const s = await mkSerie('Lida 4')
    const a = await mkItem(s, 1, 'lido', 1, 'crítica antiga')
    const b = await mkItem(s, 2, 'comprado')
    const r = await marcar(s, 3.5, 'nova', 'serie_e_todos')
    expect(r.avaliados).toBe(2)
    expect(Number((await estadoDe(a)).nota)).toBe(3.5)
    expect((await estadoDe(a)).critica).toBe('crítica antiga')
    expect((await estadoDe(b)).critica).toBe('nova')
  })

  it('desfazer restaura estado, nota, crítica, lido_em e a avaliação da série', async () => {
    const s = await mkSerie('Lida 5')
    await db.query(`update series set nota = 2, critica = 'antes' where id = $1`, [s])
    const a = await mkItem(s, 1, 'comprado')
    const b = await mkItem(s, 2, 'lido', 4, null)
    const antesB = await estadoDe(b)
    const r = await marcar(s, 5, 'depois', 'serie_e_todos')
    expect((await estadoDe(a)).estado).toBe('lido')
    const { rows: [{ n }] } = await db.query<{ n: number }>(`select serie_desfazer_marcacao($1, $2::jsonb) n`, [s, JSON.stringify(r.snapshot)])
    expect(n).toBe(2)
    expect(await estadoDe(a)).toEqual({ estado: 'comprado', nota: null, critica: null, lido_em: null })
    expect(await estadoDe(b)).toEqual(antesB)
    const { rows: [ser] } = await db.query<{ nota: string; critica: string }>(`select nota, critica from series where id = $1`, [s])
    expect(ser).toEqual({ nota: '2.0', critica: 'antes' })
  })

  it('sem nada a marcar, recusa; só avaliar (p_marcar_lidos=false) não mexe em comprado', async () => {
    const s = await mkSerie('Lida 6')
    const c = await mkItem(s, 1, 'comprado')
    const l = await mkItem(s, 2, 'lido')
    await expect(marcar(await mkSerie('Vazia'), null, null, 'serie')).rejects.toThrow('nada_a_marcar')
    await marcar(s, 3, null, 'serie_e_sem_nota', false)
    expect((await estadoDe(c)).estado).toBe('comprado')
    expect((await estadoDe(c)).nota).toBeNull()
    expect(Number((await estadoDe(l)).nota)).toBe(3)
  })

  it('modo inválido e série alheia são recusados; falha desfaz tudo', async () => {
    const s = await mkSerie('Lida 7')
    const c = await mkItem(s, 1, 'comprado')
    await expect(marcar(s, null, null, 'xyz')).rejects.toThrow('modo_invalido')
    await expect(marcar(s, 4.3, null, 'serie')).rejects.toThrow()
    expect((await estadoDe(c)).estado).toBe('comprado')
    await db.query(`select set_config('app.uid','${OUTRO}',false)`)
    try {
      await expect(marcar(s, null, null, 'serie')).rejects.toThrow('serie_nao_encontrada')
    } finally {
      await db.query(`select set_config('app.uid','${U}',false)`)
    }
  })
})

describe('lido_em (migration 0010)', () => {
  const dados = (extra: object) => JSON.stringify({ titulo: 'L', tipo: 'hq', prioridade: 0, ...extra })
  const lidoEm = async (id: string) => (await db.query<{ l: string | null }>(`select lido_em::text l from itens where id = $1`, [id])).rows[0].l

  it('grava a data de hoje ao virar lido, preserva a editada e limpa ao voltar para comprado', async () => {
    const { rows: [{ id }] } = await db.query<{ id: string }>(`select item_salvar(null, $1::jsonb, '{}') id`, [dados({ estado: 'comprado' })])
    expect(await lidoEm(id)).toBeNull()

    await db.query(`select item_salvar($1, $2::jsonb, '{}')`, [id, dados({ estado: 'lido' })])
    expect(await lidoEm(id)).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    await db.query(`select item_salvar($1, $2::jsonb, '{}')`, [id, dados({ estado: 'lido', lido_em: '2026-01-15' })])
    expect(await lidoEm(id)).toBe('2026-01-15')

    await db.query(`update itens set estado = 'lido' where id = $1`, [id])
    expect(await lidoEm(id)).toBe('2026-01-15')

    await db.query(`select item_salvar($1, $2::jsonb, '{}')`, [id, dados({ estado: 'comprado', lido_em: '2026-01-15' })])
    expect(await lidoEm(id)).toBeNull()
  })

  it('update em lote (marcarLidoEmLote) preenche lido_em', async () => {
    const { rows: [{ id }] } = await db.query<{ id: string }>(`select item_salvar(null, $1::jsonb, '{}') id`, [dados({ estado: 'comprado' })])
    await db.query(`update itens set estado = 'lido' where id = $1 and estado = 'comprado'`, [id])
    expect(await lidoEm(id)).not.toBeNull()
  })
})
