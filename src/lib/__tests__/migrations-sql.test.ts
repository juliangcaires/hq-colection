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
  for (const f of ['0001_init', '0002_editora_vira_tag', '0003_busca_capa_serie', '0004_serie_tem_numeracao', '0005_remove_view_tags_efetivas', '0006_integridade_indices_e_limites', '0007_funcoes_transacionais_e_resumo', '0008_nota_meia_estrela_e_critica', '0009_nota_e_critica_da_serie', '0010_serie_lida_e_lido_em', '0011_catalogo_edicoes', '0012_capas_compartilhadas', '0013_compartilhamento']) {
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

describe('catálogo de edições (migration 0011)', () => {
  const ed = (extra: object = {}) => JSON.stringify({ isbn13: '9788545702870', chave_normalizada: 'hellboy|1|hq|mythos', titulo: 'Hellboy', origem: 'google_books', autores: ['Mike Mignola'], ...extra })
  const registrar = async (dados: string) => (await db.query<{ id: string }>(`select edicao_registrar($1::jsonb) id`, [dados])).rows[0].id
  const linha = async (id: string) => (await db.query<Record<string, unknown>>(`select * from edicoes where id = $1`, [id])).rows[0]

  it('isbn13_valido confere prefixo e dígito verificador', async () => {
    const r = async (v: string) => (await db.query<{ ok: boolean }>(`select isbn13_valido($1) ok`, [v])).rows[0].ok
    expect(await r('9788545702870')).toBe(true)
    expect(await r('9788545702871')).toBe(false)
    expect(await r('1234567890123')).toBe(false)
    expect(await r('978854570287')).toBe(false)
  })

  it('usuário lê o catálogo mas não escreve direto', async () => {
    const id = await registrar(ed())
    expect((await db.query(`select 1 from edicoes where id = $1`, [id])).rows).toHaveLength(1)
    await expect(db.query(`insert into edicoes(chave_normalizada,titulo,origem) values ('x','x','usuario')`)).rejects.toThrow()
    await db.query(`update edicoes set titulo = 'HACK' where id = $1`, [id])
    expect((await linha(id)).titulo).toBe('Hellboy')
    await db.query(`delete from edicoes where id = $1`, [id])
    expect((await db.query(`select 1 from edicoes where id = $1`, [id])).rows).toHaveLength(1)
  })

  it('isbn13 é único: registrar de novo devolve a mesma edição', async () => {
    const a = await registrar(ed({ isbn13: '9788545702863', chave_normalizada: 'unico' }))
    const b = await registrar(ed({ isbn13: '9788545702863', chave_normalizada: 'unico' }))
    expect(b).toBe(a)
  })

  it('dado de usuário não sobrescreve edição de API, mas preenche campos vazios', async () => {
    const id = await registrar(ed({ isbn13: '9788545701231', chave_normalizada: 'api1', titulo: 'Original', paginas: null }))
    await registrar(ed({ isbn13: '9788545701231', chave_normalizada: 'api1', titulo: 'Do usuário', origem: 'usuario', paginas: 96 }))
    const l = await linha(id)
    expect(l.titulo).toBe('Original')
    expect(l.origem).toBe('google_books')
    expect(l.paginas).toBe(96)
  })

  it('dado de API substitui uma edição que veio de usuário', async () => {
    const id = await registrar(ed({ isbn13: '9788545709336', chave_normalizada: 'u1', titulo: 'Rascunho', origem: 'usuario' }))
    await registrar(ed({ isbn13: '9788545709336', chave_normalizada: 'u1', titulo: 'Oficial', origem: 'brasilapi' }))
    const l = await linha(id)
    expect(l.titulo).toBe('Oficial')
    expect(l.origem).toBe('brasilapi')
  })

  it('edição sem ISBN é única por chave', async () => {
    const a = await registrar(ed({ isbn13: null, chave_normalizada: 'sem-isbn|1', origem: 'usuario' }))
    const b = await registrar(ed({ isbn13: null, chave_normalizada: 'sem-isbn|1', origem: 'usuario' }))
    expect(b).toBe(a)
  })

  it('recusa ISBN inválido, origem inválida e título vazio', async () => {
    await expect(registrar(ed({ isbn13: '9788545702871' }))).rejects.toThrow('isbn_invalido')
    await expect(registrar(ed({ origem: 'hacker' }))).rejects.toThrow('edicao_invalida')
    await expect(registrar(ed({ titulo: '  ' }))).rejects.toThrow('edicao_invalida')
    await expect(registrar(ed({ isbn13: '9788545709336', capa_url_externa: 'http://x.com/a.jpg' }))).rejects.toThrow()
  })

  it('apelidos de editora estão semeados e são só de leitura', async () => {
    const { rows } = await db.query<{ editora: string }>(`select editora from editora_apelidos where apelido = 'panini comics'`)
    expect(rows[0].editora).toBe('Panini')
    const { rows: todas } = await db.query<{ editora: string }>(`select distinct editora from editora_apelidos order by 1`)
    expect(todas.map((r) => r.editora)).toEqual(['Conrad', 'Devir', 'JBC', 'Mythos', 'NewPOP', 'Panini', 'Pipoca & Nanquim'])
    await expect(db.query(`insert into editora_apelidos values ('x','X')`)).rejects.toThrow()
  })

  it('itens_por_isbn acha o item ignorando hífens e só do próprio usuário', async () => {
    await db.query(`insert into itens(user_id,titulo,isbn) values ($1,'Com hífen','978-85-457-0287-0')`, [U])
    const { rows } = await db.query<{ titulo: string }>(`select titulo from itens_por_isbn('{9788545702870}')`)
    expect(rows.map((r) => r.titulo)).toContain('Com hífen')
    await db.query(`select set_config('app.uid','${OUTRO}',false)`)
    try {
      expect((await db.query(`select 1 from itens_por_isbn('{9788545702870}')`)).rows).toHaveLength(0)
    } finally {
      await db.query(`select set_config('app.uid','${U}',false)`)
    }
  })

  it('item aceita edicao_id e limite de consultas bloqueia depois do teto', async () => {
    const id = await registrar(ed({ isbn13: '9788545702870', chave_normalizada: 'lim' }))
    const { rows: [item] } = await db.query<{ ok: boolean }>(`select item_salvar(null, $1::jsonb, '{}') is not null as ok`, [JSON.stringify({ titulo: 'Com edição', tipo: 'hq', estado: 'desejo', edicao_id: id })])
    expect(item.ok).toBe(true)
    const { rows: [salvo] } = await db.query<{ id: string }>(`select id from itens where edicao_id = $1`, [id])
    await db.query(`select item_salvar($1, $2::jsonb, '{}')`, [salvo.id, JSON.stringify({ titulo: 'Editado', tipo: 'hq', estado: 'desejo' })])
    expect((await db.query(`select 1 from itens where id = $1 and edicao_id = $2`, [salvo.id, id])).rows).toHaveLength(1)
    await db.query(`select item_salvar($1, $2::jsonb, '{}')`, [salvo.id, JSON.stringify({ titulo: 'Editado', tipo: 'hq', estado: 'desejo', edicao_id: null })])
    expect((await db.query(`select 1 from itens where id = $1 and edicao_id is null`, [salvo.id])).rows).toHaveLength(1)
    await db.query(`delete from isbn_consultas`)
    for (let i = 0; i < 3; i++) {
      expect((await db.query<{ ok: boolean }>(`select isbn_consulta_registrar(3) ok`)).rows[0].ok).toBe(true)
    }
    expect((await db.query<{ ok: boolean }>(`select isbn_consulta_registrar(3) ok`)).rows[0].ok).toBe(false)
    await db.query(`select set_config('app.uid','${OUTRO}',false)`)
    try {
      expect((await db.query<{ ok: boolean }>(`select isbn_consulta_registrar(3) ok`)).rows[0].ok).toBe(true)
    } finally {
      await db.query(`select set_config('app.uid','${U}',false)`)
    }
  })
})

describe('capas compartilhadas (migration 0012)', () => {
  const h = (c: string) => c.repeat(64)
  const comoOutro = async <T,>(fn: () => Promise<T>): Promise<T> => {
    await db.query(`select set_config('app.uid','${OUTRO}',false)`)
    try {
      return await fn()
    } finally {
      await db.query(`select set_config('app.uid','${U}',false)`)
    }
  }
  const mkItem = async (titulo = 'Capa') =>
    (await db.query<{ id: string }>(`select item_salvar(null, $1::jsonb, '{}') id`, [JSON.stringify({ titulo, tipo: 'hq', estado: 'comprado' })])).rows[0].id
  const registrar = async (hash: string, opts: { isbn?: string | null; chave?: string; serie?: string | null; origem?: string; item?: string | null } = {}) =>
    (await db.query<{ id: string }>(
      `select capa_catalogo_registrar($1, $2, $3, $4, $5, $6, $7) id`,
      [opts.isbn ?? null, opts.chave ?? 'berserk|1|manga|panini', opts.serie === undefined ? 'berserk|manga' : opts.serie, `${hash}.jpg`, hash, opts.origem ?? 'api', opts.item ?? null]
    )).rows[0].id
  const buscar = async (isbn: string | null, chave: string | null, serie: string | null) =>
    (await db.query<{ id: string; nivel: string; usos: number }>(`select id, nivel, usos from capas_comunidade_buscar($1, $2, $3)`, [isbn, chave, serie])).rows

  it('buckets: capas continua privado e capas-publicas é público e limitado a imagens', async () => {
    await db.query(`reset role`) // o schema storage do stub não é acessível ao papel do app
    const { rows } = await db.query<{ id: string; public: boolean; file_size_limit: string | null; allowed_mime_types: string[] | null }>(`select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id`)
    await db.query(`set role authenticated`)
    expect(rows.find((r) => r.id === 'capas')?.public).toBe(false)
    const pub = rows.find((r) => r.id === 'capas-publicas')!
    expect(pub.public).toBe(true)
    expect(Number(pub.file_size_limit)).toBe(5242880)
    expect(pub.allowed_mime_types).toEqual(['image/jpeg', 'image/png', 'image/webp'])
  })

  it('perfis: cada um enxerga só o próprio e contribuir_capas nasce desligado', async () => {
    await db.query(`insert into perfis(user_id) values ($1)`, [U])
    expect((await db.query<{ c: boolean }>(`select contribuir_capas c from perfis where user_id = $1`, [U])).rows[0].c).toBe(false)
    await comoOutro(async () => {
      expect((await db.query(`select 1 from perfis`)).rows).toHaveLength(0)
      await expect(db.query(`insert into perfis(user_id) values ($1)`, [U])).rejects.toThrow()
    })
  })

  it('o cliente não lê nem escreve direto no catálogo de capas', async () => {
    await registrar(h('a'))
    expect((await db.query(`select 1 from capas_catalogo`)).rows).toHaveLength(0)
    await expect(db.query(`insert into capas_catalogo(chave_normalizada,caminho,hash_sha256,origem) values ('x','${h('b')}.jpg','${h('b')}','api')`)).rejects.toThrow()
    expect((await db.query(`select 1 from capas_denuncias`)).rows).toHaveLength(0)
  })

  it('registrar aplica no item, deduplica pelo hash e conta pessoas diferentes em usos', async () => {
    const item = await mkItem()
    const id1 = await registrar(h('c'), { item })
    const { rows: [it] } = await db.query<{ capa_url: string; capa_catalogo_id: string; capa_origem: string }>(`select capa_url, capa_catalogo_id, capa_origem from itens where id = $1`, [item])
    expect(it).toEqual({ capa_url: `pub/${h('c')}.jpg`, capa_catalogo_id: id1, capa_origem: 'api' })

    const outroItemMesmoUsuario = await mkItem('Outro')
    expect(await registrar(h('c'), { item: outroItemMesmoUsuario })).toBe(id1) // mesma imagem, mesma chave: não duplica
    expect((await buscar(null, 'berserk|1|manga|panini', null))[0].usos).toBe(1) // dois itens, uma pessoa

    await comoOutro(async () => {
      const itemOutro = (await db.query<{ id: string }>(`select item_salvar(null, '{"titulo":"x","tipo":"hq","estado":"comprado"}', '{}') id`)).rows[0].id
      expect(await registrar(h('c'), { item: itemOutro })).toBe(id1)
    })
    const [c] = await buscar(null, 'berserk|1|manga|panini', null)
    expect(c).toMatchObject({ id: id1, nivel: 'chave', usos: 2 })
  })

  it('usos acompanha o uso real: apagar o item não apaga a capa do catálogo', async () => {
    const item = await mkItem()
    const id = await registrar(h('d'), { chave: 'usos|1|hq|', item })
    expect((await buscar(null, 'usos|1|hq|', null))[0].usos).toBe(1)
    await db.query(`delete from itens where id = $1`, [item])
    const [c] = await buscar(null, 'usos|1|hq|', null)
    expect(c).toMatchObject({ id, usos: 0 })
  })

  it('foto só entra com opt-in; capa de API não depende dele', async () => {
    await expect(registrar(h('e'), { origem: 'foto', chave: 'foto|1|hq|' })).rejects.toThrow('contribuicao_nao_autorizada')
    await comoOutro(async () => {
      await db.query(`insert into perfis(user_id, contribuir_capas) values ($1, true)`, [OUTRO])
      await expect(registrar(h('e'), { origem: 'foto', chave: 'foto|1|hq|' })).resolves.toBeTruthy()
    })
    await db.query(`update perfis set contribuir_capas = true where user_id = $1`, [U])
    await expect(registrar(h('f'), { origem: 'foto', chave: 'foto|2|hq|' })).resolves.toBeTruthy()
    await db.query(`update perfis set contribuir_capas = false where user_id = $1`, [U])
    await expect(registrar(h('9'), { origem: 'api', chave: 'foto|3|hq|' })).resolves.toBeTruthy()
  })

  it('busca em ordem: isbn, depois chave, depois só o nome', async () => {
    await registrar(h('1'), { isbn: '9788545702870', chave: 'ordem|1|manga|jbc', serie: 'ordem|manga' })
    await registrar(h('2'), { chave: 'ordem|1|manga|jbc', serie: 'ordem|manga' })
    await registrar(h('3'), { chave: 'ordem|2|manga|jbc', serie: 'ordem|manga' })
    const r = await buscar('9788545702870', 'ordem|1|manga|jbc', 'ordem|manga')
    expect(r.map((x) => x.nivel)).toEqual(['isbn', 'chave', 'nome'])
    expect((await buscar(null, null, null))).toHaveLength(0)
    expect((await buscar('9791032305843', 'inexistente', 'inexistente'))).toHaveLength(0)
  })

  it('3 denúncias de pessoas diferentes escondem a capa; repetir a própria denúncia não conta', async () => {
    const id = await registrar(h('4'), { chave: 'denuncia|1|hq|' })
    expect((await db.query<{ r: boolean }>(`select capa_denunciar($1) r`, [id])).rows[0].r).toBe(false)
    expect((await db.query<{ r: boolean }>(`select capa_denunciar($1) r`, [id])).rows[0].r).toBe(false)
    await comoOutro(async () => {
      expect((await db.query<{ r: boolean }>(`select capa_denunciar($1) r`, [id])).rows[0].r).toBe(false)
    })
    expect((await buscar(null, 'denuncia|1|hq|', null))).toHaveLength(1)

    const terceiro = '77777777-7777-7777-7777-777777777777'
    await db.query(`reset role`)
    await db.query(`insert into auth.users values ('${terceiro}')`)
    await db.query(`set role authenticated`)
    await db.query(`select set_config('app.uid','${terceiro}',false)`)
    expect((await db.query<{ r: boolean }>(`select capa_denunciar($1) r`, [id])).rows[0].r).toBe(true)
    await db.query(`select set_config('app.uid','${U}',false)`)
    expect((await buscar(null, 'denuncia|1|hq|', null))).toHaveLength(0)
    // aplicar uma capa oculta é recusado
    await expect(db.query(`select capa_catalogo_aplicar($1, $2)`, [await mkItem('x'), id])).rejects.toThrow('capa_indisponivel')
  })

  it('aplicar capa da comunidade: só em item do próprio usuário', async () => {
    const id = await registrar(h('5'), { chave: 'aplicar|1|hq|' })
    const item = await mkItem('Meu')
    const { rows: [{ caminho }] } = await db.query<{ caminho: string }>(`select capa_catalogo_aplicar($1, $2) caminho`, [item, id])
    expect(caminho).toBe(`${h('5')}.jpg`)
    expect((await db.query(`select 1 from itens where id = $1 and capa_url = 'pub/${h('5')}.jpg' and capa_catalogo_id = $2`, [item, id])).rows).toHaveLength(1)
    await comoOutro(async () => {
      await expect(db.query(`select capa_catalogo_aplicar($1, $2)`, [item, id])).rejects.toThrow('item_nao_encontrado')
      await expect(registrar(h('6'), { item })).rejects.toThrow('item_nao_encontrado')
    })
  })

  it('valida entradas: origem, hash/caminho, ISBN', async () => {
    await expect(registrar(h('7'), { origem: 'hacker' })).rejects.toThrow('capa_invalida')
    await expect(db.query(`select capa_catalogo_registrar(null, 'k', null, 'nao-e-hash.jpg', 'x', 'api', null)`)).rejects.toThrow()
    await expect(registrar(h('8'), { isbn: '9788545702871' })).rejects.toThrow('isbn_invalido')
  })

  it('memória global da série: confirma, perde confirmações e só troca em zero', async () => {
    const reg = (prov: string, ref: string | null) => db.query(`select series_busca_global_registrar('berserk|manga', 'Berserk', $1, $2)`, [prov, ref])
    const estado = async () => (await db.query<{ provedor: string; ref: string | null; confirmacoes: number }>(`select provedor, ref, confirmacoes from series_busca_global where serie_chave = 'berserk|manga'`)).rows[0]
    await reg('mangadex', 'abc-123')
    await reg('mangadex', 'abc-123')
    expect(await estado()).toEqual({ provedor: 'mangadex', ref: 'abc-123', confirmacoes: 2 })
    await reg('anilist', '99')
    expect(await estado()).toEqual({ provedor: 'mangadex', ref: 'abc-123', confirmacoes: 1 })
    await reg('anilist', '99')
    expect(await estado()).toEqual({ provedor: 'anilist', ref: '99', confirmacoes: 1 })
    await expect(reg('mangadex', 'ref inválida!')).rejects.toThrow('busca_invalida')
    await expect(reg('outro', null)).rejects.toThrow('busca_invalida')
    await expect(db.query(`insert into series_busca_global(serie_chave, provedor) values ('x','mangadex')`)).rejects.toThrow()
    expect((await db.query(`select 1 from series_busca_global`)).rows.length).toBeGreaterThan(0)
  })
})

describe('compartilhamento por link (migration 0013)', () => {
  const TODOS = ['colecao', 'series', 'lidos', 'notas_criticas', 'ranking', 'desejos']
  const comoOutro = async <T,>(fn: () => Promise<T>): Promise<T> => {
    await db.query(`select set_config('app.uid','${OUTRO}',false)`)
    try {
      return await fn()
    } finally {
      await db.query(`select set_config('app.uid','${U}',false)`)
    }
  }
  const gerar = async (escopo: string[]) => (await db.query<{ t: string }>(`select compartilhamento_gerar($1::text[]) t`, [escopo])).rows[0].t
  const itens = async (token: string, secao: string, serie: string | null = null) =>
    (await db.query<Record<string, unknown>>(`select * from link_itens($1, $2, $3)`, [token, secao, serie])).rows
  const mkSerie = async (nome: string) => (await db.query<{ s: string }>(`select serie_salvar(null, $1::jsonb, '{}') s`, [JSON.stringify({ nome, tipo: 'hq', tem_numeracao: true })])).rows[0].s
  const mkItem = async (extra: object) =>
    (await db.query<{ id: string }>(`select item_salvar(null, $1::jsonb, '{}') id`, [JSON.stringify({ titulo: 'T', tipo: 'hq', ...extra })])).rows[0].id

  it('o link só nasce com escopo válido; o token tem 64 hex e o cliente não escreve direto', async () => {
    await expect(gerar([])).rejects.toThrow('escopo_invalido')
    await expect(gerar(['tudo'])).rejects.toThrow('escopo_invalido')
    const token = await gerar(['colecao'])
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    await expect(db.query(`insert into compartilhamentos(user_id, token, escopo) values ($1, 'token-escolhido-pelo-cliente-123456', '{colecao}')`, [U])).rejects.toThrow()
    // atualizar direto também não vale (sem policy de update): o escopo some só pela função
    await db.query(`update compartilhamentos set escopo = '{colecao,desejos}' where user_id = $1`, [U])
    expect((await db.query<{ escopo: string[] }>(`select escopo from compartilhamentos where token = $1`, [token])).rows[0].escopo).toEqual(['colecao'])
    await comoOutro(async () => {
      expect((await db.query(`select 1 from compartilhamentos`)).rows).toHaveLength(0) // cada um vê só o seu
    })
  })

  it('token inexistente, malformado ou revogado devolve vazio; gerar de novo invalida o antigo', async () => {
    const velho = await gerar(['colecao'])
    await mkItem({ estado: 'comprado', titulo: 'Visível' })
    expect((await itens(velho, 'colecao')).length).toBeGreaterThan(0)
    const novo = await gerar(['colecao'])
    expect(novo).not.toBe(velho)
    expect(await itens(velho, 'colecao')).toHaveLength(0)
    expect((await itens(novo, 'colecao')).length).toBeGreaterThan(0)
    expect((await db.query<{ r: unknown }>(`select link_resumo($1) r`, [velho])).rows[0].r).toBeNull()
    expect((await db.query<{ r: boolean }>(`select compartilhamento_revogar() r`)).rows[0].r).toBe(true)
    expect(await itens(novo, 'colecao')).toHaveLength(0)
    for (const ruim of ['', 'curto', "' or 1=1 --", 'x'.repeat(200)]) expect(await itens(ruim, 'colecao')).toHaveLength(0)
  })

  it('preço, loja, data de aquisição, observações e prioridade nunca saem — nem existem no tipo devolvido', async () => {
    const token = await gerar(TODOS)
    await mkItem({ estado: 'lido', nota: 4.5, critica: 'boa', preco: 99.9, loja: 'Loja Secreta', data_aquisicao: '2026-01-01', prioridade: 9, titulo: 'Segredos' })
    const cols = (await db.query<{ attname: string }>(`select attname from pg_attribute where attrelid = (select typrelid from pg_type where oid = 'vitrine_item'::regtype) and attnum > 0`)).rows.map((r) => r.attname)
    for (const proibida of ['preco', 'loja', 'data_aquisicao', 'observacoes', 'prioridade', 'user_id']) expect(cols).not.toContain(proibida)
    const colsSerie = (await db.query<{ attname: string }>(`select attname from pg_attribute where attrelid = (select typrelid from pg_type where oid = 'vitrine_serie'::regtype) and attnum > 0`)).rows.map((r) => r.attname)
    for (const proibida of ['observacoes', 'user_id', 'busca_termo']) expect(colsSerie).not.toContain(proibida)
    const linhas = await itens(token, 'colecao')
    const texto = JSON.stringify(linhas)
    expect(texto).not.toContain('Loja Secreta')
    expect(texto).not.toContain('99.9')
    expect(texto).not.toContain('2026-01-01')
    const resumo = JSON.stringify((await db.query<{ r: unknown }>(`select link_resumo($1) r`, [token])).rows[0].r)
    expect(resumo).not.toContain(U)
  })

  it('o escopo manda: sem "lidos" lido aparece como comprado; sem "notas_criticas" não há nota nem crítica', async () => {
    await mkItem({ estado: 'lido', nota: 5, critica: 'obra-prima', titulo: 'Escopo' })
    const soColecao = await gerar(['colecao'])
    const [l] = (await itens(soColecao, 'colecao')).filter((r) => r.titulo === 'Escopo')
    expect(l).toMatchObject({ estado: 'comprado', nota: null, critica: null, lido_em: null })
    expect(await itens(soColecao, 'lidos')).toHaveLength(0)
    expect(await itens(soColecao, 'ranking')).toHaveLength(0)
    expect(await itens(soColecao, 'desejos')).toHaveLength(0)

    await db.query(`select compartilhamento_escopo_atualizar('{colecao,lidos,notas_criticas,ranking}')`)
    const [m] = (await itens(soColecao, 'colecao')).filter((r) => r.titulo === 'Escopo')
    expect(m).toMatchObject({ estado: 'lido', critica: 'obra-prima' })
    expect(Number(m.nota)).toBe(5)
    expect((await itens(soColecao, 'ranking')).some((r) => r.titulo === 'Escopo')).toBe(true)
    expect((await itens(soColecao, 'lidos')).some((r) => r.titulo === 'Escopo')).toBe(true)
  })

  it('ranking mostra a nota mesmo sem "notas_criticas", mas nunca a crítica', async () => {
    await mkItem({ estado: 'lido', nota: 3, critica: 'segredo de ranking', titulo: 'Ranqueado' })
    const token = await gerar(['ranking'])
    const [r] = (await itens(token, 'ranking')).filter((x) => x.titulo === 'Ranqueado')
    expect(Number(r.nota)).toBe(3)
    expect(r.critica).toBeNull()
    expect(await itens(token, 'colecao')).toHaveLength(0)
  })

  it('crítica privada nunca sai, em nenhum escopo', async () => {
    await mkItem({ estado: 'lido', nota: 2, critica: 'só para mim', critica_privada: true, titulo: 'Privada' })
    await mkItem({ estado: 'lido', nota: 2, critica: 'pode mostrar', titulo: 'Pública' })
    const token = await gerar(TODOS)
    const todas = [...(await itens(token, 'colecao')), ...(await itens(token, 'lidos')), ...(await itens(token, 'ranking'))]
    expect(JSON.stringify(todas)).not.toContain('só para mim')
    expect(JSON.stringify(todas)).toContain('pode mostrar')
    // editar o item sem mandar a chave mantém a privacidade
    const { rows: [{ id }] } = await db.query<{ id: string }>(`select id from itens where titulo = 'Privada'`)
    await db.query(`select item_salvar($1, '{"titulo":"Privada","tipo":"hq","estado":"lido","critica":"só para mim","nota":2}', '{}')`, [id])
    expect(JSON.stringify(await itens(token, 'colecao'))).not.toContain('só para mim')
  })

  it('crítica da série: some quando privada, e a cópia para os volumes herda a privacidade', async () => {
    const s = await mkSerie('Série Privada')
    await db.query(`update series set critica_privada = true where id = $1`, [s])
    await mkItem({ serie_id: s, numero_volume: 1, estado: 'comprado', titulo: 'SP 1' })
    const token = await gerar(TODOS)
    await db.query(`select serie_marcar_lida($1, 4, 'crítica secreta da série', 'serie', true)`, [s])
    const todas = [...(await itens(token, 'colecao')), ...(await itens(token, 'serie', s))]
    expect(JSON.stringify(todas)).not.toContain('crítica secreta da série')
    const series = (await db.query<Record<string, unknown>>(`select * from link_series($1)`, [token])).rows
    expect(JSON.stringify(series)).not.toContain('crítica secreta da série')
    // desfazer continua funcionando com o novo campo
    const { rows: [{ r }] } = await db.query<{ r: { snapshot: unknown } }>(`select serie_marcar_lida($1, 5, 'outra', 'serie', true) r`, [s])
    expect(r.snapshot).toBeTruthy()
  })

  it('séries e série: só com escopo "series", só o que o dono possui, com contagens', async () => {
    const s = await mkSerie('Vitrine')
    await mkItem({ serie_id: s, numero_volume: 1, estado: 'lido', titulo: 'V1' })
    await mkItem({ serie_id: s, numero_volume: 2, estado: 'comprado', titulo: 'V2' })
    await mkItem({ serie_id: s, numero_volume: 3, estado: 'desejo', titulo: 'V3' })
    const so = await gerar(['series'])
    const lista = (await db.query<{ nome: string; possuidos: number; lidos: number | null }>(`select * from link_series($1)`, [so])).rows.filter((r) => r.nome === 'Vitrine')
    expect(lista).toEqual([expect.objectContaining({ possuidos: 2, lidos: null })])
    expect((await itens(so, 'serie', s)).map((r) => r.titulo)).toEqual(['V1', 'V2']) // desejo fora, ordenado por número
    const sem = await gerar(['colecao'])
    expect((await db.query(`select * from link_series($1)`, [sem])).rows).toHaveLength(0)
    expect(await itens(sem, 'serie', s)).toHaveLength(0)
    const com = await gerar(['series', 'lidos', 'desejos'])
    expect((await itens(com, 'serie', s)).map((r) => r.titulo)).toEqual(['V1', 'V2', 'V3'])
    expect((await db.query<{ lidos: number }>(`select * from link_series($1) where nome = 'Vitrine'`, [com])).rows[0].lidos).toBe(1)
  })

  it('capa privada só é liberada para item visível no escopo; arquivo fora do padrão nunca', async () => {
    const arquivo = '22222222-2222-4222-8222-222222222222-1700000000000.jpg'
    const id = await mkItem({ estado: 'desejo', titulo: 'Com capa' })
    await db.query(`update itens set capa_url = $2 where id = $1`, [id, `${U}/${arquivo}`])
    const semDesejos = await gerar(['colecao'])
    const capa = async (t: string, a: string) => (await db.query<{ c: string | null }>(`select link_capa($1, $2) c`, [t, a])).rows[0].c
    expect(await capa(semDesejos, arquivo)).toBeNull() // desejo fora do escopo
    const comDesejos = await gerar(['desejos'])
    expect(await capa(comDesejos, arquivo)).toBe(`${U}/${arquivo}`)
    expect(await capa(comDesejos, '../' + arquivo)).toBeNull()
    expect(await capa(comDesejos, `${OUTRO}/${arquivo}`)).toBeNull()
    expect(await capa(comDesejos, '33333333-3333-4333-8333-333333333333.jpg')).toBeNull()
  })

  it('a camada interna (schema privado) não é alcançável pelo app', async () => {
    await expect(db.query(`select * from privado.v_itens('${U}', '{colecao}', 'colecao', null, null, 10, 0)`)).rejects.toThrow()
    await expect(db.query(`select privado.resolver_token('x')`)).rejects.toThrow()
  })

  it('migration: toda função pública nova revoga anon/public e só as link_* liberam visitante', () => {
    const sql = readFileSync(path.join(PASTA, '0013_compartilhamento.sql'), 'utf8')
    for (const nome of ['compartilhamento_gerar', 'compartilhamento_revogar', 'compartilhamento_escopo_atualizar']) {
      expect(sql).toMatch(new RegExp(`revoke all on function ${nome}\\([^)]*\\) from public, anon;`))
      expect(sql).not.toMatch(new RegExp(`grant execute on function ${nome}\\([^)]*\\) to[^;]*anon`))
    }
    for (const nome of ['link_resumo', 'link_itens', 'link_series', 'link_capa']) {
      expect(sql).toMatch(new RegExp(`grant execute on function ${nome}\\([^)]*\\) to anon, authenticated;`))
    }
  })
})
