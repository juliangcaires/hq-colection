import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { chaveObra, chaveSerie } from '@/lib/texto'
import { calcularVolumesFaltantes, serieEstaCompleta, serieEstaLida } from '@/lib/volumes'
import { calcularProgressoDaSerie, progressoDeContagens } from '@/lib/progresso-serie'

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
  for (const f of ['0001_init', '0002_editora_vira_tag', '0003_busca_capa_serie', '0004_serie_tem_numeracao', '0005_remove_view_tags_efetivas', '0006_integridade_indices_e_limites', '0007_funcoes_transacionais_e_resumo', '0008_nota_meia_estrela_e_critica', '0009_nota_e_critica_da_serie', '0010_serie_lida_e_lido_em', '0011_catalogo_edicoes', '0012_capas_compartilhadas', '0013_compartilhamento', '0014_amigos_presentes_emprestimos', '0016_foto_de_perfil', '0017_capa_variante', '0018_feed_amigos', '0019_notas_entre_amigos', '0020_casar_obra_por_isbn_e_manual', '0021_escopo_amigos_notas_padrao', '0022_chave_obra_edicao_luxo', '0023_ranking_amigos', '0024_spoiler_na_critica', '0025_releitura_e_diario', '0026_favoritos_series', '0027_progresso_por_serie', '0028_listas_curadas', '0029_leituras_blindar_update', '0030_melhor_volume_da_serie', '0031_feed_desfazer_e_nota_do_grupo', '0032_feed_capa_do_melhor_volume', '0033_notificacoes', '0034_push_endpoint_e_aviso_de_ex_amigo']) {
    await db.exec(readFileSync(path.join(PASTA, `${f}.sql`), 'utf8'))
  }
  await db.exec(`
    insert into auth.users values ('${U}'), ('${OUTRO}');
    grant usage on schema public, auth to authenticated;
    grant all on all tables in schema public to authenticated;
    -- O grant em bloco acima devolveria o UPDATE da tabela inteira; reaplica o privilégio de coluna da 0029.
    revoke update on leituras from authenticated;
    grant update (lido_em) on leituras to authenticated;
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

describe('series_com_resumo: progresso (0027)', () => {
  it('tenho/lidos/maximo_conhecido batem com calcularProgressoDaSerie (variante, número repetido, sem número)', async () => {
    const divergentes: unknown[] = []
    for (let k = 0; k < 150; k++) {
      const total = [null, null, 0, 3, 8, 12][rnd(6)]
      const { rows } = await db.query<{ id: string }>(
        `insert into series(user_id,nome,tipo,total_volumes,tem_numeracao) values ($1,$2,'hq',$3,false) returning id`,
        [U, `Progresso ${k}`, total]
      )
      const volumes: { numero_volume: number | null; estado: (typeof ESTADOS)[number]; variante_de: string | null }[] = []
      for (let j = 0; j < rnd(10); j++) {
        const numero_volume = [null, 1, 2, 3, 3, 4, 5, 7, 1.5, 0, 20][rnd(11)]
        const estado = ESTADOS[rnd(3)]
        const ehVariante = volumes.length > 0 && Math.random() < 0.25
        const principal = volumes.find((x) => x.variante_de === null)
        const { rows: ins } = await db.query<{ id: string }>(
          `insert into itens(user_id,serie_id,titulo,numero_volume,estado,variante_de) values ($1,$2,'t',$3,$4,$5) returning id`,
          [U, rows[0].id, numero_volume, estado, null]
        )
        if (ehVariante && principal) {
          // variante aponta para um volume que já existe na série (o gatilho exige o mesmo dono).
          const { rows: alvo } = await db.query<{ id: string }>(`select id from itens where serie_id = $1 and variante_de is null and id <> $2 limit 1`, [rows[0].id, ins[0].id])
          if (alvo[0]) {
            await db.query(`update itens set variante_de = $1 where id = $2`, [alvo[0].id, ins[0].id])
            volumes.push({ numero_volume, estado, variante_de: alvo[0].id })
            continue
          }
        }
        volumes.push({ numero_volume, estado, variante_de: null })
      }
      const { rows: r } = await db.query<{ tenho: number; lidos_n: number; maximo_conhecido: number | null }>(
        `select tenho, lidos_n, maximo_conhecido from series_com_resumo(null) where id = $1`,
        [rows[0].id]
      )
      const p = calcularProgressoDaSerie(volumes, total)
      const sql = progressoDeContagens({ tenho: r[0].tenho, lidos: r[0].lidos_n, totalDeclarado: total, maximoConhecido: r[0].maximo_conhecido })
      if (JSON.stringify(sql) !== JSON.stringify(p)) divergentes.push({ total, volumes, sql, ts: p })
    }
    expect(divergentes).toEqual([])
  }, 120_000)

  it('série sem volumes: tenho 0, lidos 0 e nenhum total inventado', async () => {
    const { rows: [s] } = await db.query<{ id: string }>(`insert into series(user_id,nome,tipo) values ($1,'Vazia R8','hq') returning id`, [U])
    const { rows: [r] } = await db.query<Record<string, unknown>>(`select tenho, lidos_n, maximo_conhecido from series_com_resumo(null) where id = $1`, [s.id])
    expect(r).toEqual({ tenho: 0, lidos_n: 0, maximo_conhecido: null })
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
    // a pasta (id do dono) não vaza na listagem: sai só o nome do arquivo; capa pública sai como pub/…
    const lista = await itens(await gerar(['desejos']), 'desejos')
    expect(JSON.stringify(lista)).not.toContain(U)
    expect(lista.find((r) => r.titulo === 'Com capa')?.capa).toBe(arquivo)
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

describe('amigos, presentes e empréstimos (migration 0014)', () => {
  const CAIO = '88888888-8888-8888-8888-888888888888'
  let preparado = false
  const como = async <T,>(uid: string, fn: () => Promise<T>): Promise<T> => {
    await db.query(`select set_config('app.uid','${uid}',false)`)
    try {
      return await fn()
    } finally {
      await db.query(`select set_config('app.uid','${U}',false)`)
    }
  }
  /** O papel do app não apaga amizades (só as funções); a limpeza entre testes é como administrador. */
  async function limparAmizades() {
    await db.query(`reset role`)
    await db.query(`delete from amizades`)
    await db.query(`set role authenticated`)
  }
  async function preparar() {
    if (preparado) return
    preparado = true
    await db.query(`reset role`)
    await db.query(`insert into auth.users values ('${CAIO}') on conflict do nothing`)
    await db.query(`delete from perfis`)
    await db.query(`set role authenticated`)
    await db.query(`insert into perfis(user_id, apelido, nome_exibicao) values ($1, 'ana', 'Ana')`, [U])
    await como(OUTRO, () => db.query(`insert into perfis(user_id, apelido) values ($1, 'beto')`, [OUTRO]))
    await como(CAIO, () => db.query(`insert into perfis(user_id, apelido) values ($1, 'caio')`, [CAIO]))
  }
  const mkItem = async (extra: object) =>
    (await db.query<{ id: string }>(`select item_salvar(null, $1::jsonb, '{}') id`, [JSON.stringify({ titulo: 'Item', tipo: 'hq', ...extra })])).rows[0].id
  const itensDe = async (apelido: string, secao: string) =>
    (await db.query<Record<string, unknown>>(`select * from amigo_itens($1, $2)`, [apelido, secao])).rows
  const solicitar = async (apelido: string) => (await db.query<{ id: string }>(`select amizade_solicitar($1) id`, [apelido])).rows[0].id
  /** Ana e Beto viram amigos (pedido de Beto, aceite de Ana). */
  async function amigosAnaBeto() {
    await limparAmizades()
    const id = await como(OUTRO, () => solicitar('ana'))
    await db.query(`select amizade_responder($1, true)`, [id])
    return id
  }

  it('o pedido só vale com aceite: pendente não dá acesso; aceitar libera; recusar apaga', async () => {
    await preparar()
    await mkItem({ estado: 'comprado', titulo: 'Da Ana' })
    await limparAmizades()
    const id = await como(OUTRO, () => solicitar('ana'))
    // pedido pendente: nem quem pediu nem a Ana liberam nada
    await como(OUTRO, async () => expect(await itensDe('ana', 'colecao')).toHaveLength(0))
    expect((await db.query<{ direcao: string }>(`select direcao from amigos_listar()`)).rows[0].direcao).toBe('recebida')
    await como(OUTRO, async () => expect((await db.query<{ direcao: string }>(`select direcao from amigos_listar()`)).rows[0].direcao).toBe('enviada'))
    // quem pediu não pode aceitar o próprio pedido
    await como(OUTRO, () => expect(db.query(`select amizade_responder($1, true)`, [id])).rejects.toThrow('amizade_nao_encontrada'))
    await db.query(`select amizade_responder($1, true)`, [id])
    await como(OUTRO, async () => expect((await itensDe('ana', 'colecao')).map((r) => r.titulo)).toContain('Da Ana'))
    // recusar apaga
    await db.query(`select amizade_desfazer($1)`, [id])
    const id2 = await como(OUTRO, () => solicitar('ana'))
    await db.query(`select amizade_responder($1, false)`, [id2])
    expect((await db.query(`select * from amigos_listar()`)).rows).toHaveLength(0)
  })

  it('terceiro e visitante sem amizade nunca leem; apelido inexistente e o próprio apelido são recusados', async () => {
    await preparar()
    await amigosAnaBeto()
    await como(CAIO, async () => {
      expect(await itensDe('ana', 'colecao')).toHaveLength(0)
      expect((await db.query<{ r: unknown }>(`select amigo_resumo('ana') r`)).rows[0].r).toBeNull()
      expect((await db.query(`select * from amigo_series('ana')`)).rows).toHaveLength(0)
      expect((await db.query<{ c: unknown }>(`select amigo_capa('ana', 'x.jpg') c`)).rows[0].c).toBeNull()
      await expect(solicitar('ninguem')).rejects.toThrow('apelido_nao_encontrado')
      await expect(solicitar('caio')).rejects.toThrow('amizade_propria')
    })
    await expect(solicitar('beto')).rejects.toThrow() // já amigos (e jamais duplica o par)
  })

  it('desfazer a amizade corta o acesso na hora (qualquer lado)', async () => {
    await preparar()
    const id = await amigosAnaBeto()
    await como(OUTRO, async () => expect(await itensDe('ana', 'colecao')).not.toHaveLength(0))
    await como(OUTRO, () => db.query(`select amizade_desfazer($1)`, [id]))
    await como(OUTRO, async () => expect(await itensDe('ana', 'colecao')).toHaveLength(0))
    await como(CAIO, () => expect(db.query(`select amizade_desfazer($1)`, [id])).rejects.toThrow('amizade_nao_encontrada'))
  })

  it('pedido cruzado vira amizade; sem apelido ninguém pede nem aceita', async () => {
    await preparar()
    await limparAmizades()
    await como(OUTRO, () => solicitar('ana'))
    await solicitar('beto') // a Ana pede de volta: aceita o pedido do Beto
    expect((await db.query<{ status: string }>(`select status from amigos_listar()`)).rows).toEqual([{ status: 'aceita' }])
    await limparAmizades()
    const SEM = '99999999-0000-0000-0000-000000000001'
    await db.query(`reset role`)
    await db.query(`insert into auth.users values ('${SEM}') on conflict do nothing`)
    await db.query(`set role authenticated`)
    await como(SEM, () => expect(solicitar('ana')).rejects.toThrow('perfil_sem_apelido'))
    await como(SEM, () => expect(db.query(`select convite_gerar()`)).rejects.toThrow('perfil_sem_apelido'))
  })

  it('convite por link: único, vale uma vez, não vale para o próprio autor e fecha o aceite dos dois lados', async () => {
    await preparar()
    await limparAmizades()
    const { rows: [{ c }] } = await db.query<{ c: string }>(`select convite_gerar() c`)
    expect(c).toMatch(/^[0-9a-f]{64}$/)
    await expect(db.query(`select convite_aceitar($1)`, [c])).rejects.toThrow('amizade_propria')
    expect(await como(OUTRO, async () => (await db.query<{ i: { apelido: string } | null }>(`select convite_inspecionar($1) i`, [c])).rows[0].i)).toEqual(expect.objectContaining({ apelido: 'ana' }))
    expect((await db.query<{ i: unknown }>(`select convite_inspecionar($1) i`, [c])).rows[0].i).toBeNull() // o autor não "inspeciona" o próprio
    expect(await como(OUTRO, async () => (await db.query<{ a: string }>(`select convite_aceitar($1) a`, [c])).rows[0].a)).toBe('ana')
    await como(OUTRO, async () => expect((await db.query<{ direcao: string }>(`select direcao from amigos_listar()`)).rows[0].direcao).toBe('amigo'))
    await como(CAIO, () => expect(db.query(`select convite_aceitar($1)`, [c])).rejects.toThrow('convite_invalido')) // já usado
    await como(CAIO, () => expect(db.query(`select convite_aceitar($1)`, ['0'.repeat(64)])).rejects.toThrow('convite_invalido'))
    // gerar outro invalida os não usados anteriores
    const { rows: [{ c: a }] } = await db.query<{ c: string }>(`select convite_gerar() c`)
    const { rows: [{ c: b }] } = await db.query<{ c: string }>(`select convite_gerar() c`)
    await como(CAIO, () => expect(db.query(`select convite_aceitar($1)`, [a])).rejects.toThrow('convite_invalido'))
    await como(CAIO, async () => expect((await db.query<{ a: string }>(`select convite_aceitar($1) a`, [b])).rows[0].a).toBe('ana'))
  })

  it('amigos veem o escopo de AMIGOS (separado do link) e nunca preço/loja/crítica privada', async () => {
    await preparar()
    await amigosAnaBeto()
    await db.query(`select amigos_escopo_atualizar('{colecao}')`)
    await mkItem({ estado: 'lido', nota: 5, critica: 'secreta', critica_privada: true, preco: 77, loja: 'LojaX', titulo: 'Escopo amigo' })
    await mkItem({ estado: 'desejo', titulo: 'Desejo amigo' })
    await como(OUTRO, async () => {
      const col = await itensDe('ana', 'colecao')
      const l = col.find((r) => r.titulo === 'Escopo amigo')!
      expect(l).toMatchObject({ estado: 'comprado', nota: null, critica: null })
      expect(JSON.stringify(col)).not.toMatch(/LojaX|secreta|"preco"|"loja"/)
      expect(await itensDe('ana', 'desejos')).toHaveLength(0)
      expect(await itensDe('ana', 'ranking')).toHaveLength(0)
    })
    await db.query(`select amigos_escopo_atualizar('{colecao,lidos,notas_criticas,ranking,desejos,series}')`)
    await como(OUTRO, async () => {
      expect((await itensDe('ana', 'desejos')).map((r) => r.titulo)).toContain('Desejo amigo')
      const col = await itensDe('ana', 'colecao')
      expect(col.find((r) => r.titulo === 'Escopo amigo')).toMatchObject({ estado: 'lido' })
      expect(JSON.stringify(col)).not.toMatch(/LojaX|secreta/) // crítica privada nunca, mesmo com notas_criticas
    })
    await expect(db.query(`select amigos_escopo_atualizar('{}')`)).rejects.toThrow('escopo_invalido')
  })

  it('presentes: o amigo reserva, o dono não vê, outros amigos veem "reservado" e a compra limpa', async () => {
    await preparar()
    await amigosAnaBeto()
    const id = await como(CAIO, async () => (await db.query<{ id: string }>(`select amizade_solicitar('ana') id`)).rows[0].id)
    await db.query(`select amizade_responder($1, true)`, [id])
    await db.query(`select amigos_escopo_atualizar('{colecao,desejos}')`)
    const desejo = await mkItem({ estado: 'desejo', titulo: 'Quero muito' })

    await como(OUTRO, () => db.query(`select presente_marcar($1)`, [desejo]))
    await como(OUTRO, () => db.query(`select presente_marcar($1)`, [desejo])) // idempotente para quem reservou
    await como(OUTRO, async () => {
      const [r] = await itensDe('ana', 'desejos')
      expect(r).toMatchObject({ reservado: true, reservado_por_mim: true })
    })
    await como(CAIO, async () => {
      const [r] = await itensDe('ana', 'desejos')
      expect(r).toMatchObject({ reservado: true, reservado_por_mim: false })
      await expect(db.query(`select presente_marcar($1)`, [desejo])).rejects.toThrow('presente_ja_reservado')
      await db.query(`select presente_desmarcar($1)`, [desejo]) // não apaga a reserva do outro
    })
    // o dono NUNCA vê: nem tabela, nem no item, nem na lista dele
    expect((await db.query(`select * from presentes`)).rows).toHaveLength(0)
    const proprio = (await db.query<Record<string, unknown>>(`select * from itens where id = $1`, [desejo])).rows[0]
    expect(Object.keys(proprio).some((k) => /presente|reserv/.test(k))).toBe(false)
    await expect(db.query(`select presente_marcar($1)`, [desejo])).rejects.toThrow('item_nao_encontrado') // dono não reserva o próprio
    // quem reservou desfaz
    await como(OUTRO, () => db.query(`select presente_desmarcar($1)`, [desejo]))
    await como(CAIO, async () => expect((await itensDe('ana', 'desejos'))[0]).toMatchObject({ reservado: false }))
    // a compra pelo dono apaga a reserva sem aviso
    await como(OUTRO, () => db.query(`select presente_marcar($1)`, [desejo]))
    await db.query(`update itens set estado = 'comprado' where id = $1`, [desejo])
    await db.query(`update itens set estado = 'desejo' where id = $1`, [desejo])
    await como(CAIO, async () => expect((await itensDe('ana', 'desejos'))[0]).toMatchObject({ reservado: false }))
  })

  it('presentes: sem amizade, sem escopo "desejos" ou fora de desejo não reserva; desfazer a amizade apaga a reserva', async () => {
    await preparar()
    const id = await amigosAnaBeto()
    await db.query(`select amigos_escopo_atualizar('{colecao}')`)
    const desejo = await mkItem({ estado: 'desejo', titulo: 'Sem escopo' })
    const comprado = await mkItem({ estado: 'comprado', titulo: 'Já tenho' })
    await como(OUTRO, async () => {
      await expect(db.query(`select presente_marcar($1)`, [desejo])).rejects.toThrow('item_nao_encontrado') // escopo sem desejos
      await expect(db.query(`select presente_marcar($1)`, [comprado])).rejects.toThrow('item_nao_encontrado')
    })
    await como(CAIO, () => expect(db.query(`select presente_marcar($1)`, [desejo])).rejects.toThrow('item_nao_encontrado')) // não é amigo
    await db.query(`select amigos_escopo_atualizar('{colecao,desejos}')`)
    await como(OUTRO, () => db.query(`select presente_marcar($1)`, [desejo]))
    await db.query(`select amizade_desfazer($1)`, [id])
    await db.query(`reset role`)
    expect((await db.query(`select 1 from presentes`)).rows).toHaveLength(0)
    await db.query(`set role authenticated`)
  })

  it('link público nunca mostra reserva', async () => {
    await preparar()
    const token = (await db.query<{ t: string }>(`select compartilhamento_gerar('{desejos}') t`)).rows[0].t
    const linhas = (await db.query<Record<string, unknown>>(`select * from link_itens($1, 'desejos')`, [token])).rows
    expect(linhas.length).toBeGreaterThan(0)
    expect(linhas.every((l) => l.reservado === false && l.reservado_por_mim === false)).toBe(true)
  })

  it('empréstimos: só de itens possuídos, um em aberto por item, devolução e isolamento por usuário', async () => {
    await preparar()
    const gibi = await mkItem({ estado: 'comprado', titulo: 'Emprestável' })
    const desejo = await mkItem({ estado: 'desejo', titulo: 'Não tenho' })
    await expect(db.query(`select emprestimo_registrar($1, 'Fulano', null, null, null)`, [desejo])).rejects.toThrow('item_nao_possuido')
    await expect(db.query(`select emprestimo_registrar($1, '  ', null, null, null)`, [gibi])).rejects.toThrow()
    const { rows: [{ id }] } = await db.query<{ id: string }>(`select emprestimo_registrar($1, ' Fulano ', '2026-10-01', '2026-10-15', 'volta logo') id`, [gibi])
    const abertos = (await db.query<{ para_quem: string; devolvido_em: string | null }>(`select para_quem, devolvido_em from emprestimos where devolvido_em is null`)).rows
    expect(abertos).toEqual([{ para_quem: 'Fulano', devolvido_em: null }])
    await expect(db.query(`select emprestimo_registrar($1, 'Outro', null, null, null)`, [gibi])).rejects.toThrow('emprestimo_em_aberto')
    await expect(db.query(`select emprestimo_registrar($1, 'X', '2026-10-10', '2026-10-01', null)`, [await mkItem({ estado: 'lido' })])).rejects.toThrow() // devolver antes de emprestar
    // outro usuário não enxerga nem mexe
    await como(OUTRO, async () => {
      expect((await db.query(`select * from emprestimos`)).rows).toHaveLength(0)
      await expect(db.query(`select emprestimo_devolver($1)`, [id])).rejects.toThrow('emprestimo_nao_encontrado')
      await expect(db.query(`select emprestimo_registrar($1, 'Y', null, null, null)`, [gibi])).rejects.toThrow('item_nao_encontrado')
    })
    await db.query(`select emprestimo_devolver($1, '2026-10-12')`, [id])
    expect((await db.query<{ d: string }>(`select devolvido_em::text d from emprestimos where id = $1`, [id])).rows[0].d).toBe('2026-10-12')
    await expect(db.query(`select emprestimo_devolver($1)`, [id])).rejects.toThrow('emprestimo_nao_encontrado') // já devolvido
    // depois de devolvido pode emprestar de novo
    await expect(db.query(`select emprestimo_registrar($1, 'Beltrano', null, null, null)`, [gibi])).resolves.toBeDefined()
  })

  it('emprestimos não aparecem em nenhuma função de compartilhamento', async () => {
    const token = (await db.query<{ t: string }>(`select compartilhamento_gerar('{colecao,series,lidos,notas_criticas,ranking,desejos}') t`)).rows[0].t
    const tudo = JSON.stringify((await db.query(`select * from link_itens($1, 'colecao', null, 200, 0)`, [token])).rows)
    expect(tudo).not.toMatch(/Fulano|Beltrano|emprestad/i)
  })

  it('migration: funções de amigos exigem login e a camada interna fica fechada', () => {
    const sql = readFileSync(path.join(PASTA, '0014_amigos_presentes_emprestimos.sql'), 'utf8')
    for (const f of ['amigo_resumo', 'amigo_itens', 'amigo_series', 'amigo_capa', 'amizade_solicitar', 'presente_marcar', 'convite_aceitar']) {
      expect(sql).toMatch(new RegExp(`revoke all on function ${f}\\([^)]*\\) from public, anon;`))
      expect(sql).not.toMatch(new RegExp(`grant execute on function ${f}\\([^)]*\\) to[^;]*anon`))
    }
    expect(sql).toMatch(/revoke all on presentes from public, anon, authenticated;/)
    expect(sql).toMatch(/revoke all on all functions in schema privado from public, anon, authenticated;/)
  })
})

describe('foto de perfil (migration 0016)', () => {
  const ARQ = 'b'.repeat(32)
  const como = async <T,>(uid: string, fn: () => Promise<T>): Promise<T> => {
    await db.query(`select set_config('app.uid','${uid}',false)`)
    try {
      return await fn()
    } finally {
      await db.query(`select set_config('app.uid','${U}',false)`)
    }
  }

  it('bucket avatares é público, limitado a imagens e a 300 KB', async () => {
    await db.query(`reset role`)
    const { rows } = await db.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'avatares'`)
    await db.query(`set role authenticated`)
    expect(rows[0].public).toBe(true)
    expect(Number(rows[0].file_size_limit)).toBe(307200)
    expect(rows[0].allowed_mime_types).toEqual(['image/jpeg', 'image/png', 'image/webp'])
  })

  it('policies: cada um escreve só na própria pasta; ninguém altera nem apaga o arquivo do outro', async () => {
    await db.query(`reset role`)
    await db.exec(`alter table storage.objects enable row level security; grant usage on schema storage to authenticated; grant all on storage.objects to authenticated; set role authenticated;`)
    const meu = `${U}/${ARQ}.webp`
    const dele = `${OUTRO}/${ARQ}.webp`
    await db.query(`insert into storage.objects(bucket_id, name) values ('avatares', $1)`, [meu])
    // não grava na pasta alheia, nem com nome fora do padrão na própria
    await expect(db.query(`insert into storage.objects(bucket_id, name) values ('avatares', $1)`, [dele])).rejects.toThrow()
    await expect(db.query(`insert into storage.objects(bucket_id, name) values ('avatares', $1)`, [`${U}/foto.gif`])).rejects.toThrow()
    await como(OUTRO, async () => {
      await db.query(`insert into storage.objects(bucket_id, name) values ('avatares', $1)`, [dele])
      // o outro não vê, não sobrescreve e não apaga o meu
      expect((await db.query(`select 1 from storage.objects where name = $1`, [meu])).rows).toHaveLength(0)
      const up = await db.query(`update storage.objects set name = $2 where name = $1 returning 1`, [meu, `${U}/${'c'.repeat(32)}.webp`])
      expect(up.rows).toHaveLength(0)
      const del = await db.query(`delete from storage.objects where name = $1 returning 1`, [meu])
      expect(del.rows).toHaveLength(0)
      // nem move o próprio arquivo para a minha pasta
      await expect(db.query(`update storage.objects set name = $2 where name = $1`, [dele, `${U}/${'d'.repeat(32)}.webp`])).rejects.toThrow()
    })
    expect((await db.query(`select 1 from storage.objects where name = $1`, [meu])).rows).toHaveLength(1)
    expect((await db.query(`delete from storage.objects where name = $1 returning 1`, [meu])).rows).toHaveLength(1)
  })

  it('amigos_listar e o resumo trazem avatar_url', async () => {
    const cols = (await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'perfis'`)).rows.map((r) => r.column_name)
    expect(cols).toContain('avatar_url')
    const r = await db.query(`select * from amigos_listar()`)
    expect(r.fields.map((f) => f.name)).toContain('avatar_url')
  })
})

describe('capa variante (migration 0017)', () => {
  const dados = (extra: object) => JSON.stringify({ titulo: 'V', tipo: 'hq', estado: 'comprado', prioridade: 0, ...extra })
  const novo = async (extra: object = {}) =>
    (await db.query<{ id: string }>(`select item_salvar(null, $1::jsonb, '{}') as id`, [dados(extra)])).rows[0].id
  const ler = async (id: string) =>
    (await db.query<{ estado: string; nota: string | null; critica: string | null; lido_em: string | null; critica_privada: boolean; variante_de: string | null }>(
      `select estado, nota, critica, lido_em::text, critica_privada, variante_de from itens where id = $1`, [id])).rows[0]

  it('vincular herda o que o principal já tem e editar um reflete no outro (nos dois sentidos)', async () => {
    const principal = await novo({ estado: 'lido', nota: 4.5, critica: 'Ótimo', lido_em: '2026-05-01', critica_privada: true })
    const variante = await novo({ variante_de: principal })
    expect(await ler(variante)).toMatchObject({ estado: 'lido', critica: 'Ótimo', lido_em: '2026-05-01', critica_privada: true, variante_de: principal })
    expect(Number((await ler(variante)).nota)).toBe(4.5)

    await db.query(`select item_salvar($1, $2::jsonb, '{}')`, [variante, dados({ estado: 'lido', nota: 2, critica: 'Mudei', lido_em: '2026-06-02', variante_de: principal })])
    expect(await ler(principal)).toMatchObject({ estado: 'lido', critica: 'Mudei', lido_em: '2026-06-02' })
    expect(Number((await ler(principal)).nota)).toBe(2)

    await db.query(`update itens set nota = 5, estado = 'comprado' where id = $1`, [principal])
    expect(await ler(variante)).toMatchObject({ estado: 'comprado', lido_em: null })
    expect(Number((await ler(variante)).nota)).toBe(5)
  })

  it('vincular depois (item_definir_variante) e desvincular; desvinculado deixa de sincronizar', async () => {
    const principal = await novo({ estado: 'lido', nota: 3 })
    const outro = await novo({ estado: 'comprado' })
    await db.query(`select item_definir_variante($1, $2)`, [outro, principal])
    expect((await ler(outro)).estado).toBe('lido')
    await db.query(`select item_definir_variante($1, null)`, [outro])
    expect((await ler(outro)).variante_de).toBeNull()
    await db.query(`update itens set nota = 1 where id = $1`, [principal])
    expect(Number((await ler(outro)).nota)).toBe(3)
  })

  it('várias variantes do mesmo principal ficam iguais entre si', async () => {
    const principal = await novo({ estado: 'comprado' })
    const v1 = await novo({ variante_de: principal })
    const v2 = await novo({ variante_de: principal })
    await db.query(`update itens set estado = 'lido', nota = 4 where id = $1`, [v1])
    for (const id of [principal, v2]) expect(await ler(id)).toMatchObject({ estado: 'lido' })
    expect(Number((await ler(v2)).nota)).toBe(4)
  })

  it('recusa cadeia, vínculo consigo, principal de outro usuário e variante que já tem variantes', async () => {
    const a = await novo()
    const b = await novo({ variante_de: a })
    await expect(db.query(`select item_definir_variante($1, $2)`, [await novo(), b])).rejects.toThrow('variante_de_variante')
    await expect(db.query(`select item_definir_variante($1, $1)`, [a])).rejects.toThrow()
    await expect(db.query(`select item_definir_variante($1, $2)`, [a, await novo()])).rejects.toThrow('variante_com_variantes')
    await expect(db.query(`select item_definir_variante($1, '33333333-3333-3333-3333-333333333333')`, [a])).rejects.toThrow('variante_principal_nao_encontrado')
  })

  it('desejo não sincroniza; ao adquirir, a variante assume o estado do principal', async () => {
    const principal = await novo({ estado: 'lido', nota: 4 })
    const variante = await novo({ estado: 'desejo', variante_de: principal })
    expect((await ler(variante)).estado).toBe('desejo')
    await db.query(`update itens set nota = 2 where id = $1`, [principal])
    expect((await ler(variante)).nota).toBeNull()
    await db.query(`update itens set estado = 'comprado' where id = $1`, [variante])
    expect(await ler(variante)).toMatchObject({ estado: 'lido' })
    expect(Number((await ler(variante)).nota)).toBe(2)
  })

  it('apagar o principal solta a variante (sem apagá-la)', async () => {
    const principal = await novo()
    const variante = await novo({ variante_de: principal })
    await db.query(`delete from itens where id = $1`, [principal])
    expect((await ler(variante)).variante_de).toBeNull()
  })

  it('série: variante não gera duplicidade em completa/lida; estante (itens) conta 2', async () => {
    const { rows: [s] } = await db.query<{ s: string }>(`select serie_salvar(null, '{"nome":"VarSerie","tipo":"hq","tem_numeracao":true,"total_volumes":2}', '{}') s`)
    const v1 = await novo({ serie_id: s.s, numero_volume: 1, estado: 'comprado' })
    await novo({ serie_id: s.s, numero_volume: 1, estado: 'comprado', variante_de: v1 })
    let r = (await db.query<{ completa: boolean; lida: boolean; faltantes: number[] }>(`select completa, lida, faltantes from series_com_resumo('VarSerie')`)).rows[0]
    expect(r).toEqual({ completa: false, lida: false, faltantes: [2] })
    await novo({ serie_id: s.s, numero_volume: 2, estado: 'comprado' })
    await db.query(`update itens set estado = 'lido' where serie_id = $1 and numero_volume = 1 and variante_de is null`, [s.s])
    await db.query(`update itens set estado = 'lido' where serie_id = $1 and numero_volume = 2`, [s.s])
    r = (await db.query(`select completa, lida, faltantes from series_com_resumo('VarSerie')`)).rows[0] as typeof r
    expect(r).toEqual({ completa: true, lida: true, faltantes: [] })
    const { rows: [c] } = await db.query<{ estante: number; lidos: number }>(
      `select count(*)::int estante, count(*) filter (where estado = 'lido' and variante_de is null)::int lidos from itens where serie_id = $1`, [s.s])
    expect(c).toEqual({ estante: 3, lidos: 2 })
  })
})

describe('feed de amigos (migration 0018)', () => {
  // Quatro contas: dono (Ana, U), amigo (Beto), desconhecido (Caio) e ex-amigo (Dora).
  const CAIO = '88888888-8888-8888-8888-888888888888'
  const DORA = '77777777-7777-7777-7777-777777777777'
  let amizadeDora = ''
  const como = async <T,>(uid: string, fn: () => Promise<T>): Promise<T> => {
    await db.query(`select set_config('app.uid','${uid}',false)`)
    try {
      return await fn()
    } finally {
      await db.query(`select set_config('app.uid','${U}',false)`)
    }
  }
  const admin = async (sql: string) => {
    await db.query(`reset role`)
    try {
      await db.exec(sql)
    } finally {
      await db.query(`set role authenticated`)
    }
  }
  const lido = async (extra: object = {}) =>
    (await db.query<{ id: string }>(`select item_salvar(null, $1::jsonb, '{}') id`, [JSON.stringify({ titulo: 'Leitura', tipo: 'hq', estado: 'lido', prioridade: 0, ...extra })])).rows[0].id
  const feed = async () => (await db.query<Record<string, unknown>>(`select * from feed_listar()`)).rows
  const titulos = async () => (await feed()).map((r) => r.titulo)
  const solicitar = async (apelido: string) => (await db.query<{ id: string }>(`select amizade_solicitar($1) id`, [apelido])).rows[0].id

  beforeAll(async () => {
    await admin(`
      insert into auth.users values ('${CAIO}'), ('${DORA}') on conflict do nothing;
      delete from amizades; delete from itens; delete from perfis;
      insert into perfis(user_id, apelido) values ('${U}', 'ana'), ('${OUTRO}', 'beto'), ('${CAIO}', 'caio'), ('${DORA}', 'dora');
    `)
    // Beto e Dora pedem; Ana aceita os dois. Depois Dora vira ex-amiga.
    const idBeto = await como(OUTRO, () => solicitar('ana'))
    await db.query(`select amizade_responder($1, true)`, [idBeto])
    amizadeDora = await como(DORA, () => solicitar('ana'))
    await db.query(`select amizade_responder($1, true)`, [amizadeDora])
  })

  it('interruptor desligado (padrão): nada aparece, nem para o dono', async () => {
    await lido({ titulo: 'Escondido' })
    expect(await titulos()).toEqual([])
    await como(OUTRO, async () => expect(await titulos()).toEqual([]))
  })

  it('ligar: o amigo vê, o desconhecido não; desligar some na hora e o item é preservado', async () => {
    await db.query(`select feed_configurar(true)`)
    expect(await titulos()).toContain('Escondido')
    await como(OUTRO, async () => expect(await titulos()).toContain('Escondido'))
    await como(CAIO, async () => expect(await titulos()).toEqual([]))
    await db.query(`select feed_configurar(false)`)
    await como(OUTRO, async () => expect(await titulos()).toEqual([]))
    await db.query(`select feed_configurar(true)`)
    await como(OUTRO, async () => expect(await titulos()).toContain('Escondido'))
  })

  it('ligar libera nota/crítica aos amigos; crítica privada nunca sai', async () => {
    const { rows } = await db.query<{ escopo_amigos: string[] }>(`select escopo_amigos from perfis where user_id = $1`, [U])
    expect(rows[0].escopo_amigos).toContain('notas_criticas')
    await lido({ titulo: 'Com nota', nota: 4.5, critica: 'Gostei' })
    await lido({ titulo: 'Privada', nota: 3, critica: 'Segredo', critica_privada: true })
    await como(OUTRO, async () => {
      const f = await feed()
      const a = f.find((r) => r.titulo === 'Com nota')!
      expect(Number(a.nota)).toBe(4.5)
      expect(a.critica).toBe('Gostei')
      const b = f.find((r) => r.titulo === 'Privada')!
      expect(Number(b.nota)).toBe(3)
      expect(b.critica).toBeNull()
    })
    // Sem `notas_criticas` no escopo, nem a nota sai.
    await db.query(`select amigos_escopo_atualizar('{colecao,series,lidos}')`)
    await como(OUTRO, async () => {
      const a = (await feed()).find((r) => r.titulo === 'Com nota')!
      expect(a.nota).toBeNull()
      expect(a.critica).toBeNull()
    })
    await db.query(`select amigos_escopo_atualizar('{colecao,series,lidos,notas_criticas}')`)
  })

  it('só entra item que foi marcado como lido depois (sem passado), não variante, não oculto', async () => {
    const antigo = await lido({ titulo: 'Antigo' })
    await admin(`update itens set lido_marcado_em = null where id = '${antigo}'`)
    const velho = await lido({ titulo: 'Velho' })
    await admin(`update itens set lido_marcado_em = now() - interval '91 days' where id = '${velho}'`)
    const principal = await lido({ titulo: 'Principal' })
    await lido({ titulo: 'Variante', variante_de: principal })
    const oculto = await lido({ titulo: 'Oculto' })
    await db.query(`select feed_ocultar($1, true)`, [oculto])
    const t = await titulos()
    expect(t).toContain('Principal')
    for (const fora of ['Antigo', 'Velho', 'Variante', 'Oculto']) expect(t).not.toContain(fora)
    await db.query(`select feed_ocultar($1, false)`, [oculto])
    expect(await titulos()).toContain('Oculto')
    // Deixar de ser lido tira do feed.
    await db.query(`update itens set estado = 'comprado' where id = $1`, [oculto])
    expect(await titulos()).not.toContain('Oculto')
    // O amigo não oculta o item de outra pessoa.
    await como(OUTRO, () => expect(db.query(`select feed_ocultar($1, true)`, [principal])).rejects.toThrow('item_nao_encontrado'))
  })

  it('marcação em lote vira um post por pessoa + série + dia', async () => {
    const { rows: [s] } = await db.query<{ s: string }>(`select serie_salvar(null, '{"nome":"Lote","tipo":"hq","tem_numeracao":true,"total_volumes":3}', '{}') s`)
    for (const n of [1, 2, 3]) await lido({ titulo: `Lote ${n}`, serie_id: s.s, numero_volume: n })
    const posts = (await feed()).filter((r) => r.serie_nome === 'Lote')
    expect(posts).toHaveLength(1)
    expect(posts[0].qtd).toBe(3)
  })

  it('curtir e comentar: amigo e dono podem; desconhecido e ex-amigo não; texto validado', async () => {
    const id = await lido({ titulo: 'Conversa' })
    await como(OUTRO, async () => {
      await db.query(`select feed_curtir($1)`, [id])
      await db.query(`select feed_curtir($1)`, [id]) // repetir não duplica
      await db.query(`select feed_comentar($1, '  Boa!  ')`, [id])
      await expect(db.query(`select feed_comentar($1, '   ')`, [id])).rejects.toThrow('comentario_vazio')
      await expect(db.query(`select feed_comentar($1, $2)`, [id, 'x'.repeat(501)])).rejects.toThrow('comentario_longo')
    })
    await como(CAIO, async () => {
      await expect(db.query(`select feed_curtir($1)`, [id])).rejects.toThrow('item_nao_encontrado')
      await expect(db.query(`select feed_comentar($1, 'oi')`, [id])).rejects.toThrow('item_nao_encontrado')
      expect((await db.query(`select * from feed_comentarios_listar($1)`, [id])).rows).toHaveLength(0)
    })
    const p = (await feed()).find((r) => r.item_id === id)!
    expect(p.curtidas).toBe(1)
    expect(p.curti).toBe(false)
    expect(p.comentarios).toBe(1)
    await como(OUTRO, async () => expect((await feed()).find((r) => r.item_id === id)!.curti).toBe(true))
    const { rows } = await db.query<{ texto: string }>(`select texto from feed_comentarios_listar($1)`, [id])
    expect(rows.map((r) => r.texto)).toEqual(['Boa!'])
    // Tabelas fechadas: nenhum acesso direto.
    await como(OUTRO, async () => expect((await db.query(`select * from feed_comentarios`)).rows).toHaveLength(0))
  })

  it('comentário de um amigo não aparece para outro amigo do dono que não o conhece; o dono vê todos', async () => {
    // Caio vira amigo da Ana; Beto e Caio não se conhecem.
    const idCaio = await como(CAIO, () => solicitar('ana'))
    await db.query(`select amizade_responder($1, true)`, [idCaio])
    const id = await lido({ titulo: 'Rodinha' })
    await como(OUTRO, async () => {
      await db.query(`select feed_curtir($1)`, [id])
      await db.query(`select feed_comentar($1, 'do Beto')`, [id])
    })
    await como(CAIO, async () => {
      await db.query(`select feed_comentar($1, 'do Caio')`, [id])
      const textos = (await db.query<{ texto: string }>(`select texto from feed_comentarios_listar($1)`, [id])).rows.map((r) => r.texto)
      expect(textos).toEqual(['do Caio'])
      const p = (await feed()).find((r) => r.item_id === id)!
      expect(p.comentarios).toBe(1)
      expect(p.curtidas).toBe(0)
    })
    const donoVe = (await db.query<{ texto: string }>(`select texto from feed_comentarios_listar($1)`, [id])).rows.map((r) => r.texto)
    expect(donoVe).toEqual(['do Beto', 'do Caio'])
  })

  it('apagar comentário: o autor ou o dono do item, mais ninguém', async () => {
    const id = await lido({ titulo: 'Moderação' })
    const cBeto = await como(OUTRO, async () => (await db.query<{ c: string }>(`select feed_comentar($1, 'um') c`, [id])).rows[0].c)
    const cCaio = await como(CAIO, async () => (await db.query<{ c: string }>(`select feed_comentar($1, 'dois') c`, [id])).rows[0].c)
    await como(OUTRO, () => expect(db.query(`select feed_apagar_comentario($1)`, [cCaio])).rejects.toThrow('comentario_nao_encontrado'))
    await como(OUTRO, () => db.query(`select feed_apagar_comentario($1)`, [cBeto]))
    await db.query(`select feed_apagar_comentario($1)`, [cCaio]) // dono
    expect((await db.query(`select * from feed_comentarios_listar($1)`, [id])).rows).toHaveLength(0)
  })

  it('ex-amigo: desfazer a amizade corta feed, curtida e comentário na hora', async () => {
    const id = await lido({ titulo: 'Para a Dora' })
    await como(DORA, async () => {
      expect(await titulos()).toContain('Para a Dora')
      await db.query(`select feed_comentar($1, 'da Dora')`, [id])
    })
    await db.query(`select amizade_desfazer($1)`, [amizadeDora])
    await como(DORA, async () => {
      expect(await titulos()).toEqual([])
      await expect(db.query(`select feed_curtir($1)`, [id])).rejects.toThrow('item_nao_encontrado')
      await expect(db.query(`select feed_comentar($1, 'ainda aqui?')`, [id])).rejects.toThrow('item_nao_encontrado')
      expect((await db.query(`select * from feed_comentarios_listar($1)`, [id])).rows).toHaveLength(0)
    })
    // O comentário dela some para os amigos que sobraram (ela não é mais amiga de ninguém do círculo).
    await como(OUTRO, async () => {
      const textos = (await db.query<{ texto: string }>(`select texto from feed_comentarios_listar($1)`, [id])).rows.map((r) => r.texto)
      expect(textos).not.toContain('da Dora')
    })
  })

  it('capa: só devolve o arquivo privado de item visível', async () => {
    const id = await lido({ titulo: 'Com capa' })
    await admin(`update itens set capa_url = '${U}/abc.jpg' where id = '${id}'`)
    await como(OUTRO, async () => expect((await db.query<{ c: string }>(`select feed_capa($1) c`, [id])).rows[0].c).toBe(`${U}/abc.jpg`))
    await como(DORA, async () => expect((await db.query<{ c: string | null }>(`select feed_capa($1) c`, [id])).rows[0].c).toBeNull())
    await db.query(`select feed_ocultar($1, true)`, [id])
    await como(OUTRO, async () => expect((await db.query<{ c: string | null }>(`select feed_capa($1) c`, [id])).rows[0].c).toBeNull())
  })

  it('resumo da semana: seus lidos, o que os amigos leram e o destaque', async () => {
    await admin(`delete from itens; delete from feed_curtidas; delete from feed_comentarios`)
    await como(OUTRO, async () => {
      await db.query(`select feed_configurar(true)`)
      await lido({ titulo: 'Beto leu 1', nota: 3 })
      await lido({ titulo: 'Beto leu 2', nota: 5 })
    })
    await lido({ titulo: 'Eu 1' })
    await lido({ titulo: 'Eu 2' })
    await lido({ titulo: 'Eu velho', lido_em: '2020-01-01' })
    const { rows: [r] } = await db.query<{ r: { meus_lidos: number; amigos: number; lidos_amigos: number; destaque: { titulo: string; apelido: string; nota: number } } }>(`select feed_resumo_semana() r`)
    expect(r.r.meus_lidos).toBe(2)
    expect(r.r.amigos).toBe(1)
    expect(r.r.lidos_amigos).toBe(2)
    expect(r.r.destaque).toMatchObject({ titulo: 'Beto leu 2', apelido: 'beto', nota: 5 })
    // Quem não é amigo não entra na conta do Caio... (Caio é amigo da Ana, não do Beto)
    await como(CAIO, async () => {
      const { rows: [c] } = await db.query<{ r: { amigos: number } }>(`select feed_resumo_semana() r`)
      expect(c.r.amigos).toBe(1) // só a Ana, que ligou o feed
    })
  })

  it('migration: as funções do feed exigem login e a camada interna fica fechada', () => {
    const sql = readFileSync(path.join(PASTA, '0018_feed_amigos.sql'), 'utf8')
    expect(sql).toMatch(/revoke all on all functions in schema privado/)
    expect(sql).toMatch(/revoke all on feed_curtidas from public, anon, authenticated/)
    expect(sql).toMatch(/revoke all on feed_comentarios from public, anon, authenticated/)
    for (const f of ['feed_listar(int, timestamptz)', 'feed_curtir(uuid)', 'feed_comentar(uuid, text)', 'feed_resumo_semana()']) {
      expect(sql).toContain(`revoke all on function ${f} from public, anon;`)
      expect(sql).toContain(`grant execute on function ${f} to authenticated;`)
    }
  })
})

describe('feed: tirar o post inteiro, desfazer e nota do grupo (migration 0031)', () => {
  // Dono (Ana, U) e amigo (Beto).
  const como = async <T,>(uid: string, fn: () => Promise<T>): Promise<T> => {
    await db.query(`select set_config('app.uid','${uid}',false)`)
    try {
      return await fn()
    } finally {
      await db.query(`select set_config('app.uid','${U}',false)`)
    }
  }
  const admin = async (sql: string) => {
    await db.query(`reset role`)
    try {
      await db.exec(sql)
    } finally {
      await db.query(`set role authenticated`)
    }
  }
  const feed = async () => (await db.query<Record<string, unknown>>(`select * from feed_listar()`)).rows
  const salvarItem = async (extra: object) =>
    (await db.query<{ id: string }>(`select item_salvar(null, $1::jsonb, '{}') id`, [JSON.stringify({ titulo: 'Leitura', tipo: 'hq', prioridade: 0, ...extra })])).rows[0].id
  /** Série de 4 volumes comprados; marcar como lida (como o diálogo "Marcar série como lida"). */
  const serieLida = async (nome: string, nota: number | null, critica: string | null, modo: string) => {
    const { rows: [s] } = await db.query<{ s: string }>(`select serie_salvar(null, $1::jsonb, '{}') s`, [JSON.stringify({ nome, tipo: 'hq', tem_numeracao: true, total_volumes: 4 })])
    const ids: string[] = []
    for (const n of [1, 2, 3, 4]) ids.push(await salvarItem({ titulo: `${nome} ${n}`, estado: 'comprado', serie_id: s.s, numero_volume: n }))
    await db.query(`select serie_marcar_lida($1, $2, $3, $4, true)`, [s.s, nota, critica, modo])
    return { serie: s.s, ids }
  }
  const noFeed = async (nome: string) => (await feed()).filter((r) => r.serie_nome === nome)

  beforeAll(async () => {
    await admin(`
      delete from amizades; delete from itens; delete from series; delete from perfis;
      insert into perfis(user_id, apelido) values ('${U}', 'ana'), ('${OUTRO}', 'beto');
    `)
    const idBeto = await como(OUTRO, async () => (await db.query<{ id: string }>(`select amizade_solicitar('ana') id`)).rows[0].id)
    await db.query(`select amizade_responder($1, true)`, [idBeto])
    await db.query(`select feed_configurar(true)`)
  })

  it('tirar o post de vários volumes tira o card inteiro e desfazer o devolve', async () => {
    const { ids } = await serieLida('Quatro', 4, null, 'serie_e_sem_nota')
    expect((await noFeed('Quatro'))[0].qtd).toBe(4)
    const rep = (await noFeed('Quatro'))[0].item_id as string

    const { rows: [t] } = await db.query<{ ids: string[] }>(`select feed_ocultar_post($1, true) ids`, [rep])
    expect([...t.ids].sort()).toEqual([...ids].sort())
    expect(await noFeed('Quatro')).toHaveLength(0) // some tudo, não sobra um card com 3
    await como(OUTRO, async () => expect(await noFeed('Quatro')).toHaveLength(0))

    // Aparece na lista dos tirados, como UM item com 4 volumes.
    const { rows: tirados } = await db.query<{ item_ids: string[]; qtd: number; serie_nome: string }>(`select * from feed_ocultos_listar()`)
    const q = tirados.find((r) => r.serie_nome === 'Quatro')!
    expect(q.qtd).toBe(4)
    expect([...q.item_ids].sort()).toEqual([...ids].sort())

    // Desfazer: devolve exatamente o que saiu, com o mesmo card de antes.
    const { rows: [d] } = await db.query<{ n: number }>(`select feed_ocultar_varios($1, false) n`, [t.ids])
    expect(d.n).toBe(4)
    expect((await noFeed('Quatro'))[0].qtd).toBe(4)
    await como(OUTRO, async () => expect((await noFeed('Quatro'))[0].qtd).toBe(4))
    expect((await db.query<{ serie_nome: string }>(`select * from feed_ocultos_listar()`)).rows.filter((r) => r.serie_nome === 'Quatro')).toHaveLength(0)
  })

  it('só tira o dia do post: volumes da mesma série marcados em outro dia ficam', async () => {
    const { ids } = await serieLida('DoisDias', null, null, 'serie')
    await admin(`update itens set lido_marcado_em = now() - interval '3 days' where id = '${ids[0]}'`)
    const post = (await noFeed('DoisDias')).find((r) => r.qtd === 3)!
    expect(post).toBeTruthy()
    const { rows: [t] } = await db.query<{ ids: string[] }>(`select feed_ocultar_post($1, true) ids`, [post.item_id])
    expect(t.ids).toHaveLength(3)
    const resto = await noFeed('DoisDias')
    expect(resto).toHaveLength(1)
    expect(resto[0].qtd).toBe(1)
  })

  it('com p_grupo = false tira só o item; e quem não é dono não tira nem desfaz', async () => {
    const { ids } = await serieLida('Sozinho', null, null, 'serie')
    const { rows: [t] } = await db.query<{ ids: string[] }>(`select feed_ocultar_post($1, false) ids`, [ids[0]])
    expect(t.ids).toEqual([ids[0]])
    expect((await noFeed('Sozinho'))[0].qtd).toBe(3)
    await como(OUTRO, async () => {
      await expect(db.query(`select feed_ocultar_post($1, true)`, [ids[1]])).rejects.toThrow('item_nao_encontrado')
      const { rows: [r] } = await db.query<{ n: number }>(`select feed_ocultar_varios($1, false) n`, [[ids[0]]])
      expect(r.n).toBe(0) // não mexe no item da Ana
    })
    expect((await noFeed('Sozinho'))[0].qtd).toBe(3)
    await db.query(`select feed_ocultar_varios($1, false)`, [[ids[0]]])
    expect((await noFeed('Sozinho'))[0].qtd).toBe(4)
  })

  it('nota e crítica dadas ao marcar a série aparecem no post de vários volumes (falhava: só a crítica saía com o modo "serie")', async () => {
    // Modo padrão da tela: nota e crítica vão para os volumes.
    await serieLida('Padrao', 4.5, 'Muito bom', 'serie_e_sem_nota')
    // Modo "só a série": nada vai para os volumes; antes disso a nota não saía do banco.
    await serieLida('SoSerie', 4, 'Gostei da série toda', 'serie')
    await como(OUTRO, async () => {
      const p = (await noFeed('Padrao'))[0]
      expect(p.qtd).toBe(4)
      expect(Number(p.nota_media)).toBe(4.5)
      expect(p.avaliados).toBe(4)
      expect(p.critica_grupo).toBe('Muito bom')
      expect(Number(p.serie_nota)).toBe(4.5)
      const s = (await noFeed('SoSerie'))[0]
      expect(s.nota).toBeNull()
      expect(s.nota_media).toBeNull()
      expect(Number(s.serie_nota)).toBe(4)
      expect(s.serie_critica).toBe('Gostei da série toda')
    })
  })

  it('nota/crítica de UM volume do lote chegam no post, com o volume, mesmo que não seja o que representa o card', async () => {
    const { ids } = await serieLida('UmSo', null, null, 'serie')
    await db.query(`update itens set nota = 3, critica = 'Só o miolo', critica_spoiler = true where id = $1`, [ids[1]])
    await como(OUTRO, async () => {
      const p = (await noFeed('UmSo'))[0]
      expect(p.avaliados).toBe(1)
      expect(Number(p.nota_media)).toBe(3)
      expect(p.critica_grupo).toBe('Só o miolo')
      expect(p.critica_grupo_spoiler).toBe(true)
      expect(Number(p.critica_grupo_volume)).toBe(2)
    })
  })

  it('privacidade: sem notas_criticas no escopo ou com crítica privada, nada do grupo nem da série sai', async () => {
    const { serie, ids } = await serieLida('Privada', 5, 'Segredo', 'serie_e_sem_nota')
    await db.query(`update itens set critica_privada = true where serie_id = $1`, [serie])
    await db.query(`update series set critica_privada = true where id = $1`, [serie])
    await como(OUTRO, async () => {
      const p = (await noFeed('Privada'))[0]
      expect(Number(p.nota_media)).toBe(5) // a nota continua visível com o escopo
      expect(p.critica_grupo).toBeNull()
      expect(p.critica).toBeNull()
      expect(p.serie_critica).toBeNull()
    })
    await db.query(`select amigos_escopo_atualizar('{colecao,series,lidos}')`)
    await como(OUTRO, async () => {
      const p = (await noFeed('Privada'))[0]
      expect(p.nota).toBeNull()
      expect(p.nota_media).toBeNull()
      expect(p.avaliados).toBe(0)
      expect(p.serie_nota).toBeNull()
      expect(p.critica_grupo).toBeNull()
    })
    await db.query(`select amigos_escopo_atualizar('{colecao,series,lidos,notas_criticas}')`)
    expect(ids).toHaveLength(4)
  })

  it('item tirado do feed antes de dar a nota: continua fora (a nota vale, o post só volta ao recolocar)', async () => {
    const id = await salvarItem({ titulo: 'Tirado antes', estado: 'lido' })
    await db.query(`select feed_ocultar_post($1, true)`, [id])
    await db.query(`update itens set nota = 5, critica = 'Obra-prima' where id = $1`, [id])
    await como(OUTRO, async () => expect((await feed()).map((r) => r.titulo)).not.toContain('Tirado antes'))
    await db.query(`select feed_ocultar_varios($1, false)`, [[id]])
    await como(OUTRO, async () => {
      const p = (await feed()).find((r) => r.titulo === 'Tirado antes')!
      expect(Number(p.nota)).toBe(5)
      expect(p.critica).toBe('Obra-prima')
    })
  })

  it('migration: funções novas exigem login', () => {
    const sql = readFileSync(path.join(PASTA, '0031_feed_desfazer_e_nota_do_grupo.sql'), 'utf8')
    for (const f of ['feed_ocultar_post(uuid, boolean)', 'feed_ocultar_varios(uuid[], boolean)', 'feed_ocultos_listar()', 'feed_listar(int, timestamptz)']) {
      expect(sql).toContain(`revoke all on function ${f} from public, anon;`)
      expect(sql).toContain(`grant execute on function ${f} to authenticated;`)
    }
  })
})

describe('feed: capa do melhor volume da série (migration 0032)', () => {
  const como = async <T,>(uid: string, fn: () => Promise<T>): Promise<T> => {
    await db.query(`select set_config('app.uid','${uid}',false)`)
    try {
      return await fn()
    } finally {
      await db.query(`select set_config('app.uid','${U}',false)`)
    }
  }
  const admin = async (sql: string) => {
    await db.query(`reset role`)
    try {
      await db.exec(sql)
    } finally {
      await db.query(`set role authenticated`)
    }
  }
  const feed = async () => (await db.query<Record<string, unknown>>(`select * from feed_listar()`)).rows
  const noFeed = async (nome: string) => (await feed()).filter((r) => r.serie_nome === nome)
  const salvarItem = async (extra: object) =>
    (await db.query<{ id: string }>(`select item_salvar(null, $1::jsonb, '{}') id`, [JSON.stringify({ titulo: 'Leitura', tipo: 'hq', prioridade: 0, ...extra })])).rows[0].id
  /** Série de 5 volumes, cada um com a sua capa privada (`capa-<n>.jpg`), marcada como lida de uma vez. */
  const serieLida = async (nome: string) => {
    const { rows: [s] } = await db.query<{ s: string }>(`select serie_salvar(null, $1::jsonb, '{}') s`, [JSON.stringify({ nome, tipo: 'hq', tem_numeracao: true, total_volumes: 5 })])
    const ids: string[] = []
    for (const n of [1, 2, 3, 4, 5]) ids.push(await salvarItem({ titulo: `${nome} ${n}`, estado: 'comprado', serie_id: s.s, numero_volume: n }))
    // `item_salvar` não grava a capa (ela vem do upload): põe uma por volume direto na tabela.
    for (const [k, id] of ids.entries()) await admin(`update itens set capa_url = '${U}/${nome}-${k + 1}.jpg' where id = '${id}'`)
    await db.query(`select serie_marcar_lida($1, null, null, 'serie_e_sem_nota', true)`, [s.s])
    return { serie: s.s, ids }
  }
  const marcarMelhor = (id: string, marcar = true) => db.query(`select item_melhor_da_serie_definir($1, $2)`, [id, marcar])

  beforeAll(async () => {
    await admin(`
      delete from amizades; delete from itens; delete from series; delete from perfis;
      insert into perfis(user_id, apelido) values ('${U}', 'ana'), ('${OUTRO}', 'beto');
    `)
    const idBeto = await como(OUTRO, async () => (await db.query<{ id: string }>(`select amizade_solicitar('ana') id`)).rows[0].id)
    await db.query(`select amizade_responder($1, true)`, [idBeto])
    await db.query(`select feed_configurar(true)`)
  })

  it('card de vários volumes: sem melhor volume as colunas novas vêm nulas (a capa de sempre vale)', async () => {
    await serieLida('SemMelhor')
    for (const r of await noFeed('SemMelhor')) {
      expect(r.qtd).toBe(5)
      expect(r.capa_destaque).toBeNull()
      expect(r.capa_destaque_item).toBeNull()
    }
  })

  it('com melhor volume marcado, o card traz a capa dele (dono e amigo); `capa` e `item_id` seguem os mesmos', async () => {
    const { ids } = await serieLida('ComMelhor')
    const antes = (await noFeed('ComMelhor'))[0]
    await marcarMelhor(ids[4]) // o volume 5
    const dono = (await noFeed('ComMelhor'))[0]
    expect(dono.capa_destaque).toBe('ComMelhor-5.jpg')
    expect(dono.capa_destaque_item).toBe(ids[4])
    expect(dono.item_id).toBe(antes.item_id) // quem representa o post (curtidas/comentários) não muda
    expect(dono.capa).toBe(antes.capa)
    await como(OUTRO, async () => {
      const amigo = (await noFeed('ComMelhor'))[0]
      expect(amigo.capa_destaque).toBe('ComMelhor-5.jpg')
      expect(amigo.capa_destaque_item).toBe(ids[4])
      // A capa privada do melhor sai pela rota do feed, pedida pelo id dele.
      expect((await db.query<{ c: string }>(`select feed_capa($1) c`, [amigo.capa_destaque_item])).rows[0].c).toBe(`${U}/ComMelhor-5.jpg`)
    })
  })

  it('acompanha o melhor: marcado depois, trocado ou desmarcado (a capa não fica gravada no post)', async () => {
    const { ids } = await serieLida('Muda')
    expect((await noFeed('Muda'))[0].capa_destaque).toBeNull()
    await marcarMelhor(ids[1])
    expect((await noFeed('Muda'))[0].capa_destaque_item).toBe(ids[1])
    await marcarMelhor(ids[3]) // trocar desmarca o anterior
    expect((await noFeed('Muda'))[0].capa_destaque_item).toBe(ids[3])
    await marcarMelhor(ids[3], false)
    const r = (await noFeed('Muda'))[0]
    expect(r.capa_destaque).toBeNull()
    expect(r.capa_destaque_item).toBeNull()
  })

  it('card de um volume não muda, nem o melhor que ficou de fora do card (outro dia)', async () => {
    const { ids } = await serieLida('OutroDia')
    await marcarMelhor(ids[4])
    // O melhor foi lido há 3 dias; o card de hoje tem os outros 4.
    await admin(`update itens set lido_marcado_em = now() - interval '3 days' where id = '${ids[4]}'`)
    const rows = await noFeed('OutroDia')
    const hoje = rows.find((r) => r.qtd === 4)!
    expect(hoje.capa_destaque).toBeNull() // o card não cita o melhor: fica a capa de sempre
    const antigo = rows.find((r) => r.qtd === 1)!
    expect(antigo.item_id).toBe(ids[4])
    expect(antigo.capa_destaque).toBeNull() // um volume só: a coluna nova não entra
  })

  it('privacidade: o amigo só vê a marca com notas_criticas + lidos no escopo; o dono vê sempre', async () => {
    const { ids } = await serieLida('Escopo')
    await marcarMelhor(ids[4])
    for (const escopo of ['{colecao,series,lidos}', '{colecao,series,notas_criticas}']) {
      await db.query(`select amigos_escopo_atualizar('${escopo}')`)
      await como(OUTRO, async () => {
        const r = (await noFeed('Escopo'))[0]
        expect(r.qtd).toBe(5)
        expect(r.capa_destaque).toBeNull()
        expect(r.capa_destaque_item).toBeNull()
      })
      expect((await noFeed('Escopo'))[0].capa_destaque_item).toBe(ids[4])
    }
    await db.query(`select amigos_escopo_atualizar('{colecao,series,lidos,notas_criticas}')`)
    await como(OUTRO, async () => expect((await noFeed('Escopo'))[0].capa_destaque_item).toBe(ids[4]))
  })

  it('melhor volume tirado do feed some do card (não vaza) e o melhor sem capa cai na capa de sempre', async () => {
    const { ids } = await serieLida('Tirado')
    await marcarMelhor(ids[4])
    await db.query(`select feed_ocultar_varios($1, true)`, [[ids[4]]])
    const r = (await noFeed('Tirado'))[0]
    expect(r.qtd).toBe(4)
    expect(r.capa_destaque).toBeNull()
    await db.query(`select feed_ocultar_varios($1, false)`, [[ids[4]]])
    expect((await noFeed('Tirado'))[0].capa_destaque_item).toBe(ids[4])

    const { ids: ids2 } = await serieLida('SemCapa')
    await marcarMelhor(ids2[4])
    await admin(`update itens set capa_url = null where id = '${ids2[4]}'`)
    const s = (await noFeed('SemCapa'))[0]
    expect(s.capa_destaque).toBeNull()
    expect(s.capa_destaque_item).toBeNull()
  })

  it('migration: feed_listar exige login e só acrescenta colunas no fim', () => {
    const sql = readFileSync(path.join(PASTA, '0032_feed_capa_do_melhor_volume.sql'), 'utf8')
    expect(sql).toContain('revoke all on function feed_listar(int, timestamptz) from public, anon;')
    expect(sql).toContain('grant execute on function feed_listar(int, timestamptz) to authenticated;')
    expect(sql.indexOf('serie_critica text,')).toBeLessThan(sql.indexOf('capa_destaque text,'))
  })
})

describe('notas entre amigos (migration 0019)', () => {
  // Dono (Ana, U), amigo (Beto), desconhecido (Caio), ex-amigo (Dora).
  const CAIO = '88888888-8888-8888-8888-888888888888'
  const DORA = '77777777-7777-7777-7777-777777777777'
  const CHAVE = 'berserk|3|manga'
  const como = async <T,>(uid: string, fn: () => Promise<T>): Promise<T> => {
    await db.query(`select set_config('app.uid','${uid}',false)`)
    try {
      return await fn()
    } finally {
      await db.query(`select set_config('app.uid','${U}',false)`)
    }
  }
  const admin = async (sql: string) => {
    await db.query(`reset role`)
    try {
      await db.exec(sql)
    } finally {
      await db.query(`set role authenticated`)
    }
  }
  const salvar = async (extra: object) =>
    (await db.query<{ id: string }>(`select item_salvar(null, $1::jsonb, '{}') id`, [JSON.stringify({ titulo: 'Berserk 3', tipo: 'manga', estado: 'lido', prioridade: 0, obra_chave: CHAVE, ...extra })])).rows[0].id
  const obra = async (chave = CHAVE) => (await db.query<Record<string, unknown>>(`select * from obra_amigos($1)`, [chave])).rows
  const serie = async (chave = 'berserk|manga') => (await db.query<Record<string, unknown>>(`select * from serie_amigos($1)`, [chave])).rows

  let amizadeDora = ''
  beforeAll(async () => {
    await admin(`
      insert into auth.users values ('${CAIO}'), ('${DORA}') on conflict do nothing;
      delete from amizades; delete from itens; delete from series; delete from perfis;
      insert into perfis(user_id, apelido, escopo_amigos) values
        ('${U}', 'ana', '{notas_criticas,lidos}'), ('${OUTRO}', 'beto', '{notas_criticas,lidos}'),
        ('${CAIO}', 'caio', '{notas_criticas,lidos}'), ('${DORA}', 'dora', '{notas_criticas,lidos}');
    `)
    const sol = async (apelido: string) => (await db.query<{ id: string }>(`select amizade_solicitar($1) id`, [apelido])).rows[0].id
    const idBeto = await como(OUTRO, () => sol('ana'))
    await db.query(`select amizade_responder($1, true)`, [idBeto])
    amizadeDora = await como(DORA, () => sol('ana'))
    await db.query(`select amizade_responder($1, true)`, [amizadeDora])
    // Beto, Caio e Dora leram e avaliaram a mesma obra.
    for (const uid of [OUTRO, CAIO, DORA]) {
      await como(uid, () => salvar({ nota: uid === OUTRO ? 4.5 : 2, critica: `crítica de ${uid.slice(0, 2)}` }))
    }
  })

  it('amigo vê; desconhecido (Caio) não vê ninguém', async () => {
    const r = await obra()
    expect(r.map((x) => x.apelido).sort()).toEqual(['beto', 'dora'])
    await como(CAIO, async () => expect(await obra()).toEqual([])) // Caio não tem amigos
  })

  it('ex-amigo some na hora', async () => {
    await admin(`delete from amizades where id = '${amizadeDora}'`)
    expect((await obra()).map((x) => x.apelido)).toEqual(['beto'])
    await como(DORA, async () => expect(await obra()).toEqual([]))
  })

  it('crítica privada nunca sai; escopo sem notas_criticas tira tudo', async () => {
    await admin(`update itens set critica_privada = true where user_id = '${OUTRO}'`)
    const [r] = await obra()
    expect(Number(r.nota)).toBe(4.5)
    expect(r.critica).toBeNull()
    await admin(`update perfis set escopo_amigos = '{lidos}' where user_id = '${OUTRO}'`)
    expect(await obra()).toEqual([])
    await admin(`update perfis set escopo_amigos = '{notas_criticas,lidos}' where user_id = '${OUTRO}'; update itens set critica_privada = false where user_id = '${OUTRO}'`)
  })

  it('variante não duplica; chave diferente não casa; só lido', async () => {
    const principal = await como(OUTRO, async () => (await db.query<{ id: string }>(`select id from itens where obra_chave = $1`, [CHAVE])).rows[0].id)
    await como(OUTRO, () => salvar({ titulo: 'Berserk 3 capa alternativa', nota: 4.5, variante_de: principal }))
    expect(await obra()).toHaveLength(1)
    expect(await obra('berserk|4|manga')).toEqual([])
    expect(await obra('')).toEqual([])
    // Volta a ser só "comprado": sai da lista.
    await admin(`update itens set variante_de = null, estado = 'comprado' where user_id = '${OUTRO}'`)
    expect(await obra()).toEqual([])
    await admin(`delete from itens where user_id = '${OUTRO}'`)
  })

  it('curtir/comentar só onde o item aparece no feed; casou_por usa o ISBN', async () => {
    const id = await como(OUTRO, () => salvar({ nota: 5, isbn: '9781506711980' }))
    const [sem] = await obra()
    expect(sem.interagivel).toBe(false)
    expect(sem.casou_por).toBe('nome')
    await como(OUTRO, () => db.query(`select feed_configurar(true)`))
    // item já nasceu lido com o feed desligado, mas lido_marcado_em é preenchido sempre
    const [com] = (await db.query<Record<string, unknown>>(`select * from obra_amigos($1, '9781506711980')`, [CHAVE])).rows
    expect(com.item_id).toBe(id)
    expect(com.interagivel).toBe(true)
    expect(com.casou_por).toBe('isbn')
    await db.query(`select feed_curtir($1)`, [id])
    expect(Number((await obra())[0].curtidas)).toBe(1)
  })

  it('série: nota própria ou média dos volumes; crítica privada fora; desconhecido não vê', async () => {
    await admin(`
      insert into series(id, user_id, nome, tipo, serie_chave, nota, critica) values
        ('aaaaaaaa-0000-0000-0000-000000000001', '${OUTRO}', 'Berserk', 'manga', 'berserk|manga', null, 'Série ótima');
      insert into itens(user_id, serie_id, titulo, tipo, estado, nota) values
        ('${OUTRO}', 'aaaaaaaa-0000-0000-0000-000000000001', 'v1', 'manga', 'lido', 4),
        ('${OUTRO}', 'aaaaaaaa-0000-0000-0000-000000000001', 'v2', 'manga', 'lido', 5);
    `)
    const [r] = await serie()
    expect(Number(r.nota)).toBe(4.5)
    expect(r.critica).toBe('Série ótima')
    await admin(`update series set critica_privada = true, nota = 3 where user_id = '${OUTRO}'`)
    const [p] = await serie()
    expect(Number(p.nota)).toBe(3)
    expect(p.critica).toBeNull()
    await como(CAIO, async () => expect(await serie()).toEqual([]))
  })

  it('migration: funções exigem login e a camada interna fica fechada', () => {
    const sql = readFileSync(path.join(PASTA, '0019_notas_entre_amigos.sql'), 'utf8')
    expect(sql).toMatch(/revoke all on all functions in schema privado/)
    for (const f of ['obra_amigos(text, text)', 'serie_amigos(text)']) {
      expect(sql).toContain(`revoke all on function ${f} from public, anon;`)
      expect(sql).toContain(`grant execute on function ${f} to authenticated;`)
    }
  })
})

describe('casar obra por ISBN e vínculo manual (migration 0020)', () => {
  // Ana (U) é a visitante; Beto (OUTRO) é amigo; Caio não é amigo de ninguém; Dora (ex-amigo) também não.
  const CAIO = '88888888-8888-8888-8888-888888888888'
  const DORA = '77777777-7777-7777-7777-777777777777'
  const MINHA = 'batman absolute|1|hq'
  const ISBN = '9781506711980'
  const como = async <T,>(uid: string, fn: () => Promise<T>): Promise<T> => {
    await db.query(`select set_config('app.uid','${uid}',false)`)
    try {
      return await fn()
    } finally {
      await db.query(`select set_config('app.uid','${U}',false)`)
    }
  }
  const admin = async (sql: string) => {
    await db.query(`reset role`)
    try {
      await db.exec(sql)
    } finally {
      await db.query(`set role authenticated`)
    }
  }
  const salvar = async (extra: object) =>
    (await db.query<{ id: string }>(`select item_salvar(null, $1::jsonb, '{}') id`, [JSON.stringify({ titulo: 'x', tipo: 'hq', estado: 'lido', prioridade: 0, nota: 4, ...extra })])).rows[0].id
  const obra = async (chave: string | null, isbn: string | null = null) =>
    (await db.query<Record<string, unknown>>(`select * from obra_amigos($1, $2)`, [chave, isbn])).rows
  const erro = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      return null
    } catch (e) {
      return (e as Error).message
    }
  }
  const criar = (de: string, para: string) => db.query(`select obra_equivalencia_criar($1, $2)`, [de, para])

  beforeAll(async () => {
    await admin(`
      insert into auth.users values ('${CAIO}'), ('${DORA}') on conflict do nothing;
      delete from obra_equivalencias; delete from amizades; delete from itens; delete from series; delete from perfis;
      insert into perfis(user_id, apelido, escopo_amigos) values
        ('${U}', 'ana', '{notas_criticas,lidos,colecao}'), ('${OUTRO}', 'beto', '{notas_criticas,lidos,colecao}'),
        ('${CAIO}', 'caio', '{notas_criticas,lidos,colecao}'), ('${DORA}', 'dora', '{notas_criticas,lidos,colecao}');
    `)
    const id = (await como(OUTRO, async () => (await db.query<{ id: string }>(`select amizade_solicitar('ana') id`)).rows[0].id))
    await db.query(`select amizade_responder($1, true)`, [id])
    await salvar({ titulo: 'Batman Absolute 1', obra_chave: MINHA, isbn: ISBN })
    // Beto: mesmo ISBN com nome diferente (duas edições, a mais nova sem ISBN), e outra obra sem ISBN.
    await como(OUTRO, async () => {
      await salvar({ titulo: 'Absolute Batman 1', obra_chave: 'absolute batman|1|hq', isbn: '978-1-5067-1198-0', nota: 5 })
      await salvar({ titulo: 'Outra Obra', obra_chave: 'outra obra|2|hq', nota: 3 })
    })
    // Dora (não é amiga) tem o mesmo ISBN.
    await como(DORA, () => salvar({ titulo: 'Absolute Batman 1', obra_chave: 'absolute batman|1|hq', isbn: ISBN }))
  })

  it('ISBN igual casa mesmo com chave diferente; sem ISBN nada muda; não-amigo fica de fora', async () => {
    expect(await obra(MINHA)).toEqual([])
    const r = await obra(MINHA, ISBN)
    expect(r).toHaveLength(1)
    expect(r[0].apelido).toBe('beto')
    expect(r[0].casou_por).toBe('isbn')
    expect(await obra(null, ISBN)).toHaveLength(1) // item sem chave ainda casa por ISBN
    expect(await obra(MINHA, '9780000000002')).toEqual([])
  })

  it('ISBN-10 e com hífens normalizam para o mesmo ISBN-13', async () => {
    expect(await obra(MINHA, '1-50671198-7')).toHaveLength(1)
    // A camada interna fica fechada para o app; confere a normalização como administrador.
    await db.query(`reset role`)
    try {
      expect((await db.query<{ v: string | null }>(`select privado.isbn13_norm('1506711987') v`)).rows[0].v).toBe(ISBN)
      expect((await db.query<{ v: string | null }>(`select privado.isbn13_norm('abc') v`)).rows[0].v).toBeNull()
    } finally {
      await db.query(`set role authenticated`)
    }
  })

  it('uma linha por pessoa: casa por chave e por ISBN ao mesmo tempo, e com variante', async () => {
    await como(OUTRO, () => salvar({ titulo: 'Batman Absolute 1', obra_chave: MINHA, nota: 2 }))
    const r = await obra(MINHA, ISBN)
    expect(r).toHaveLength(1)
    expect(r[0].casou_por).toBe('isbn')
    const semIsbn = await obra(MINHA)
    expect(semIsbn).toHaveLength(1)
    expect(semIsbn[0].casou_por).toBe('nome')
    await admin(`delete from itens where user_id = '${OUTRO}' and obra_chave = '${MINHA}'`)
  })

  it('vínculo manual: cria, casa como "manual", só na visão de quem vinculou, e desfaz', async () => {
    const ALVO = 'outra obra|2|hq'
    expect(await obra(MINHA)).toEqual([])
    await criar(MINHA, ALVO)
    await criar(MINHA, ALVO) // idempotente
    const r = await obra(MINHA)
    expect(r).toHaveLength(1)
    expect(r[0].casou_por).toBe('manual')
    expect(Number(r[0].nota)).toBe(3)
    const lista = (await db.query<Record<string, unknown>>(`select * from obra_equivalencias_listar($1)`, [MINHA])).rows
    expect(lista).toHaveLength(1)
    expect(lista[0].apelido).toBe('beto')
    // Não altera a visão do amigo nem a de ninguém mais.
    await como(OUTRO, async () => expect(await obra(ALVO)).toEqual([]))
    await como(CAIO, async () => {
      expect(await obra(MINHA)).toEqual([])
      expect((await db.query(`select * from obra_equivalencias`)).rows).toEqual([])
      expect((await db.query<Record<string, unknown>>(`select * from obra_equivalencias_listar($1)`, [MINHA])).rows).toEqual([])
      await db.query(`select obra_equivalencia_desfazer($1, $2)`, [MINHA, ALVO]) // não apaga o de Ana
    })
    expect(await obra(MINHA)).toHaveLength(1)
    await db.query(`select obra_equivalencia_desfazer($1, $2)`, [MINHA, ALVO])
    expect(await obra(MINHA)).toEqual([])
  })

  it('não vincula a quem não é amigo, ao que o amigo não compartilha, nem a obra alheia; escrita direta é negada', async () => {
    expect(await erro(() => criar(MINHA, 'absolute batman|1|hq')) ).toBeNull() // Beto é amigo e tem essa chave
    await db.query(`select obra_equivalencia_desfazer($1, 'absolute batman|1|hq')`, [MINHA])
    // Dora não é amiga: só ela tem essa chave exclusiva.
    await como(DORA, () => salvar({ titulo: 'Só da Dora', obra_chave: 'so da dora|1|hq' }))
    expect(await erro(() => criar(MINHA, 'so da dora|1|hq'))).toMatch(/equivalencia_obra_indisponivel/)
    // Caio não tem item com a chave da Ana.
    await como(CAIO, async () => expect(await erro(() => criar(MINHA, 'outra obra|2|hq'))).toMatch(/item_nao_encontrado/))
    // O amigo tira "coleção" e "lidos" do escopo: deixa de ser vinculável.
    await admin(`update perfis set escopo_amigos = '{notas_criticas}' where user_id = '${OUTRO}'`)
    expect(await erro(() => criar(MINHA, 'outra obra|2|hq'))).toMatch(/equivalencia_obra_indisponivel/)
    await admin(`update perfis set escopo_amigos = '{notas_criticas,lidos,colecao}' where user_id = '${OUTRO}'`)
    expect(await erro(() => criar(MINHA, MINHA))).toMatch(/equivalencia_invalida/)
    expect(await erro(() => db.query(`insert into obra_equivalencias(user_id, obra_chave, obra_chave_amigo) values ('${U}', '${MINHA}', 'so da dora|1|hq')`))).toMatch(/row-level security|permission denied/)
  })

  it('busca entre os itens dos amigos respeita amizade e escopo', async () => {
    const buscar = async (t: string) => (await db.query<Record<string, unknown>>(`select * from amigos_buscar_obras($1)`, [t])).rows
    expect((await buscar('outra')).map((x) => x.apelido)).toEqual(['beto'])
    expect(await buscar('o')).toEqual([]) // termo curto demais
    expect(await buscar('so da dora')).toEqual([]) // não é amiga
    expect(await buscar('%')).toEqual([]) // curinga é literal
    await admin(`update perfis set escopo_amigos = '{notas_criticas}' where user_id = '${OUTRO}'`)
    expect(await buscar('outra')).toEqual([])
    await admin(`update perfis set escopo_amigos = '{notas_criticas,lidos,colecao}' where user_id = '${OUTRO}'`)
  })

  it('migration: funções exigem login e a tabela só tem leitura/exclusão para o app', () => {
    const sql = readFileSync(path.join(PASTA, '0020_casar_obra_por_isbn_e_manual.sql'), 'utf8')
    for (const f of ['obra_amigos(text, text)', 'obra_equivalencia_criar(text, text)', 'obra_equivalencia_desfazer(text, text)', 'amigos_buscar_obras(text)', 'obra_equivalencias_listar(text)']) {
      expect(sql).toContain(`revoke all on function ${f} from public, anon;`)
      expect(sql).toContain(`grant execute on function ${f} to authenticated;`)
    }
    expect(sql).toContain('grant select, delete on obra_equivalencias to authenticated;')
  })
})

describe('escopo dos amigos com notas por padrão (migration 0021)', () => {
  const ANTIGA = '22222222-2222-2222-2222-222222222222'
  const NOVA = '33333333-3333-3333-3333-333333333333'

  it('conta nova nasce com notas_criticas; conta existente não muda', async () => {
    const d = new PGlite()
    await d.exec(`
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true),'')::uuid $$;
      create schema storage;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(bucket_id text, name text);
      create function storage.foldername(n text) returns text[] language sql as $$ select string_to_array(n,'/') $$;
      create role authenticated; create role anon;
    `)
    const ate0020 = ['0001_init', '0002_editora_vira_tag', '0003_busca_capa_serie', '0004_serie_tem_numeracao', '0005_remove_view_tags_efetivas', '0006_integridade_indices_e_limites', '0007_funcoes_transacionais_e_resumo', '0008_nota_meia_estrela_e_critica', '0009_nota_e_critica_da_serie', '0010_serie_lida_e_lido_em', '0011_catalogo_edicoes', '0012_capas_compartilhadas', '0013_compartilhamento', '0014_amigos_presentes_emprestimos', '0016_foto_de_perfil', '0017_capa_variante', '0018_feed_amigos', '0019_notas_entre_amigos', '0020_casar_obra_por_isbn_e_manual']
    for (const f of ate0020) await d.exec(readFileSync(path.join(PASTA, `${f}.sql`), 'utf8'))
    await d.exec(`insert into auth.users values ('${ANTIGA}'), ('${NOVA}'); insert into perfis (user_id) values ('${ANTIGA}');`)
    const antes = (await d.query<{ escopo_amigos: string[] }>(`select escopo_amigos from perfis where user_id = '${ANTIGA}'`)).rows[0].escopo_amigos
    expect(antes).toEqual(['colecao', 'series', 'lidos'])

    await d.exec(readFileSync(path.join(PASTA, '0021_escopo_amigos_notas_padrao.sql'), 'utf8'))

    const depois = (await d.query<{ escopo_amigos: string[] }>(`select escopo_amigos from perfis where user_id = '${ANTIGA}'`)).rows[0].escopo_amigos
    expect(depois).toEqual(antes)
    await d.exec(`insert into perfis (user_id) values ('${NOVA}')`)
    const nova = (await d.query<{ escopo_amigos: string[] }>(`select escopo_amigos from perfis where user_id = '${NOVA}'`)).rows[0].escopo_amigos
    expect(nova).toEqual(['colecao', 'series', 'lidos', 'notas_criticas'])
    await d.close()
  }, 60_000)
})

describe('chave da obra sem sufixo de edição (migration 0022)', () => {
  const A = '22222222-2222-2222-2222-222222222222'
  const B = '33333333-3333-3333-3333-333333333333'
  const ate0021 = ['0001_init', '0002_editora_vira_tag', '0003_busca_capa_serie', '0004_serie_tem_numeracao', '0005_remove_view_tags_efetivas', '0006_integridade_indices_e_limites', '0007_funcoes_transacionais_e_resumo', '0008_nota_meia_estrela_e_critica', '0009_nota_e_critica_da_serie', '0010_serie_lida_e_lido_em', '0011_catalogo_edicoes', '0012_capas_compartilhadas', '0013_compartilhamento', '0014_amigos_presentes_emprestimos', '0016_foto_de_perfil', '0017_capa_variante', '0018_feed_amigos', '0019_notas_entre_amigos', '0020_casar_obra_por_isbn_e_manual', '0021_escopo_amigos_notas_padrao']
  const novo = async () => {
    const d = new PGlite()
    await d.exec(`
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true),'')::uuid $$;
      create schema storage;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(bucket_id text, name text);
      create function storage.foldername(n text) returns text[] language sql as $$ select string_to_array(n,'/') $$;
      create role authenticated; create role anon;
    `)
    for (const f of ate0021) await d.exec(readFileSync(path.join(PASTA, `${f}.sql`), 'utf8'))
    return d
  }
  const migration = readFileSync(path.join(PASTA, '0022_chave_obra_edicao_luxo.sql'), 'utf8')

  it('SQL e TS dão a mesma chave (obra e série), com e sem sufixo', async () => {
    const d = await novo()
    await d.exec(migration)
    const casos: { serie: string | null; numero: number | null; titulo: string; tipo: 'hq' | 'manga' | null }[] = [
      { serie: 'Berserk', numero: 3, titulo: 'Berserk Vol. 3', tipo: 'manga' },
      { serie: 'Berserk — Edição de Luxo', numero: 3, titulo: 'x', tipo: 'manga' },
      { serie: 'Berserk Edição de Luxo', numero: 3, titulo: 'x', tipo: 'manga' },
      { serie: 'Batman Deluxe', numero: 1, titulo: 'Batman', tipo: 'hq' },
      { serie: 'Batman: Deluxe Edition', numero: 1.5, titulo: 'Batman', tipo: 'hq' },
      { serie: 'Akira (Nova Edição)', numero: 2, titulo: 'Akira', tipo: 'manga' },
      { serie: 'Watchmen — Edição Definitiva', numero: null, titulo: 'Watchmen Edição Definitiva', tipo: 'hq' },
      { serie: 'Sandman Omnibus', numero: 1, titulo: 'Sandman Omnibus', tipo: 'hq' },
      { serie: 'Nova York', numero: 1, titulo: 'Nova York', tipo: 'hq' },
      { serie: 'Deluxe', numero: 1, titulo: 'x', tipo: 'hq' },
      { serie: 'Mônica & Cascão #5', numero: 5, titulo: 'Ação — Édição', tipo: null },
      { serie: null, numero: null, titulo: 'Maus', tipo: 'hq' },
      { serie: null, numero: null, titulo: 'Maus Edição de Luxo', tipo: 'hq' },
      { serie: 'Vol. de Tomo', numero: null, titulo: 'T', tipo: 'hq' },
    ]
    for (const c of casos) {
      const r = await d.query<{ o: string; s: string }>(
        `select privado.chave_obra($1, $2::numeric, $3, $4) o, privado.chave_serie($5, $4) s`,
        [c.serie, c.numero, c.titulo, c.tipo, c.serie ?? c.titulo]
      )
      expect(r.rows[0].o, JSON.stringify(c)).toBe(chaveObra(c))
      expect(r.rows[0].s, JSON.stringify(c)).toBe(chaveSerie(c.serie ?? c.titulo, c.tipo))
    }
    await d.close()
  }, 60_000)

  it('casos de negócio: luxo junta; omnibus e número diferente não', () => {
    const k = (serie: string, numero: number | null, tipo: 'hq' | 'manga' = 'manga') => chaveObra({ serie, numero, titulo: '', tipo })
    expect(k('Berserk Edição de Luxo', 3)).toBe(k('Berserk', 3))
    expect(k('Batman Deluxe', 1, 'hq')).toBe(k('Batman', 1, 'hq'))
    expect(k('Berserk Omnibus', 1)).not.toBe(k('Berserk', 1))
    expect(k('Berserk Edição de Luxo', 4)).not.toBe(k('Berserk', 3))
    expect(k('Berserk Edição de Luxo', 3, 'hq')).not.toBe(k('Berserk', 3))
  })

  it('recalcula só o que tem sufixo, é idempotente e acompanha os vínculos manuais', async () => {
    const d = await novo()
    await d.exec(`
      insert into auth.users values ('${A}'), ('${B}');
      insert into series (id, user_id, nome, tipo, serie_chave) values
        ('aaaaaaaa-0000-0000-0000-000000000001', '${A}', 'Berserk', 'manga', 'berserk|manga'),
        ('aaaaaaaa-0000-0000-0000-000000000002', '${B}', 'Berserk Edição de Luxo', 'manga', 'berserk luxo|manga'),
        ('aaaaaaaa-0000-0000-0000-000000000003', '${B}', 'Batman Absolute', 'hq', 'batman absolute|hq');
      insert into itens (id, user_id, serie_id, titulo, numero_volume, tipo, estado, obra_chave) values
        ('bbbbbbbb-0000-0000-0000-000000000001', '${A}', 'aaaaaaaa-0000-0000-0000-000000000001', 'Berserk 3', 3, 'manga', 'comprado', 'berserk|3|manga'),
        ('bbbbbbbb-0000-0000-0000-000000000002', '${B}', 'aaaaaaaa-0000-0000-0000-000000000002', 'Berserk Luxo 3', 3, 'manga', 'comprado', 'berserk luxo|3|manga'),
        ('bbbbbbbb-0000-0000-0000-000000000003', '${B}', 'aaaaaaaa-0000-0000-0000-000000000003', 'Absolute', 1, 'hq', 'comprado', 'batman absolute|1|hq'),
        ('bbbbbbbb-0000-0000-0000-000000000004', '${B}', null, 'Maus Edição de Luxo', null, 'hq', 'comprado', 'maus luxo||hq'),
        ('bbbbbbbb-0000-0000-0000-000000000005', '${B}', null, 'Sem chave', null, 'hq', 'comprado', null);
      insert into obra_equivalencias (user_id, obra_chave, obra_chave_amigo) values
        ('${A}', 'berserk|3|manga', 'berserk luxo|3|manga'),
        ('${A}', 'berserk|3|manga', 'batman absolute|1|hq');
    `)
    await d.exec(migration)
    const chaves = async () =>
      (await d.query<{ id: string; obra_chave: string | null }>(`select right(id::text, 1) id, obra_chave from itens order by id`)).rows.map((r) => `${r.id}=${r.obra_chave}`)
    const esperado = ['1=berserk|3|manga', '2=berserk|3|manga', '3=batman absolute|1|hq', '4=maus||hq', '5=null']
    expect(await chaves()).toEqual(esperado)
    expect((await d.query<{ serie_chave: string }>(`select serie_chave from series order by nome`)).rows.map((r) => r.serie_chave)).toEqual(['batman absolute|hq', 'berserk|manga', 'berserk|manga'])
    // vínculo que virou "a mesma obra" some; o outro permanece
    expect((await d.query<{ obra_chave_amigo: string }>(`select obra_chave_amigo from obra_equivalencias`)).rows).toEqual([{ obra_chave_amigo: 'batman absolute|1|hq' }])
    await d.exec(migration) // idempotente
    expect(await chaves()).toEqual(esperado)
    await d.close()
  }, 60_000)
})

describe('ranking dos amigos (migration 0023)', () => {
  // Ana (U) é a visitante. Amigos com escopo de notas: Beto, Carla, Edu, Fabi. Gui é amigo SEM `notas_criticas`,
  // Dora é ex-amiga e Caio nunca foi amigo: nenhum dos três pode aparecer nem pesar na média.
  const ID = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`
  const BETO = OUTRO
  const CARLA = ID(2)
  const EDU = ID(3)
  const FABI = ID(4)
  const GUI = ID(5)
  const DORA = ID(6)
  const CAIO = ID(7)
  const como = async <T,>(uid: string, fn: () => Promise<T>): Promise<T> => {
    await db.query(`select set_config('app.uid','${uid}',false)`)
    try {
      return await fn()
    } finally {
      await db.query(`select set_config('app.uid','${U}',false)`)
    }
  }
  const admin = async (sql: string) => {
    await db.query(`reset role`)
    try {
      await db.exec(sql)
    } finally {
      await db.query(`set role authenticated`)
    }
  }
  const salvar = async (extra: object) =>
    (await db.query<{ id: string }>(`select item_salvar(null, $1::jsonb, '{}') id`, [JSON.stringify({ titulo: 'x', tipo: 'hq', estado: 'lido', prioridade: 0, ...extra })])).rows[0].id
  type Linha = Record<string, unknown>
  const rank = async (args: { tipo?: string | null; desde?: string | null; ate?: string | null; ordem?: string; soNaoLidos?: boolean; limite?: number; offset?: number } = {}) =>
    (await db.query<Linha>(`select * from ranking_amigos($1, $2, $3, $4, $5, $6, $7)`, [args.tipo ?? null, args.desde ?? null, args.ate ?? null, args.ordem ?? 'nota', args.soNaoLidos ?? false, args.limite ?? 30, args.offset ?? 0])).rows
  const titulos = (linhas: Linha[]) => linhas.map((l) => l.titulo)
  const erro = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      return null
    } catch (e) {
      return (e as Error).message
    }
  }
  const ISBN_A = '978-1-5067-1198-0'
  const ISBN_B = '9781506711980'

  beforeAll(async () => {
    await admin(`
      insert into auth.users values ('${CARLA}'), ('${EDU}'), ('${FABI}'), ('${GUI}'), ('${DORA}'), ('${CAIO}') on conflict do nothing;
      delete from obra_equivalencias; delete from amizades; delete from itens; delete from series; delete from perfis;
      insert into perfis(user_id, apelido, escopo_amigos) values
        ('${U}', 'ana', '{notas_criticas,lidos,colecao}'), ('${BETO}', 'beto', '{notas_criticas,lidos,colecao}'),
        ('${CARLA}', 'carla', '{notas_criticas,lidos,colecao}'), ('${EDU}', 'edu', '{notas_criticas,lidos,colecao}'),
        ('${FABI}', 'fabi', '{notas_criticas,lidos,colecao}'), ('${GUI}', 'gui', '{lidos,colecao}'),
        ('${DORA}', 'dora', '{notas_criticas,lidos,colecao}'), ('${CAIO}', 'caio', '{notas_criticas,lidos,colecao}');
    `)
    const amizades: string[] = []
    for (const uid of [BETO, CARLA, EDU, FABI, GUI, DORA]) {
      const id = await como(uid, async () => (await db.query<{ id: string }>(`select amizade_solicitar('ana') id`)).rows[0].id)
      await db.query(`select amizade_responder($1, true)`, [id])
      amizades.push(id)
    }
    // Notas visíveis: 10, soma 35 -> C = 3,5 (o exemplo do estudo: n=1 5★ -> 4,25; n=4 média 4,75 -> 4,50).
    const obra = (titulo: string, chave: string, nota: number, lido_em: string, extra: object = {}) => ({ titulo, obra_chave: chave, nota, lido_em, ...extra })
    await como(BETO, async () => {
      await salvar(obra('Obra X', 'obra x|1|hq', 5, '2026-02-10'))
      const y = await salvar(obra('Obra Y', 'obra y|1|hq', 5, '2025-06-01', { critica: 'ótima', critica_privada: true }))
      await salvar(obra('Obra Y capa alternativa', 'obra y|1|hq', 5, '2025-06-01', { variante_de: y }))
      await salvar(obra('Obra Z', 'obra z|1|hq', 2, '2025-12-01'))
    })
    await como(CARLA, async () => {
      await salvar(obra('Obra Y', 'obra y|1|hq', 5, '2025-06-02'))
      await salvar(obra('Obra W', 'obra w|1|manga', 1, '2026-03-01', { tipo: 'manga' }))
      await salvar(obra('Batman Absolute 1', 'batman absolute|1|hq', 3, '2024-01-10', { isbn: ISBN_A }))
    })
    await como(EDU, async () => {
      await salvar(obra('Obra Y', 'obra y|1|hq', 5, '2025-06-03'))
      await salvar(obra('Obra V', 'obra v|1|hq', 1, '2026-05-01'))
      await salvar(obra('Absolute Batman 1', 'absolute batman|1|hq', 4, '2024-01-20', { isbn: ISBN_B }))
    })
    await como(FABI, () => salvar(obra('Obra Y', 'obra y|1|hq', 4, '2025-06-04')))
    // Quem não pode contar: sem escopo de notas (Gui), ex-amiga (Dora) e desconhecido (Caio).
    await como(GUI, () => salvar(obra('Obra X', 'obra x|1|hq', 1, '2026-02-11')))
    await como(DORA, () => salvar(obra('Obra X', 'obra x|1|hq', 1, '2026-02-12')))
    await como(CAIO, () => salvar(obra('Obra Y', 'obra y|1|hq', 1, '2025-06-05')))
    await admin(`delete from amizades where id = '${amizades[5]}'`) // Dora vira ex-amiga
    // Ana: leu Z (nota 4), só comprou Y, e leu o Batman por outro nome (mesmo ISBN).
    await salvar(obra('Obra Z', 'obra z|1|hq', 4, '2026-01-05'))
    await salvar({ titulo: 'Obra Y', obra_chave: 'obra y|1|hq', estado: 'comprado' })
    await salvar(obra('Batman Absolute Omnibus', 'batman absolute omnibus|1|hq', 5, '2026-01-06', { isbn: ISBN_B }))
  }, 60_000)

  it('exemplo do estudo: 1 voto 5★ (4,25) fica atrás de 4 votos média 4,75 (4,50); só amigos aceitos com escopo contam', async () => {
    const r = await rank()
    expect(titulos(r)).toEqual(['Obra Y', 'Obra X', 'Absolute Batman 1', 'Obra Z', 'Obra V', 'Obra W'])
    const y = r[0]
    expect([Number(y.n), Number(y.soma), Number(y.media), Number(y.score)]).toEqual([4, 19, 4.75, 4.5])
    const x = r[1]
    expect([Number(x.n), Number(x.soma), Number(x.media), Number(x.score)]).toEqual([1, 5, 5, 4.25]) // Gui, Dora e Caio fora
    expect(r.every((l) => Number(l.total) === 6)).toBe(true)
  })

  it('o escopo e a amizade valem na hora: dar escopo ao Gui o inclui (e muda C); desligar volta', async () => {
    await admin(`update perfis set escopo_amigos = '{notas_criticas,lidos}' where user_id = '${GUI}'`)
    const com = (await rank()).find((l) => l.titulo === 'Obra X')!
    expect(Number(com.n)).toBe(2)
    await admin(`update perfis set escopo_amigos = '{lidos,colecao}' where user_id = '${GUI}'`)
    expect(Number((await rank()).find((l) => l.titulo === 'Obra X')!.n)).toBe(1)
    await como(CAIO, async () => expect(await rank()).toEqual([])) // sem amigos, nada
  })

  it('o mesmo ISBN com chaves diferentes é uma linha só (raiz = menor chave); variante conta uma vez', async () => {
    const bat = (await rank()).filter((l) => String(l.titulo).includes('Batman'))
    expect(bat).toHaveLength(1)
    expect(bat[0].obra_chave).toBe('absolute batman|1|hq')
    expect(bat[0].isbn).toBe('9781506711980')
    expect([Number(bat[0].n), Number(bat[0].media)]).toEqual([2, 3.5])
    // a variante do Beto em Y não somou: Y tem os 4 amigos, não 5
    expect(Number((await rank()).find((l) => l.titulo === 'Obra Y')!.n)).toBe(4)
    // avatares: no máximo 3, com apelido
    const avatares = (await rank())[0].avatares as { apelido: string }[]
    expect(avatares).toHaveLength(3)
    expect(avatares.every((a) => typeof a.apelido === 'string')).toBe(true)
  })

  it('sua nota fica fora da média e vem à parte; o ISBN também acha o seu item', async () => {
    const r = await rank()
    const z = r.find((l) => l.titulo === 'Obra Z')!
    expect(Number(z.minha_nota)).toBe(4)
    expect(Number(z.media)).toBe(2) // a sua nota não entra
    expect(z.meu_item_id).not.toBeNull()
    const bat = r.find((l) => l.titulo === 'Absolute Batman 1')!
    expect(Number(bat.minha_nota)).toBe(5)
    expect(Number(bat.media)).toBe(3.5)
    const y = r.find((l) => l.titulo === 'Obra Y')!
    expect(y.meu_item_id).not.toBeNull() // só comprou: tem o item, sem nota
    expect(y.minha_nota).toBeNull()
    expect(r.find((l) => l.titulo === 'Obra X')!.meu_item_id).toBeNull()
  })

  it('"só os que eu não li" tira o que você já leu, mantém o que você só comprou', async () => {
    const r = await rank({ soNaoLidos: true })
    expect(titulos(r)).toEqual(['Obra Y', 'Obra X', 'Obra V', 'Obra W'])
    expect(Number(r[0].total)).toBe(4)
  })

  it('ordens: mais lidos, média simples e mais recentes; desempate por votos, média, leitura e título', async () => {
    expect(titulos(await rank({ ordem: 'lidos' }))).toEqual(['Obra Y', 'Absolute Batman 1', 'Obra X', 'Obra Z', 'Obra V', 'Obra W'])
    expect(titulos(await rank({ ordem: 'media' }))).toEqual(['Obra X', 'Obra Y', 'Absolute Batman 1', 'Obra Z', 'Obra V', 'Obra W'])
    expect(titulos(await rank({ ordem: 'recentes' }))).toEqual(['Obra V', 'Obra W', 'Obra X', 'Obra Z', 'Obra Y', 'Absolute Batman 1'])
    // V e W têm score, votos e média iguais: a leitura mais recente (V) vence; igualando as datas, o título decide
    const nota = await rank()
    expect(Number(nota[4].score)).toBe(Number(nota[5].score))
    await admin(`update itens set lido_em = '2026-05-01' where titulo = 'Obra W'`)
    expect(titulos(await rank()).slice(-2)).toEqual(['Obra V', 'Obra W'])
    await admin(`update itens set lido_em = '2026-03-01' where titulo = 'Obra W' and user_id = '${CARLA}'`)
  })

  it('mais votos desempata scores iguais antes da média', async () => {
    // BAT (n=2, score 3,5) vs. um item com n=1 e score 3,5: nota 3,5 de 1 voto também dá (3,5+3,5)/2 = 3,5
    await como(FABI, () => salvar({ titulo: 'Obra T', obra_chave: 'obra t|1|hq', nota: 3.5, lido_em: '2026-06-01' }))
    const r = await rank()
    const posT = titulos(r).indexOf('Obra T')
    expect(Number(r[posT].score)).toBe(Number(r[titulos(r).indexOf('Absolute Batman 1')].score))
    expect(posT).toBeGreaterThan(titulos(r).indexOf('Absolute Batman 1')) // n=2 antes de n=1
    await admin(`delete from itens where titulo = 'Obra T'`)
  })

  it('filtros: tipo e período (data de leitura do amigo)', async () => {
    expect(titulos(await rank({ tipo: 'manga' }))).toEqual(['Obra W'])
    expect(titulos(await rank({ tipo: 'hq' }))).not.toContain('Obra W')
    expect(titulos(await rank({ desde: '2026-01-01', ate: '2026-12-31' }))).toEqual(['Obra X', 'Obra V', 'Obra W'])
    const so2025 = await rank({ desde: '2025-01-01', ate: '2025-12-31' })
    expect(titulos(so2025)).toEqual(['Obra Y', 'Obra Z'])
    expect(Number(so2025[0].n)).toBe(4)
    expect(await rank({ desde: '2030-01-01', ate: '2030-12-31' })).toEqual([])
  })

  it('crítica não existe na resposta; privada ou não, só a nota conta; sem escopo o amigo some', async () => {
    const colunas = Object.keys((await rank())[0])
    expect(colunas).not.toContain('critica')
    expect(Number((await rank()).find((l) => l.titulo === 'Obra Y')!.n)).toBe(4) // a crítica de Beto em Y é privada
    await admin(`update perfis set escopo_amigos = '{lidos}' where user_id = '${BETO}'`)
    const sem = await rank()
    expect(titulos(sem)).not.toContain('Obra X')
    expect(Number(sem.find((l) => l.titulo === 'Obra Y')!.n)).toBe(3)
    await admin(`update perfis set escopo_amigos = '{notas_criticas,lidos,colecao}' where user_id = '${BETO}'`)
    expect(Number((await rank()).find((l) => l.titulo === 'Obra Y')!.n)).toBe(4)
  })

  it('sem a data de leitura visível (escopo sem "lidos") a nota só entra em "sempre"', async () => {
    await admin(`update perfis set escopo_amigos = '{notas_criticas}' where user_id = '${FABI}'`)
    expect(Number((await rank()).find((l) => l.titulo === 'Obra Y')!.n)).toBe(4)
    expect(Number((await rank({ desde: '2025-01-01', ate: '2025-12-31' })).find((l) => l.titulo === 'Obra Y')!.n)).toBe(3)
    await admin(`update perfis set escopo_amigos = '{notas_criticas,lidos,colecao}' where user_id = '${FABI}'`)
  })

  it('vínculo manual só vale na sua visão: acha o SEU item, sem juntar notas', async () => {
    await salvar({ titulo: 'Outro nome', obra_chave: 'outro nome|9|hq', nota: 3, estado: 'lido', lido_em: '2026-02-02' })
    await db.query(`select obra_equivalencia_criar('outro nome|9|hq', 'obra v|1|hq')`)
    const v = (await rank()).find((l) => l.titulo === 'Obra V')!
    expect(Number(v.minha_nota)).toBe(3)
    expect(Number(v.n)).toBe(1)
    expect(titulos(await rank({ soNaoLidos: true }))).not.toContain('Obra V')
    await admin(`delete from obra_equivalencias; delete from itens where obra_chave = 'outro nome|9|hq'`)
  })

  it('paginação: limite, deslocamento e total', async () => {
    const p1 = await rank({ limite: 2 })
    expect(titulos(p1)).toEqual(['Obra Y', 'Obra X'])
    expect(Number(p1[0].total)).toBe(6)
    expect(titulos(await rank({ limite: 2, offset: 2 }))).toEqual(['Absolute Batman 1', 'Obra Z'])
    expect(await rank({ limite: 2, offset: 10 })).toEqual([])
  })

  it('capa: do catálogo público sempre; privada só se o feed já mostra o item a você', async () => {
    const hash = 'a'.repeat(64)
    await admin(`update itens set capa_url = 'pub/${hash}.jpg' where titulo = 'Obra X' and user_id = '${BETO}'`)
    await admin(`update itens set capa_url = '${CARLA}/privada.jpg' where titulo = 'Obra W' and user_id = '${CARLA}'`)
    let r = await rank()
    expect(r.find((l) => l.titulo === 'Obra X')!.capa_publica).toBe(`pub/${hash}.jpg`)
    expect(r.find((l) => l.titulo === 'Obra W')!.capa_item_id).toBeNull() // feed da Carla desligado
    await como(CARLA, () => db.query(`select feed_configurar(true)`))
    await admin(`update itens set lido_marcado_em = now() where titulo = 'Obra W'`)
    r = await rank()
    expect(r.find((l) => l.titulo === 'Obra W')!.capa_item_id).not.toBeNull()
    expect(r.find((l) => l.titulo === 'Obra W')!.capa_publica).toBeNull()
  })

  it('estado para as telas vazias, login obrigatório e parâmetros inválidos', async () => {
    const e = (await db.query<{ amigos: number; amigos_com_notas: number }>(`select * from ranking_amigos_estado()`)).rows[0]
    expect([Number(e.amigos), Number(e.amigos_com_notas)]).toEqual([5, 4]) // Beto, Carla, Edu, Fabi, Gui; Gui sem escopo
    await como(CAIO, async () => {
      const c = (await db.query<{ amigos: number; amigos_com_notas: number }>(`select * from ranking_amigos_estado()`)).rows[0]
      expect([Number(c.amigos), Number(c.amigos_com_notas)]).toEqual([0, 0])
    })
    expect(await erro(() => rank({ ordem: 'qualquer' }))).toMatch(/ordem_invalida/)
    expect(await erro(() => rank({ tipo: 'livro' }))).toMatch(/tipo_invalido/)
    await db.query(`select set_config('app.uid','',false)`)
    expect(await erro(() => rank())).toMatch(/nao_autenticado/)
    await db.query(`select set_config('app.uid','${U}',false)`)
  })

  it('migration: funções exigem login e a camada interna fica fechada', () => {
    const sql = readFileSync(path.join(PASTA, '0023_ranking_amigos.sql'), 'utf8')
    expect(sql).toMatch(/revoke all on all functions in schema privado/)
    for (const f of ['ranking_amigos(text, date, date, text, boolean, int, int)', 'ranking_amigos_estado()']) {
      expect(sql).toContain(`revoke all on function ${f} from public, anon;`)
      expect(sql).toContain(`grant execute on function ${f} to authenticated;`)
    }
  })
})

describe('spoiler na crítica (migration 0024)', () => {
  // Dono (Ana, U), amigo (Beto) e desconhecido (Caio). Beto escreve; Ana e o link público leem.
  const CAIO = '88888888-8888-8888-8888-888888888888'
  const CHAVE = 'akira|1|manga'
  const como = async <T,>(uid: string, fn: () => Promise<T>): Promise<T> => {
    await db.query(`select set_config('app.uid','${uid}',false)`)
    try {
      return await fn()
    } finally {
      await db.query(`select set_config('app.uid','${U}',false)`)
    }
  }
  const admin = async (sql: string) => {
    await db.query(`reset role`)
    try {
      await db.exec(sql)
    } finally {
      await db.query(`set role authenticated`)
    }
  }
  const salvar = async (extra: object, id: string | null = null) =>
    (await db.query<{ id: string }>(`select item_salvar($1, $2::jsonb, '{}') id`, [id, JSON.stringify({ titulo: 'Akira 1', tipo: 'manga', estado: 'lido', prioridade: 0, obra_chave: CHAVE, ...extra })])).rows[0].id
  const spoilerDe = async (id: string) => (await db.query<{ s: boolean }>(`select critica_spoiler s from itens where id = $1`, [id])).rows[0].s
  const obra = async () => (await db.query<Record<string, unknown>>(`select * from obra_amigos($1)`, [CHAVE])).rows
  const feed = async () => (await db.query<Record<string, unknown>>(`select * from feed_listar()`)).rows

  let itemBeto = ''
  beforeAll(async () => {
    await admin(`
      insert into auth.users values ('${CAIO}') on conflict do nothing;
      delete from compartilhamentos; delete from amizades; delete from itens; delete from series; delete from perfis;
      insert into perfis(user_id, apelido, escopo_amigos, feed_ativo) values
        ('${U}', 'ana', '{notas_criticas,lidos}', true), ('${OUTRO}', 'beto', '{notas_criticas,lidos,colecao}', true),
        ('${CAIO}', 'caio', '{notas_criticas,lidos}', true);
    `)
    const id = (await como(OUTRO, () => db.query<{ id: string }>(`select amizade_solicitar('ana') id`))).rows[0].id
    await db.query(`select amizade_responder($1, true)`, [id])
  })

  it('a coluna nasce falsa: item e variante sem a chave não viram spoiler', async () => {
    const id = await salvar({ nota: 4, critica: 'normal' })
    expect(await spoilerDe(id)).toBe(false)
    const col = (await db.query<{ is_nullable: string; column_default: string }>(`select is_nullable, column_default from information_schema.columns where table_name = 'itens' and column_name = 'critica_spoiler'`)).rows[0]
    expect(col.is_nullable).toBe('NO')
    expect(col.column_default).toBe('false')
    await admin(`delete from itens where user_id = '${U}'`)
  })

  it('marcar e desmarcar persiste; chave ausente na edição mantém o valor', async () => {
    const id = await salvar({ nota: 4, critica: 'o final é triste', critica_spoiler: true })
    expect(await spoilerDe(id)).toBe(true)
    await salvar({ nota: 4, critica: 'o final é triste (editada)' }, id) // sem a chave: mantém
    expect(await spoilerDe(id)).toBe(true)
    await salvar({ nota: 4, critica: 'o final é triste', critica_spoiler: false }, id)
    expect(await spoilerDe(id)).toBe(false)
    await admin(`delete from itens where user_id = '${U}'`)
  })

  it('variante compartilha o flag com o principal, nos dois sentidos', async () => {
    const principal = await salvar({ nota: 4, critica: 'x' })
    const variante = await salvar({ titulo: 'Akira 1 (capa B)', nota: 4, critica: 'x', variante_de: principal })
    await salvar({ nota: 4, critica: 'x', critica_spoiler: true }, principal)
    expect(await spoilerDe(variante)).toBe(true)
    await salvar({ titulo: 'Akira 1 (capa B)', nota: 4, critica: 'x', variante_de: principal, critica_spoiler: false }, variante)
    expect(await spoilerDe(principal)).toBe(false)
    // variante nova herda o flag do principal ao vincular
    await salvar({ nota: 4, critica: 'x', critica_spoiler: true }, principal)
    const terceira = await salvar({ titulo: 'Akira 1 (capa C)', estado: 'lido', variante_de: principal })
    expect(await spoilerDe(terceira)).toBe(true)
    await admin(`delete from itens where user_id = '${U}'`)
  })

  it('obra_amigos devolve o flag junto com a crítica; sem crítica ou com crítica privada, o flag não sai', async () => {
    const id = await como(OUTRO, () => salvar({ nota: 5, critica: 'quem morre no fim', critica_spoiler: true }))
    itemBeto = id
    let [r] = await obra()
    expect(r.critica).toBe('quem morre no fim')
    expect(r.critica_spoiler).toBe(true)
    await como(OUTRO, () => salvar({ nota: 5, critica: 'quem morre no fim', critica_spoiler: false }, id))
    ;[r] = await obra()
    expect(r.critica_spoiler).toBe(false)
    await como(OUTRO, () => salvar({ nota: 5, critica: 'quem morre no fim', critica_spoiler: true, critica_privada: true }, id))
    ;[r] = await obra()
    expect(r.critica).toBeNull()
    expect(r.critica_spoiler).toBe(false) // crítica privada nunca sai, nem o flag
    await como(OUTRO, () => salvar({ nota: 5, critica: null, critica_spoiler: true, critica_privada: false }, id))
    ;[r] = await obra()
    expect(r.critica).toBeNull()
    expect(r.critica_spoiler).toBe(false) // spoiler sem crítica não vira cartão vazio
    await como(OUTRO, () => salvar({ nota: 5, critica: 'quem morre no fim', critica_spoiler: true }, id))
  })

  it('desconhecido não vê nada (o flag não abre porta)', async () => {
    await como(CAIO, async () => expect(await obra()).toEqual([]))
  })

  it('feed: o amigo vê o flag; o dono também (a tela o mostra normal com selo); escopo sem notas tira a crítica e o flag', async () => {
    const p = (await feed()).find((x) => x.item_id === itemBeto)!
    expect(p.critica).toBe('quem morre no fim')
    expect(p.critica_spoiler).toBe(true)
    expect(p.proprio).toBe(false)
    const meu = await como(OUTRO, async () => (await feed()).find((x) => x.item_id === itemBeto)!)
    expect(meu.proprio).toBe(true)
    expect(meu.critica_spoiler).toBe(true)
    await admin(`update perfis set escopo_amigos = '{lidos}' where user_id = '${OUTRO}'`)
    const sem = (await feed()).find((x) => x.item_id === itemBeto)!
    expect(sem.critica).toBeNull()
    expect(sem.critica_spoiler).toBe(false)
    await admin(`update perfis set escopo_amigos = '{notas_criticas,lidos,colecao}' where user_id = '${OUTRO}'`)
  })

  it('feed: crítica sem spoiler continua devolvendo falso', async () => {
    await como(OUTRO, () => salvar({ nota: 3, critica: 'gostei', titulo: 'Outro dia', obra_chave: 'outro|1|manga' }))
    const p = (await feed()).find((x) => x.titulo === 'Outro dia')!
    expect(p.critica).toBe('gostei')
    expect(p.critica_spoiler).toBe(false)
  })

  it('vitrine (amigo e link público): o flag acompanha a crítica; sem notas_criticas ou privada, não sai', async () => {
    const itensDoBeto = async () => (await db.query<Record<string, unknown>>(`select * from amigo_itens('beto', 'colecao')`)).rows
    const achar = async () => (await itensDoBeto()).find((x) => x.id === itemBeto)!
    expect((await achar()).critica_spoiler).toBe(true)
    expect((await achar()).critica).toBe('quem morre no fim')
    // link público do Beto
    const token = (await como(OUTRO, () => db.query<{ t: string }>(`select compartilhamento_gerar('{colecao,notas_criticas}'::text[]) t`))).rows[0].t
    const doLink = async () => (await db.query<Record<string, unknown>>(`select * from link_itens($1, 'colecao')`, [token])).rows.find((x) => x.id === itemBeto)!
    expect((await doLink()).critica_spoiler).toBe(true)
    // privada: some o texto e o flag
    await admin(`update itens set critica_privada = true where id = '${itemBeto}'`)
    expect((await doLink()).critica).toBeNull()
    expect((await doLink()).critica_spoiler).toBe(false)
    expect((await achar()).critica_spoiler).toBe(false)
    await admin(`update itens set critica_privada = false where id = '${itemBeto}'`)
    // link sem notas_criticas
    const tokenSem = (await como(OUTRO, () => db.query<{ t: string }>(`select compartilhamento_gerar('{colecao}'::text[]) t`))).rows[0].t
    const semNotas = (await db.query<Record<string, unknown>>(`select * from link_itens($1, 'colecao')`, [tokenSem])).rows.find((x) => x.id === itemBeto)!
    expect(semNotas.critica).toBeNull()
    expect(semNotas.critica_spoiler).toBe(false)
  })

  it('vitrine: crítica sem spoiler continua com o flag falso', async () => {
    const r = (await db.query<Record<string, unknown>>(`select * from amigo_itens('beto', 'colecao')`)).rows.find((x) => x.titulo === 'Outro dia')!
    expect(r.critica).toBe('gostei')
    expect(r.critica_spoiler).toBe(false)
  })

  it('migration: funções recriadas seguem fechadas para anônimo e a camada interna continua fechada', () => {
    const sql = readFileSync(path.join(PASTA, '0024_spoiler_na_critica.sql'), 'utf8')
    expect(sql).toMatch(/revoke all on all functions in schema privado/)
    for (const f of ['item_salvar(uuid, jsonb, uuid[])', 'obra_amigos(text, text)', 'feed_listar(int, timestamptz)']) {
      expect(sql).toContain(`revoke all on function ${f} from public, anon;`)
      expect(sql).toContain(`grant execute on function ${f} to authenticated;`)
    }
  })
})

describe('releitura e diário (migration 0025)', () => {
  // Ana (U) é a dona; Beto (OUTRO) é amigo dela; Caio não é amigo de ninguém.
  const CAIO = '77777777-7777-7777-7777-777777777777'
  const como = async <T,>(uid: string, fn: () => Promise<T>): Promise<T> => {
    await db.query(`select set_config('app.uid','${uid}',false)`)
    try {
      return await fn()
    } finally {
      await db.query(`select set_config('app.uid','${U}',false)`)
    }
  }
  const admin = async (sql: string) => {
    await db.query(`reset role`)
    try {
      await db.exec(sql)
    } finally {
      await db.query(`set role authenticated`)
    }
  }
  const salvar = async (extra: object, id: string | null = null) =>
    (await db.query<{ id: string }>(`select item_salvar($1, $2::jsonb, '{}') id`, [id, JSON.stringify({ titulo: 'Berserk 1', tipo: 'manga', estado: 'lido', prioridade: 0, ...extra })])).rows[0].id
  const leituras = async (item: string) =>
    (await db.query<{ id: string; lido_em: string; releitura: boolean }>(`select id, lido_em::text, releitura from leituras where item_id = $1 order by lido_em, criado_em, id`, [item])).rows
  const datas = async (item: string) => (await leituras(item)).map((l) => l.lido_em)
  const lidoEm = async (item: string) => (await db.query<{ d: string | null }>(`select lido_em::text d from itens where id = $1`, [item])).rows[0].d
  const adicionar = async (item: string, data: string) =>
    (await db.query<{ id: string }>(`insert into leituras(item_id, user_id, lido_em) values ($1, $2, $3) returning id`, [item, U, data])).rows[0].id
  const feed = async () => (await db.query<Record<string, unknown>>(`select *, lido_em::text as lido_txt from feed_listar()`)).rows

  beforeAll(async () => {
    await admin(`
      insert into auth.users values ('${CAIO}') on conflict do nothing;
      delete from compartilhamentos; delete from amizades; delete from itens; delete from series; delete from perfis;
      insert into perfis(user_id, apelido, escopo_amigos, feed_ativo) values
        ('${U}', 'ana', '{notas_criticas,lidos}', true), ('${OUTRO}', 'beto', '{notas_criticas,lidos}', true),
        ('${CAIO}', 'caio', '{notas_criticas,lidos}', true);
    `)
    const id = (await como(OUTRO, () => db.query<{ id: string }>(`select amizade_solicitar('ana') id`))).rows[0].id
    await db.query(`select amizade_responder($1, true)`, [id])
  })

  it('backfill: copia o lido_em de cada item lido com data, sem duplicar variante nem inventar data', async () => {
    // Recria o estado "antes da 0025": itens lidos sem nenhuma leitura, e roda o mesmo INSERT do backfill.
    await admin(`
      alter table itens disable trigger trg_itens_leituras;
      alter table itens disable trigger trg_itens_lido_em;
      insert into itens(id, user_id, titulo, estado, lido_em) values
        ('a0000000-0000-0000-0000-000000000001', '${U}', 'Velho 1', 'lido', '2025-03-10'),
        ('a0000000-0000-0000-0000-000000000002', '${U}', 'Velho sem data', 'lido', null),
        ('a0000000-0000-0000-0000-000000000003', '${U}', 'So comprado', 'comprado', null);
      insert into itens(id, user_id, titulo, estado, lido_em, variante_de) values
        ('a0000000-0000-0000-0000-000000000004', '${U}', 'Velho 1 luxo', 'lido', '2025-03-10', 'a0000000-0000-0000-0000-000000000001');
      alter table itens enable trigger trg_itens_leituras;
      alter table itens enable trigger trg_itens_lido_em;
      insert into leituras (item_id, user_id, lido_em, criado_em)
      select i.id, i.user_id, i.lido_em, coalesce(i.lido_marcado_em, i.updated_at, now())
        from itens i
       where i.estado = 'lido' and i.lido_em is not null
         and i.id::text like 'a0000000%'
         and (i.variante_de is null
              or not exists (select 1 from itens p where p.id = i.variante_de and p.estado <> 'desejo'));
    `)
    expect(await datas('a0000000-0000-0000-0000-000000000001')).toEqual(['2025-03-10'])
    expect(await datas('a0000000-0000-0000-0000-000000000002')).toEqual([])
    expect(await datas('a0000000-0000-0000-0000-000000000003')).toEqual([])
    expect(await datas('a0000000-0000-0000-0000-000000000004')).toEqual([])
    // O texto do backfill na migration é o que acabou de rodar (mesma regra).
    const sql = readFileSync(path.join(PASTA, '0025_releitura_e_diario.sql'), 'utf8')
    expect(sql).toMatch(/insert into leituras \(item_id, user_id, lido_em, criado_em\)\s+select i\.id, i\.user_id, i\.lido_em/)
    expect((await db.query(`select 1 from leituras where releitura`)).rows).toHaveLength(0)
  })

  it('marcar como lido (item_salvar) cria a leitura com a data; sem data usa hoje; sair de lido apaga', async () => {
    const id = await salvar({ lido_em: '2026-01-05' })
    expect(await datas(id)).toEqual(['2026-01-05'])
    expect((await leituras(id))[0].releitura).toBe(false)
    const sp = await salvar({ titulo: 'Hoje', lido_em: null })
    const hoje = (await db.query<{ d: string }>(`select (now() at time zone 'America/Sao_Paulo')::date::text d`)).rows[0].d
    expect(await datas(sp)).toEqual([hoje])
    await salvar({ estado: 'comprado' }, id)
    expect(await datas(id)).toEqual([])
    expect(await lidoEm(id)).toBeNull()
  })

  it('editar o lido_em do item muda só a leitura mais recente', async () => {
    const id = await salvar({ titulo: 'Edita', lido_em: '2026-02-01' })
    await adicionar(id, '2026-06-01')
    expect(await lidoEm(id)).toBe('2026-06-01')
    await salvar({ titulo: 'Edita', lido_em: '2026-07-15' }, id)
    expect(await datas(id)).toEqual(['2026-02-01', '2026-07-15'])
    expect(await lidoEm(id)).toBe('2026-07-15')
  })

  it('itens.lido_em segue a leitura mais recente: adicionar, editar e remover', async () => {
    const id = await salvar({ titulo: 'Segue', lido_em: '2026-03-01' })
    const nova = await adicionar(id, '2026-09-01')
    expect(await lidoEm(id)).toBe('2026-09-01')
    // uma leitura antiga não muda a mais recente
    await adicionar(id, '2026-01-01')
    expect(await lidoEm(id)).toBe('2026-09-01')
    await db.query(`update leituras set lido_em = '2026-04-01' where id = $1`, [nova])
    expect(await lidoEm(id)).toBe('2026-04-01')
    await db.query(`delete from leituras where id = $1`, [nova])
    expect(await lidoEm(id)).toBe('2026-03-01')
    // apagar todas deixa o item lido, sem data
    await db.query(`delete from leituras where item_id = $1`, [id])
    expect(await lidoEm(id)).toBeNull()
    expect((await db.query<{ estado: string }>(`select estado from itens where id = $1`, [id])).rows[0].estado).toBe('lido')
  })

  it('releitura: a primeira leitura não é releitura, as seguintes são', async () => {
    const id = await salvar({ titulo: 'Rele', lido_em: '2026-01-10' })
    await adicionar(id, '2026-05-10')
    await adicionar(id, '2026-08-10')
    expect((await leituras(id)).map((l) => l.releitura)).toEqual([false, true, true])
  })

  it('variante: não tem leitura própria, herda a data do principal e vincular apaga as dela', async () => {
    const principal = await salvar({ titulo: 'Principal', lido_em: '2026-02-02' })
    const variante = await salvar({ titulo: 'Principal luxo', lido_em: '2026-02-02', variante_de: principal })
    expect(await datas(variante)).toEqual([])
    await adicionar(principal, '2026-10-10')
    expect(await lidoEm(principal)).toBe('2026-10-10')
    expect(await lidoEm(variante)).toBe('2026-10-10')
    await expect(adicionar(variante, '2026-11-01')).rejects.toThrow('leitura_em_variante')
    // item que tinha leituras e vira variante perde as dele
    const solto = await salvar({ titulo: 'Solto', lido_em: '2026-03-03' })
    expect(await datas(solto)).toEqual(['2026-03-03'])
    await salvar({ titulo: 'Solto', lido_em: '2026-03-03', variante_de: principal }, solto)
    expect(await datas(solto)).toEqual([])
  })

  it('só item lido e do próprio usuário recebe leitura', async () => {
    const comprado = await salvar({ titulo: 'Comprado', estado: 'comprado' })
    await expect(adicionar(comprado, '2026-01-01')).rejects.toThrow('item_nao_lido')
    await expect(adicionar('12345678-1234-1234-1234-123456789012', '2026-01-01')).rejects.toThrow('item_nao_encontrado')
  })

  it('RLS: cada pessoa vê e mexe só nas próprias leituras', async () => {
    const id = await salvar({ titulo: 'Privada', lido_em: '2026-04-04' })
    const antes = await datas(id)
    expect(antes).toEqual(['2026-04-04'])
    await como(OUTRO, async () => {
      expect(await datas(id)).toEqual([])
      // não consegue ler, editar, apagar nem criar leitura em item alheio
      expect((await db.query(`update leituras set lido_em = '2000-01-01' where item_id = $1 returning id`, [id])).rows).toHaveLength(0)
      expect((await db.query(`delete from leituras where item_id = $1 returning id`, [id])).rows).toHaveLength(0)
      await expect(db.query(`insert into leituras(item_id, user_id, lido_em) values ($1, $2, '2026-04-05')`, [id, OUTRO])).rejects.toThrow('item_nao_encontrado')
      await expect(db.query(`insert into leituras(item_id, user_id, lido_em) values ($1, $2, '2026-04-05')`, [id, U])).rejects.toThrow()
    })
    expect(await datas(id)).toEqual(['2026-04-04'])
  })

  it('apagar o item apaga as leituras; anônimo não lê a tabela', async () => {
    const id = await salvar({ titulo: 'Some', lido_em: '2026-04-04' })
    await db.query(`delete from itens where id = $1`, [id])
    expect((await db.query(`select 1 from leituras where item_id = $1`, [id])).rows).toHaveLength(0)
    await admin(`select 1`)
    expect((await db.query<{ p: boolean }>(`select has_table_privilege('anon', 'leituras', 'select') p`)).rows[0].p).toBe(false)
  })

  it('feed: a releitura vira "releu" para o amigo, uma vez por leitura, e a primeira continua "leu"', async () => {
    const id = await como(OUTRO, () => salvar({ titulo: 'Vinland 1', lido_em: '2026-05-01', nota: 4.5, critica: 'ótimo' }))
    const post = () => feed().then((r) => r.filter((x) => x.item_id === id))
    expect((await post()).map((p) => p.releitura)).toEqual([false])
    const rel = await como(OUTRO, async () => (await db.query<{ id: string }>(`insert into leituras(item_id, user_id, lido_em) values ($1, $2, '2026-11-10') returning id`, [id, OUTRO])).rows[0].id)
    const posts = await post()
    expect(posts).toHaveLength(2)
    const releu = posts.find((p) => p.releitura)!
    expect(releu.leitura_id).toBe(rel)
    expect(releu.lido_txt).toBe('2026-11-10')
    expect(releu.nota).toBe('4.5')
    expect(releu.critica).toBe('ótimo')
    expect(releu.proprio).toBe(false)
    expect(posts.find((p) => !p.releitura)!.leitura_id).toBeNull()
    // editar a data da leitura não cria outro post
    await como(OUTRO, () => db.query(`update leituras set lido_em = '2026-11-11' where id = $1`, [rel]))
    expect(await post()).toHaveLength(2)
    expect((await post()).find((p) => p.releitura)!.lido_txt).toBe('2026-11-11')
    // o dono também vê os dois
    expect((await como(OUTRO, post)).filter((p) => p.proprio)).toHaveLength(2)
    // remover a leitura tira o post
    await como(OUTRO, () => db.query(`delete from leituras where id = $1`, [rel]))
    expect((await post()).map((p) => p.releitura)).toEqual([false])
  })

  it('feed: respeita interruptor, amizade, item oculto, escopo, privada e spoiler', async () => {
    const id = await como(OUTRO, () => salvar({ titulo: 'Monster 1', lido_em: '2026-05-01', nota: 5, critica: 'fim', critica_spoiler: true }))
    await como(OUTRO, () => adicionar2(id))
    const releu = async (uid: string) => (await como(uid, feed)).filter((x) => x.item_id === id && x.releitura)
    expect(await releu(U)).toHaveLength(1)
    expect((await releu(U))[0].critica_spoiler).toBe(true)
    // desconhecido não vê
    expect(await releu(CAIO)).toHaveLength(0)
    // interruptor desligado
    await admin(`update perfis set feed_ativo = false where user_id = '${OUTRO}'`)
    expect(await releu(U)).toHaveLength(0)
    await admin(`update perfis set feed_ativo = true where user_id = '${OUTRO}'`)
    expect(await releu(U)).toHaveLength(1)
    // sem notas_criticas no escopo: nada de nota/crítica, mas o post existe
    await admin(`update perfis set escopo_amigos = '{lidos}' where user_id = '${OUTRO}'`)
    const sem = (await releu(U))[0]
    expect(sem.nota).toBeNull()
    expect(sem.critica).toBeNull()
    expect(sem.critica_spoiler).toBe(false)
    await admin(`update perfis set escopo_amigos = '{notas_criticas,lidos}' where user_id = '${OUTRO}'`)
    // crítica privada
    await admin(`update itens set critica_privada = true where id = '${id}'`)
    expect((await releu(U))[0].critica).toBeNull()
    await admin(`update itens set critica_privada = false where id = '${id}'`)
    // item oculto no feed some junto com o "releu"
    await como(OUTRO, () => db.query(`select feed_ocultar($1, true)`, [id]))
    expect(await releu(U)).toHaveLength(0)
    await como(OUTRO, () => db.query(`select feed_ocultar($1, false)`, [id]))
    expect(await releu(U)).toHaveLength(1)
    // desfazer a amizade corta
    await admin(`update amizades set status = 'pendente'`)
    expect(await releu(U)).toHaveLength(0)
    await admin(`update amizades set status = 'aceita'`)
  })

  it('feed: releitura de um volume lido há mais de 90 dias aparece e dá para curtir; leitura antiga não vira post', async () => {
    const id = await como(OUTRO, () => salvar({ titulo: 'Antigo', lido_em: '2025-01-01' }))
    await admin(`update itens set lido_marcado_em = now() - interval '200 days' where id = '${id}'`)
    expect((await feed()).filter((x) => x.item_id === id)).toHaveLength(0)
    await expect(db.query(`select feed_curtir($1)`, [id])).rejects.toThrow('item_nao_encontrado')
    await como(OUTRO, () => adicionar2(id))
    expect((await feed()).filter((x) => x.item_id === id)).toHaveLength(1)
    await db.query(`select feed_curtir($1)`, [id])
    // uma releitura registrada há 100 dias já saiu do feed
    await admin(`
      alter table leituras disable trigger trg_leituras_imutaveis;
      update leituras set criado_em = now() - interval '100 days' where item_id = '${id}' and releitura;
      alter table leituras enable trigger trg_leituras_imutaveis;
    `)
    expect((await feed()).filter((x) => x.item_id === id)).toHaveLength(0)
  })

  it('ranking dos amigos: o filtro de período olha a leitura mais recente (a releitura move o volume de período)', async () => {
    const id = await como(OUTRO, () => salvar({ titulo: 'Rank Rele', obra_chave: 'rank-rele|1|manga', nota: 4, lido_em: '2025-03-01' }))
    const rank = async (desde: string, ate: string) =>
      (await db.query<{ titulo: string }>(`select titulo from ranking_amigos(null, $1::date, $2::date)`, [desde, ate])).rows.map((r) => r.titulo)
    expect(await rank('2025-01-01', '2025-12-31')).toContain('Rank Rele')
    expect(await rank('2026-01-01', '2026-12-31')).not.toContain('Rank Rele')
    await como(OUTRO, () => db.query(`insert into leituras(item_id, user_id, lido_em) values ($1, $2, '2026-06-01')`, [id, OUTRO]))
    expect(await rank('2026-01-01', '2026-12-31')).toContain('Rank Rele')
    expect(await rank('2025-01-01', '2025-12-31')).not.toContain('Rank Rele')
  })

  it('migration: feed_listar segue fechada para anônimo, a tabela tem RLS e a camada interna continua fechada', () => {
    const sql = readFileSync(path.join(PASTA, '0025_releitura_e_diario.sql'), 'utf8')
    expect(sql).toMatch(/alter table leituras enable row level security/)
    expect(sql).toMatch(/revoke all on all functions in schema privado/)
    expect(sql).toContain('revoke all on function feed_listar(int, timestamptz) from public, anon;')
    expect(sql).toContain('grant execute on function feed_listar(int, timestamptz) to authenticated;')
  })

  async function adicionar2(id: string) {
    const uid = (await db.query<{ u: string }>(`select auth.uid()::text u`)).rows[0].u
    await db.query(`insert into leituras(item_id, user_id, lido_em) values ($1, $2, '2026-11-12')`, [id, uid])
  }
})

describe('séries favoritas (migration 0026)', () => {
  // Ana (U) é a dona; Beto (OUTRO) é amigo dela; Caio não é amigo de ninguém.
  const CAIO = '66666666-6666-6666-6666-666666666666'
  const como = async <T,>(uid: string, fn: () => Promise<T>): Promise<T> => {
    await db.query(`select set_config('app.uid','${uid}',false)`)
    try {
      return await fn()
    } finally {
      await db.query(`select set_config('app.uid','${U}',false)`)
    }
  }
  const admin = async (sql: string) => {
    await db.query(`reset role`)
    try {
      await db.exec(sql)
    } finally {
      await db.query(`set role authenticated`)
    }
  }
  const HASH = 'a'.repeat(64)
  const mkSerie = async (nome: string, opts: { estado?: string; capa?: string | null; uid?: string } = {}) => {
    const uid = opts.uid ?? U
    const { rows } = await db.query<{ id: string }>(`insert into series(user_id, nome, tipo) values ($1, $2, 'hq') returning id`, [uid, nome])
    if (opts.estado !== 'nenhum') {
      await db.query(`insert into itens(user_id, serie_id, titulo, numero_volume, estado, capa_url) values ($1, $2, $3, 1, $4, $5)`, [
        uid,
        rows[0].id,
        `${nome} 1`,
        opts.estado ?? 'comprado',
        opts.capa === undefined ? `pub/${HASH}.jpg` : opts.capa,
      ])
    }
    return rows[0].id
  }
  const salvar = (ids: string[]) => db.query(`select favoritos_series_salvar($1::uuid[])`, [ids])
  const meus = async () => (await db.query<{ nome: string; posicao: number }>(`select nome, posicao from favoritos_series_meus()`)).rows
  const doAmigo = async (apelido: string) =>
    (await db.query<{ id: string; nome: string; capa: string | null; posicao: number }>(`select * from amigo_favoritos_series($1)`, [apelido])).rows
  const s: string[] = []
  let amizade = ''

  beforeAll(async () => {
    await admin(`
      insert into auth.users values ('${CAIO}') on conflict do nothing;
      delete from compartilhamentos; delete from amizades; delete from itens; delete from series; delete from perfis;
      insert into perfis(user_id, apelido, escopo_amigos) values
        ('${U}', 'ana', '{series,colecao}'), ('${OUTRO}', 'beto', '{series}'), ('${CAIO}', 'caio', '{series}');
    `)
    amizade = (await como(OUTRO, () => db.query<{ id: string }>(`select amizade_solicitar('ana') id`))).rows[0].id
    await db.query(`select amizade_responder($1, true)`, [amizade])
    for (const nome of ['Berserk', 'Akira', 'Monster', 'Vagabond', 'Dragon Ball', 'Sem Volumes']) {
      s.push(await mkSerie(nome, nome === 'Sem Volumes' ? { estado: 'nenhum' } : {}))
    }
  })

  it('sem favoritos: nada aparece, para o dono nem para o amigo', async () => {
    expect(await meus()).toEqual([])
    await como(OUTRO, async () => expect(await doAmigo('ana')).toEqual([]))
  })

  it('escolhe, ordena e o amigo vê na mesma ordem, com o nome e a capa da vitrine', async () => {
    await salvar([s[2], s[0], s[1]])
    expect(await meus()).toEqual([
      { nome: 'Monster', posicao: 1 },
      { nome: 'Berserk', posicao: 2 },
      { nome: 'Akira', posicao: 3 },
    ])
    await como(OUTRO, async () => {
      const f = await doAmigo('ana')
      expect(f.map((x) => x.nome)).toEqual(['Monster', 'Berserk', 'Akira'])
      expect(f.map((x) => x.posicao)).toEqual([1, 2, 3])
      expect(f[0].capa).toBe(`pub/${HASH}.jpg`)
    })
  })

  it('reordenar e remover regrava a lista inteira numa operação só', async () => {
    await salvar([s[1], s[2], s[0]])
    expect((await meus()).map((x) => x.nome)).toEqual(['Akira', 'Monster', 'Berserk'])
    await salvar([s[0]])
    expect(await meus()).toEqual([{ nome: 'Berserk', posicao: 1 }])
    await salvar([])
    expect(await meus()).toEqual([])
  })

  it('o limite de 4 vale no banco: função, posição 5 e posição repetida são recusadas', async () => {
    await expect(salvar([s[0], s[1], s[2], s[3], s[4]])).rejects.toThrow('favoritos_limite')
    expect(await meus()).toEqual([])
    await salvar([s[0], s[1], s[2], s[3]])
    expect(await meus()).toHaveLength(4)
    // Inserção direta (RLS do dono): uma quinta série não cabe em nenhuma posição.
    await expect(db.query(`insert into favoritos_series(user_id, serie_id, posicao) values ($1, $2, 5)`, [U, s[4]])).rejects.toThrow()
    await expect(db.query(`insert into favoritos_series(user_id, serie_id, posicao) values ($1, $2, 4)`, [U, s[4]])).rejects.toThrow()
    await expect(db.query(`insert into favoritos_series(user_id, serie_id, posicao) values ($1, $2, 0)`, [U, s[4]])).rejects.toThrow()
    expect(await meus()).toHaveLength(4)
  })

  it('a mesma série não entra duas vezes', async () => {
    await expect(salvar([s[0], s[0]])).rejects.toThrow('favoritos_repetido')
    await expect(db.query(`insert into favoritos_series(user_id, serie_id, posicao) select $1, serie_id, 1 from favoritos_series where user_id = $1 limit 1`, [U])).rejects.toThrow()
  })

  it('trocar a ordem por update direto funciona (a posição é conferida no fim do comando)', async () => {
    await salvar([s[0], s[1]])
    await db.query(`update favoritos_series set posicao = case posicao when 1 then 2 else 1 end where user_id = $1`, [U])
    expect((await meus()).map((x) => x.nome)).toEqual(['Akira', 'Berserk'])
  })

  it('só séries da própria coleção: de outra pessoa ou inexistente é recusado', async () => {
    const doBeto = await como(OUTRO, () => mkSerieComo(OUTRO, 'Do Beto'))
    await expect(salvar([doBeto])).rejects.toThrow('serie_nao_encontrada')
    await expect(salvar(['33333333-3333-3333-3333-333333333333'])).rejects.toThrow('serie_nao_encontrada')
    await expect(db.query(`insert into favoritos_series(user_id, serie_id, posicao) values ($1, $2, 4)`, [U, doBeto])).rejects.toThrow('serie_nao_encontrada')
    // Nem pondo o user_id do Beto: a RLS do dono barra.
    await expect(db.query(`insert into favoritos_series(user_id, serie_id, posicao) values ($1, $2, 4)`, [OUTRO, doBeto])).rejects.toThrow()
    expect((await meus()).map((x) => x.nome)).toEqual(['Akira', 'Berserk'])
  })
  const mkSerieComo = (uid: string, nome: string) => mkSerie(nome, { uid })

  it('RLS do dono: ninguém lê nem altera os favoritos de outra pessoa pela tabela', async () => {
    await como(OUTRO, async () => {
      expect((await db.query(`select * from favoritos_series`)).rows).toHaveLength(0)
      expect((await meus())).toEqual([])
      await db.query(`delete from favoritos_series`)
      await db.query(`update favoritos_series set posicao = 3`)
    })
    expect(await meus()).toHaveLength(2)
    // O Beto salvando a lista dele não mexe na da Ana.
    await como(OUTRO, async () => {
      const b = await mkSerieComo(OUTRO, 'Outra do Beto')
      await salvar([b])
      expect((await meus()).map((x) => x.nome)).toEqual(['Outra do Beto'])
    })
    expect((await meus()).map((x) => x.nome)).toEqual(['Akira', 'Berserk'])
  })

  it('quem não é amigo (e quem só pediu) não vê; sem login também não', async () => {
    await como(CAIO, async () => expect(await doAmigo('ana')).toEqual([]))
    await como(CAIO, async () => {
      await db.query(`select amizade_solicitar('ana')`)
      expect(await doAmigo('ana')).toEqual([])
    })
    await admin(`delete from amizades where solicitante = '${CAIO}'`)
    await db.query(`select set_config('app.uid','',false)`)
    expect(await doAmigo('ana')).toEqual([])
    await db.query(`select set_config('app.uid','${U}',false)`)
    // A amizade vale nos dois sentidos: a Ana vê o que o Beto escolheu; a Caio, nada.
    expect((await doAmigo('beto')).map((x) => x.nome)).toEqual(['Outra do Beto'])
    await como(CAIO, async () => expect(await doAmigo('beto')).toEqual([]))
  })

  it('amizade desfeita: o acesso some na hora e volta se refizerem; os favoritos ficam guardados', async () => {
    await db.query(`select amizade_desfazer($1)`, [amizade])
    await como(OUTRO, async () => expect(await doAmigo('ana')).toEqual([]))
    expect(await meus()).toHaveLength(2)
    amizade = (await como(OUTRO, () => db.query<{ id: string }>(`select amizade_solicitar('ana') id`))).rows[0].id
    await db.query(`select amizade_responder($1, true)`, [amizade])
    await como(OUTRO, async () => expect((await doAmigo('ana')).map((x) => x.nome)).toEqual(['Akira', 'Berserk']))
  })

  it('o amigo só vê com a seção "séries" liberada; sem ela, vazio', async () => {
    await admin(`update perfis set escopo_amigos = '{colecao,lidos}' where user_id = '${U}'`)
    await como(OUTRO, async () => expect(await doAmigo('ana')).toEqual([]))
    await admin(`update perfis set escopo_amigos = '{series}' where user_id = '${U}'`)
    await como(OUTRO, async () => expect(await doAmigo('ana')).toHaveLength(2))
  })

  it('série só com desejos some para o amigo, mas o dono continua vendo; capa privada sai sem a pasta do dono', async () => {
    const soDesejo = await mkSerie('Só Desejo', { estado: 'desejo' })
    const privada = await mkSerie('Capa Privada', { capa: `${U}/11111111-2222-3333-4444-555555555555-1700000000000.jpg` })
    await salvar([soDesejo, privada])
    expect((await meus()).map((x) => x.nome)).toEqual(['Só Desejo', 'Capa Privada'])
    await como(OUTRO, async () => {
      const f = await doAmigo('ana')
      expect(f.map((x) => x.nome)).toEqual(['Capa Privada'])
      expect(f[0].capa).toBe('11111111-2222-3333-4444-555555555555-1700000000000.jpg')
      expect(f[0].capa).not.toContain(U)
    })
  })

  it('série sem nenhum volume possuído (só criada) não aparece para o amigo', async () => {
    await salvar([s[5], s[0]])
    await como(OUTRO, async () => expect((await doAmigo('ana')).map((x) => x.nome)).toEqual(['Berserk']))
  })

  it('só nome, tipo e capa saem: nota e crítica da série nunca vazam', async () => {
    await db.query(`update series set nota = 5, critica = 'segredo', critica_privada = true where id = $1`, [s[0]])
    await como(OUTRO, async () => {
      const { rows } = await db.query<Record<string, unknown>>(`select * from amigo_favoritos_series('ana')`)
      expect(Object.keys(rows[0]).sort()).toEqual(['capa', 'id', 'nome', 'posicao', 'tipo'])
      expect(JSON.stringify(rows)).not.toContain('segredo')
    })
  })

  it('candidatas: só as minhas séries com volume possuído, em ordem alfabética, com a capa completa', async () => {
    const { rows } = await db.query<{ nome: string; capa: string | null }>(`select nome, capa from favoritos_series_candidatas()`)
    const nomes = rows.map((r) => r.nome)
    expect(nomes).toEqual([...nomes].sort((a, b) => a.localeCompare(b, 'pt', { sensitivity: 'base' })))
    expect(nomes).toContain('Berserk')
    expect(nomes).not.toContain('Sem Volumes')
    expect(nomes).not.toContain('Só Desejo')
    expect(nomes).not.toContain('Do Beto')
    expect(rows.find((r) => r.nome === 'Capa Privada')?.capa).toBe(`${U}/11111111-2222-3333-4444-555555555555-1700000000000.jpg`)
  })

  it('apagar a série tira dos favoritos', async () => {
    await salvar([s[0], s[1]])
    await db.query(`delete from series where id = $1`, [s[1]])
    expect((await meus()).map((x) => x.nome)).toEqual(['Berserk'])
  })
})

describe('listas curadas (migration 0028)', () => {
  // Ana (U) é a dona; Beto (OUTRO) é amigo dela; Caio não é amigo de ninguém.
  const CAIO = '66666666-6666-6666-6666-666666666666'
  const DANI = '77777777-7777-7777-7777-777777777777'
  const como = async <T,>(uid: string, fn: () => Promise<T>): Promise<T> => {
    await db.query(`select set_config('app.uid','${uid}',false)`)
    try {
      return await fn()
    } finally {
      await db.query(`select set_config('app.uid','${U}',false)`)
    }
  }
  const admin = async (sql: string) => {
    await db.query(`reset role`)
    try {
      await db.exec(sql)
    } finally {
      await db.query(`set role authenticated`)
    }
  }
  const HASH = 'b'.repeat(64)
  const mkItem = async (titulo: string, opts: { uid?: string; estado?: string; chave?: string | null; capa?: string | null; serie?: string; numero?: number } = {}) => {
    const uid = opts.uid ?? U
    const { rows } = await como(uid, () =>
      db.query<{ id: string }>(
        `insert into itens(user_id, serie_id, titulo, numero_volume, estado, obra_chave, capa_url) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [uid, opts.serie ?? null, titulo, opts.numero ?? null, opts.estado ?? 'comprado', opts.chave === undefined ? `chave:${titulo}` : opts.chave, opts.capa === undefined ? null : opts.capa]
      )
    )
    return rows[0].id
  }
  const criar = async (titulo = 'Minha lista', ordenada = false, tipo: string | null = null) =>
    (await db.query<{ id: string }>(`select lista_salvar(null, $1, null, $2, $3) id`, [titulo, ordenada, tipo])).rows[0].id
  const adicionar = async (lista: string, item: string, nota: string | null = null, spoiler = false) =>
    (await db.query<{ id: string }>(`select lista_item_adicionar($1, $2, $3, $4) id`, [lista, item, nota, spoiler])).rows[0].id
  const itensDe = async (lista: string) =>
    (await db.query<Record<string, unknown>>(`select * from lista_itens_listar($1)`, [lista])).rows
  const visiveis = async () => (await db.query<{ id: string; titulo: string; proprio: boolean }>(`select id, titulo, proprio from listas_listar(null)`)).rows
  const erro = async (sql: string, params: unknown[] = []) => {
    try {
      await db.query(sql, params)
    } catch (e) {
      return (e as Error).message
    }
    return null
  }
  let amizade = ''
  let serieId = ''

  beforeAll(async () => {
    await admin(`
      insert into auth.users values ('${CAIO}'), ('${DANI}') on conflict do nothing;
      delete from compartilhamentos; delete from amizades; delete from itens; delete from series; delete from perfis;
      insert into perfis(user_id, apelido) values ('${U}', 'ana'), ('${OUTRO}', 'beto'), ('${CAIO}', 'caio'), ('${DANI}', 'dani');
    `)
    amizade = (await como(OUTRO, () => db.query<{ id: string }>(`select amizade_solicitar('ana') id`))).rows[0].id
    await db.query(`select amizade_responder($1, true)`, [amizade])
    serieId = (await db.query<{ id: string }>(`insert into series(user_id, nome, tipo) values ($1, 'Batman Ano Um', 'hq') returning id`, [U])).rows[0].id
  })

  it('cria, edita e apaga a lista; só o dono mexe', async () => {
    const id = await criar('Ordem de leitura', true, 'ordem_leitura')
    expect((await visiveis()).map((l) => l.titulo)).toContain('Ordem de leitura')
    await db.query(`select lista_salvar($1, 'Ordem de leitura de Batman', 'Do começo', true, 'arco')`, [id])
    const { rows: [l] } = await db.query<{ titulo: string; descricao: string; tipo: string }>(`select titulo, descricao, tipo from listas where id = $1`, [id])
    expect(l).toEqual({ titulo: 'Ordem de leitura de Batman', descricao: 'Do começo', tipo: 'arco' })
    // outra pessoa (mesmo amiga) não edita nem apaga
    await como(OUTRO, async () => {
      expect(await erro(`select lista_salvar($1, 'Invadida', null, false, null)`, [id])).toContain('lista_nao_encontrada')
      expect(await erro(`select lista_apagar($1)`, [id])).toContain('lista_nao_encontrada')
    })
    await db.query(`select lista_apagar($1)`, [id])
    expect((await visiveis()).map((x) => x.id)).not.toContain(id)
  })

  it('valida título, descrição e tipo, e limita a 50 listas por pessoa', async () => {
    expect(await erro(`select lista_salvar(null, '   ', null, false, null)`)).toContain('lista_titulo_invalido')
    expect(await erro(`select lista_salvar(null, $1, null, false, null)`, ['x'.repeat(81)])).toContain('lista_titulo_invalido')
    expect(await erro(`select lista_salvar(null, 'A', $1, false, null)`, ['x'.repeat(501)])).toContain('lista_descricao_longa')
    expect(await erro(`select lista_salvar(null, 'A', null, false, 'publica')`)).toContain('lista_tipo_invalido')
    await admin(`delete from listas where user_id = '${CAIO}'`)
    await como(CAIO, async () => {
      for (let k = 0; k < 50; k++) await db.query(`select lista_salvar(null, $1, null, false, null)`, [`L${k}`])
      expect(await erro(`select lista_salvar(null, 'L50', null, false, null)`)).toContain('lista_limite')
    })
    await admin(`delete from listas where user_id = '${CAIO}'`)
  })

  it('o item guarda uma referência estável: chave, título, série, número, tipo e capa, copiados do item do dono', async () => {
    const lista = await criar('Referências')
    const item = await mkItem('Batman: Ano Um #1', { chave: 'batman-ano-um:1', serie: serieId, numero: 1, capa: `${U}/arquivo.jpg` })
    const id = await adicionar(lista, item)
    const [r] = await itensDe(lista)
    expect(r).toMatchObject({ id, posicao: 1, obra_chave: 'batman-ano-um:1', titulo: 'Batman: Ano Um #1', serie_nome: 'Batman Ano Um', tipo: 'hq', capa: 'arquivo.jpg' })
    expect(Number(r.numero_volume)).toBe(1)
    // apagar ou renomear o item da coleção não mexe na lista
    await db.query(`update itens set titulo = 'Outro nome', capa_url = null where id = $1`, [item])
    await db.query(`delete from itens where id = $1`, [item])
    const [depois] = await itensDe(lista)
    expect(depois).toMatchObject({ titulo: 'Batman: Ano Um #1', obra_chave: 'batman-ano-um:1', capa: 'arquivo.jpg' })
  })

  it('só item da própria coleção; repetido, lista cheia e nota longa são recusados', async () => {
    const lista = await criar('Regras de item')
    const meu = await mkItem('Meu', { chave: 'meu:1' })
    const alheio = await mkItem('Alheio', { uid: OUTRO, chave: 'alheio:1' })
    expect(await erro(`select lista_item_adicionar($1, $2, null, false)`, [lista, alheio])).toContain('item_nao_encontrado')
    expect(await erro(`select lista_item_adicionar($1, gen_random_uuid(), null, false)`, [lista])).toContain('item_nao_encontrado')
    await adicionar(lista, meu)
    expect(await erro(`select lista_item_adicionar($1, $2, null, false)`, [lista, meu])).toContain('lista_item_repetido')
    const outro = await mkItem('Outro', { chave: 'outro:1' })
    expect(await erro(`select lista_item_adicionar($1, $2, $3, false)`, [lista, outro, 'x'.repeat(301)])).toContain('lista_nota_longa')
    // lista de outra pessoa
    await como(OUTRO, async () => {
      expect(await erro(`select lista_item_adicionar($1, $2, null, false)`, [lista, alheio])).toContain('lista_nao_encontrada')
    })
    // limite de 200 itens
    const cheia = await criar('Cheia')
    await admin(`insert into lista_itens(lista_id, posicao, obra_chave, titulo) select '${cheia}', g, 'x:' || g, 'T' || g from generate_series(1, 200) g`)
    expect(await erro(`select lista_item_adicionar($1, $2, null, false)`, [cheia, outro])).toContain('lista_cheia')
  })

  it('reordena, remove (fechando o buraco) e recusa ordem que não é a da lista', async () => {
    const lista = await criar('Ordem', true)
    const ids: string[] = []
    for (const t of ['A', 'B', 'C']) ids.push(await adicionar(lista, await mkItem(`Ord ${t}`, { chave: `ord:${t}` })))
    expect((await itensDe(lista)).map((r) => r.titulo)).toEqual(['Ord A', 'Ord B', 'Ord C'])
    await db.query(`select lista_itens_reordenar($1, $2::uuid[])`, [lista, [ids[2], ids[0], ids[1]]])
    expect((await itensDe(lista)).map((r) => r.titulo)).toEqual(['Ord C', 'Ord A', 'Ord B'])
    expect(await erro(`select lista_itens_reordenar($1, $2::uuid[])`, [lista, [ids[0], ids[1]]])).toContain('lista_ordem_invalida')
    expect(await erro(`select lista_itens_reordenar($1, $2::uuid[])`, [lista, [ids[0], ids[0], ids[1]]])).toContain('lista_ordem_invalida')
    expect(await erro(`select lista_itens_reordenar($1, $2::uuid[])`, [lista, [ids[0], ids[1], '00000000-0000-0000-0000-000000000001']])).toContain('lista_ordem_invalida')
    await como(OUTRO, async () => {
      expect(await erro(`select lista_itens_reordenar($1, $2::uuid[])`, [lista, ids])).toContain('lista_nao_encontrada')
      expect(await erro(`select lista_item_remover($1)`, [ids[0]])).toContain('lista_item_nao_encontrado')
    })
    await db.query(`select lista_item_remover($1)`, [ids[2]])
    expect((await itensDe(lista)).map((r) => [r.titulo, r.posicao])).toEqual([['Ord A', 1], ['Ord B', 2]])
    const novo = await adicionar(lista, await mkItem('Ord D', { chave: 'ord:D' }))
    expect((await itensDe(lista)).map((r) => r.posicao)).toEqual([1, 2, 3])
    expect((await itensDe(lista))[2].id).toBe(novo)
  })

  it('nota e spoiler do item: editáveis; spoiler sem nota não existe', async () => {
    const lista = await criar('Notas')
    const id = await adicionar(lista, await mkItem('Com nota', { chave: 'nota:1' }), 'Melhor do arco', true)
    expect(await itensDe(lista)).toMatchObject([{ nota: 'Melhor do arco', spoiler: true }])
    await db.query(`select lista_item_editar($1, '  ', true)`, [id])
    expect(await itensDe(lista)).toMatchObject([{ nota: null, spoiler: false }])
    await db.query(`select lista_item_editar($1, 'Voltei atrás', false)`, [id])
    expect(await itensDe(lista)).toMatchObject([{ nota: 'Voltei atrás', spoiler: false }])
    await como(OUTRO, async () => {
      expect(await erro(`select lista_item_editar($1, 'invadido', false)`, [id])).toContain('lista_item_nao_encontrado')
    })
  })

  describe('visibilidade (RLS e amizade)', () => {
    let lista = ''
    let itemCapa = ''
    beforeAll(async () => {
      lista = await criar('Só para amigos', true)
      const item = await mkItem('Privada', { chave: 'priv:1', capa: `${U}/privada.png`, estado: 'lido' })
      itemCapa = await adicionar(lista, item, 'Comentário', true)
      await adicionar(lista, await mkItem('Pública', { chave: 'pub:1', capa: `pub/${HASH}.jpg` }))
    })

    it('o dono vê pela tabela (RLS) e pelas funções', async () => {
      expect((await db.query(`select id from listas where id = $1`, [lista])).rows).toHaveLength(1)
      expect((await db.query(`select id from lista_itens where lista_id = $1`, [lista])).rows).toHaveLength(2)
      expect((await db.query(`select * from lista_detalhe($1)`, [lista])).rows).toHaveLength(1)
    })

    it('amigo aceito vê pelas funções, mas não lê nem escreve as tabelas direto', async () => {
      await como(OUTRO, async () => {
        expect((await visiveis()).map((l) => l.id)).toContain(lista)
        expect((await db.query<{ proprio: boolean }>(`select proprio from lista_detalhe($1)`, [lista])).rows[0].proprio).toBe(false)
        expect(await itensDe(lista)).toHaveLength(2)
        expect((await db.query(`select id from listas where id = $1`, [lista])).rows).toEqual([])
        expect((await db.query(`select id from lista_itens where lista_id = $1`, [lista])).rows).toEqual([])
        expect(await erro(`insert into listas(user_id, titulo) values ($1, 'x')`, [OUTRO])).not.toBeNull()
        await db.query(`update listas set titulo = 'hack' where id = $1`, [lista])
        await db.query(`update lista_itens set capa = 'outro/arquivo.jpg' where lista_id = $1`, [lista])
      })
      const { rows: [l] } = await db.query<{ titulo: string }>(`select titulo from listas where id = $1`, [lista])
      expect(l.titulo).toBe('Só para amigos')
      expect((await db.query(`select id from lista_itens where lista_id = $1 and capa like 'outro/%'`, [lista])).rows).toEqual([])
    })

    it('o dono também não escreve direto: título, capa e posição só mudam pelas funções', async () => {
      expect(await erro(`insert into lista_itens(lista_id, posicao, titulo, capa) values ($1, 99, 'x', '${OUTRO}/alheia.jpg')`, [lista])).not.toBeNull()
      await db.query(`update lista_itens set capa = '${OUTRO}/alheia.jpg' where lista_id = $1`, [lista])
      expect((await db.query(`select id from lista_itens where lista_id = $1 and capa like '${OUTRO}/%'`, [lista])).rows).toEqual([])
    })

    it('quem não é amigo (e quem só pediu) não vê nada, nem a lista, nem a capa, nem comenta ou curte', async () => {
      await como(CAIO, async () => {
        expect((await visiveis()).map((l) => l.id)).not.toContain(lista)
        expect((await db.query(`select * from lista_detalhe($1)`, [lista])).rows).toEqual([])
        expect(await itensDe(lista)).toEqual([])
        expect((await db.query(`select lista_item_capa($1) c`, [itemCapa])).rows[0]).toEqual({ c: null })
        expect(await erro(`select lista_curtir($1)`, [lista])).toContain('lista_nao_encontrada')
        expect(await erro(`select lista_comentar($1, 'oi')`, [lista])).toContain('lista_nao_encontrada')
        expect((await db.query(`select * from lista_comentarios_listar($1)`, [lista])).rows).toEqual([])
      })
      // pedido pendente não vale
      await como(DANI, async () => {
        await db.query(`select amizade_solicitar('ana')`)
      })
      await como(DANI, async () => expect((await visiveis()).map((l) => l.id)).not.toContain(lista))
    })

    it('amizade desfeita corta na hora (itens, capa, curtir e comentar) e volta ao refazer', async () => {
      await como(OUTRO, async () => {
        await db.query(`select lista_curtir($1)`, [lista])
        await db.query(`select lista_comentar($1, 'Boa lista')`, [lista])
      })
      await db.query(`select amizade_desfazer($1)`, [amizade])
      await como(OUTRO, async () => {
        expect((await visiveis()).map((l) => l.id)).not.toContain(lista)
        expect(await itensDe(lista)).toEqual([])
        expect((await db.query(`select * from lista_detalhe($1)`, [lista])).rows).toEqual([])
        expect((await db.query(`select lista_item_capa($1) c`, [itemCapa])).rows[0]).toEqual({ c: null })
        expect(await erro(`select lista_curtir($1)`, [lista])).toContain('lista_nao_encontrada')
        expect(await erro(`select lista_comentar($1, 'ainda aqui?')`, [lista])).toContain('lista_nao_encontrada')
      })
      amizade = (await como(OUTRO, () => db.query<{ id: string }>(`select amizade_solicitar('ana') id`))).rows[0].id
      await db.query(`select amizade_responder($1, true)`, [amizade])
      await como(OUTRO, async () => expect((await visiveis()).map((l) => l.id)).toContain(lista))
    })

    it('capa: a do catálogo sai como pub/..., a privada só como nome do arquivo e só o banco autoriza o caminho', async () => {
      await como(OUTRO, async () => {
        const itens = await itensDe(lista)
        expect(itens.map((i) => i.capa)).toEqual(['privada.png', `pub/${HASH}.jpg`])
        expect(JSON.stringify(itens)).not.toContain(U)
        const { rows: [c] } = await db.query<{ c: string }>(`select lista_item_capa($1) c`, [itemCapa])
        expect(c.c).toBe(`${U}/privada.png`)
        const [pub] = (await db.query<{ id: string }>(`select id from lista_itens where false`)).rows
        expect(pub).toBeUndefined()
        const l = (await db.query<{ capa: string | null }>(`select capa from listas_listar(null) where id = $1`, [lista])).rows[0]
        expect(l.capa).toBe('privada.png')
      })
    })

    it('anônimo não executa nenhuma função e não lê as tabelas', async () => {
      await db.query(`set role anon`)
      try {
        for (const sql of [
          `select * from listas_listar(null)`,
          `select * from lista_detalhe('${lista}')`,
          `select * from lista_itens_listar('${lista}')`,
          `select lista_item_capa('${itemCapa}')`,
          `select lista_curtir('${lista}')`,
          `select lista_comentar('${lista}', 'oi')`,
          `select * from listas`,
          `select * from lista_itens`,
          `select * from lista_curtidas`,
          `select * from lista_comentarios`,
        ]) {
          expect(await erro(sql), sql).toMatch(/permission denied/)
        }
      } finally {
        await db.query(`set role authenticated`)
      }
    })

    it('"tenho" e "li": usam a chave da obra do visitante (e o vínculo manual), sem olhar desejo nem a coleção do dono', async () => {
      const lista2 = await criar('Tenho e li')
      for (const [t, ch] of [['Tenho lido', 'tl:1'], ['Tenho comprado', 'tl:2'], ['So desejo', 'tl:3'], ['Nao tenho', 'tl:4'], ['Por vinculo', 'tl:5']] as const) {
        await adicionar(lista2, await mkItem(`Dono ${t}`, { chave: ch }))
      }
      await como(OUTRO, async () => {
        await mkItem('Beto lido', { uid: OUTRO, chave: 'tl:1', estado: 'lido' })
        await mkItem('Beto comprado', { uid: OUTRO, chave: 'tl:2', estado: 'comprado' })
        await mkItem('Beto desejo', { uid: OUTRO, chave: 'tl:3', estado: 'desejo' })
        await mkItem('Beto vinculado', { uid: OUTRO, chave: 'beto:proprio', estado: 'lido' })
      })
      await admin(`insert into obra_equivalencias(user_id, obra_chave, obra_chave_amigo) values ('${OUTRO}', 'beto:proprio', 'tl:5')`)
      await como(OUTRO, async () => {
        const r = Object.fromEntries((await itensDe(lista2)).map((i) => [i.titulo, [i.tenho, i.li]]))
        expect(r).toEqual({
          'Dono Tenho lido': [true, true],
          'Dono Tenho comprado': [true, false],
          'Dono So desejo': [false, false],
          'Dono Nao tenho': [false, false],
          'Dono Por vinculo': [true, true],
        })
      })
      // Para o dono, a conta é dele mesmo (os itens que ele adicionou existem na coleção dele).
      expect((await itensDe(lista2)).every((i) => i.tenho === true)).toBe(true)
    })

    it('item sem chave nunca casa (não vira "tenho" por engano)', async () => {
      const lista3 = await criar('Sem chave')
      await adicionar(lista3, await mkItem('Sem chave', { chave: null }))
      await como(OUTRO, async () => {
        await mkItem('Beto sem chave', { uid: OUTRO, chave: null })
        expect(await itensDe(lista3)).toMatchObject([{ tenho: false, li: false }])
      })
    })
  })

  describe('curtir e comentar', () => {
    let lista = ''
    beforeAll(async () => {
      lista = await criar('Conversa')
    })

    it('curtir é idempotente, conta, e descurtir desfaz', async () => {
      await como(OUTRO, async () => {
        await db.query(`select lista_curtir($1)`, [lista])
        await db.query(`select lista_curtir($1)`, [lista])
        expect((await db.query<{ curtidas: number; curti: boolean }>(`select curtidas, curti from lista_detalhe($1)`, [lista])).rows[0]).toEqual({ curtidas: 1, curti: true })
      })
      expect((await db.query<{ curtidas: number; curti: boolean }>(`select curtidas, curti from lista_detalhe($1)`, [lista])).rows[0]).toEqual({ curtidas: 1, curti: false })
      await como(OUTRO, async () => {
        await db.query(`select lista_descurtir($1)`, [lista])
        expect((await db.query<{ curtidas: number }>(`select curtidas from lista_detalhe($1)`, [lista])).rows[0].curtidas).toBe(0)
      })
    })

    it('comentários: valida texto, lista com autor, e só autor ou dono apagam', async () => {
      await como(OUTRO, async () => {
        expect(await erro(`select lista_comentar($1, '   ')`, [lista])).toContain('comentario_vazio')
        expect(await erro(`select lista_comentar($1, $2)`, [lista, 'x'.repeat(501)])).toContain('comentario_longo')
        await db.query(`select lista_comentar($1, '  Ótima lista  ')`, [lista])
      })
      const lidos = (await db.query<{ id: string; texto: string; meu: boolean; pode_apagar: boolean; apelido: string }>(`select * from lista_comentarios_listar($1)`, [lista])).rows
      expect(lidos).toHaveLength(1)
      expect(lidos[0]).toMatchObject({ texto: 'Ótima lista', meu: false, pode_apagar: true, apelido: 'beto' })
      expect((await db.query<{ comentarios: number }>(`select comentarios from lista_detalhe($1)`, [lista])).rows[0].comentarios).toBe(1)
      await admin(`insert into amizades(solicitante, destinatario, status) values ('${DANI}', '${U}', 'aceita') on conflict (least(solicitante, destinatario), greatest(solicitante, destinatario)) do update set status = 'aceita'`)
      await como(DANI, async () => {
        const dani = (await db.query<{ id: string }>(`select lista_comentar($1, 'Eu também') id`, [lista])).rows[0].id
        expect(await erro(`select lista_apagar_comentario($1)`, [lidos[0].id])).toContain('comentario_nao_encontrado')
        await db.query(`select lista_apagar_comentario($1)`, [dani])
      })
      await como(OUTRO, async () => {
        await db.query(`select lista_apagar_comentario($1)`, [lidos[0].id])
      })
      expect((await db.query(`select * from lista_comentarios_listar($1)`, [lista])).rows).toEqual([])
    })

    it('o dono apaga comentário de qualquer um na lista dele', async () => {
      await como(OUTRO, async () => db.query(`select lista_comentar($1, 'Apague-me')`, [lista]))
      const [c] = (await db.query<{ id: string }>(`select id from lista_comentarios_listar($1)`, [lista])).rows
      await db.query(`select lista_apagar_comentario($1)`, [c.id])
      expect((await db.query(`select * from lista_comentarios_listar($1)`, [lista])).rows).toEqual([])
    })

    it('o amigo A não descobre o amigo B pelo comentário (só vê quem é dono, ele mesmo ou amigo dele)', async () => {
      // Dani e Beto são amigos da Ana, mas não entre si.
      await como(DANI, async () => db.query(`select lista_comentar($1, 'Sou a Dani')`, [lista]))
      await como(OUTRO, async () => {
        expect((await db.query(`select * from lista_comentarios_listar($1)`, [lista])).rows).toEqual([])
        expect((await db.query<{ comentarios: number }>(`select comentarios from lista_detalhe($1)`, [lista])).rows[0].comentarios).toBe(0)
      })
      expect((await db.query(`select * from lista_comentarios_listar($1)`, [lista])).rows).toHaveLength(1)
      await admin(`delete from lista_comentarios where lista_id = '${lista}'`)
    })

    it('limite de taxa no banco: 10 comentários por minuto por pessoa', async () => {
      await admin(`delete from lista_comentarios where user_id = '${OUTRO}'`)
      await como(OUTRO, async () => {
        for (let k = 0; k < 10; k++) await db.query(`select lista_comentar($1, $2)`, [lista, `c${k}`])
        expect(await erro(`select lista_comentar($1, 'o 11º')`, [lista])).toContain('comentario_rapido')
      })
      await admin(`delete from lista_comentarios where user_id = '${OUTRO}'`)
    })

    it('apagar a lista leva junto itens, curtidas e comentários', async () => {
      const l = await criar('Efêmera')
      await adicionar(l, await mkItem('Efêmero', { chave: 'efemero:1' }))
      await como(OUTRO, async () => {
        await db.query(`select lista_curtir($1)`, [l])
        await db.query(`select lista_comentar($1, 'tchau')`, [l])
      })
      await db.query(`select lista_apagar($1)`, [l])
      await admin(`select 1`)
      const { rows } = await db.query<{ n: number }>(`select (select count(*) from lista_itens where lista_id = '${l}')::int + (select count(*) from lista_curtidas where lista_id = '${l}')::int + (select count(*) from lista_comentarios where lista_id = '${l}')::int as n`)
      expect(rows[0].n).toBe(0)
    })
  })

  it('listas_listar filtra por apelido do dono e traz contagens, capa e quantidade de itens', async () => {
    const mini = await criar('Mini')
    await adicionar(mini, await mkItem('Mini 1', { chave: 'mini:1', capa: `pub/${HASH}.jpg` }))
    await como(OUTRO, async () => {
      const so = (await db.query<{ id: string; qtd: number; capa: string; apelido: string }>(`select id, qtd, capa, apelido from listas_listar('ANA')`)).rows
      expect(so.every((l) => l.apelido === 'ana')).toBe(true)
      expect(so.find((l) => l.id === mini)).toMatchObject({ qtd: 1, capa: `pub/${HASH}.jpg` })
      expect((await db.query(`select * from listas_listar('caio')`)).rows).toEqual([])
    })
  })

  it('o link público não tem lista: nenhuma função link_* nem a vitrine toca as tabelas de listas', () => {
    const anteriores = [
      '0013_compartilhamento', '0014_amigos_presentes_emprestimos', '0017_capa_variante', '0019_notas_entre_amigos', '0024_spoiler_na_critica', '0026_favoritos_series',
    ].map((f) => readFileSync(path.join(PASTA, `${f}.sql`), 'utf8'))
    expect(anteriores.some((s) => /lista_itens|lista_curtidas|listas_listar/.test(s))).toBe(false)
    const sql = readFileSync(path.join(PASTA, '0028_listas_curadas.sql'), 'utf8')
    expect(sql).not.toMatch(/\blink_[a-z_]+\(/)
    expect(sql).not.toMatch(/compartilhamentos/)
  })

  it('migration: tabelas com RLS, sem política de escrita, e as funções fechadas para anônimo', () => {
    const sql = readFileSync(path.join(PASTA, '0028_listas_curadas.sql'), 'utf8')
    for (const t of ['listas', 'lista_itens', 'lista_curtidas', 'lista_comentarios']) expect(sql).toContain(`alter table ${t} enable row level security;`)
    expect(sql).not.toMatch(/create policy [^;]+ for (insert|update|delete|all)/)
    expect(sql).toMatch(/revoke all on all functions in schema privado/)
    expect(sql).toContain('grant select on listas, lista_itens to authenticated;')
    const funcoes = [...sql.matchAll(/^create or replace function (lista[a-z_]*)\(([^)]*)\)/gm)].map((m) => `${m[1]}(${m[2].split(',').map((p) => p.trim().split(/\s+/)[1]).filter(Boolean).join(', ')})`)
    expect(funcoes.length).toBe(15)
    for (const f of funcoes) {
      expect(sql, f).toContain(`revoke all on function ${f} from public, anon;`)
      expect(sql, f).toContain(`grant execute on function ${f} to authenticated;`)
    }
  })
})

describe('leituras: blindar update e criado_em (migration 0029)', () => {
  // Ana (U) é a dona das leituras; Beto (OUTRO) é amigo dela e dono do item "alheio".
  const como = async <T,>(uid: string, fn: () => Promise<T>): Promise<T> => {
    await db.query(`select set_config('app.uid','${uid}',false)`)
    try {
      return await fn()
    } finally {
      await db.query(`select set_config('app.uid','${U}',false)`)
    }
  }
  const admin = async (sql: string) => {
    await db.query(`reset role`)
    try {
      await db.exec(sql)
    } finally {
      await db.query(`set role authenticated`)
    }
  }
  const salvar = async (extra: object) =>
    (await db.query<{ id: string }>(`select item_salvar(null, $1::jsonb, '{}') id`, [JSON.stringify({ titulo: 'Blindagem 1', tipo: 'manga', estado: 'lido', prioridade: 0, ...extra })])).rows[0].id
  const leitura = async (id: string) =>
    (await db.query<{ item_id: string; user_id: string; lido_em: string; releitura: boolean; criado_em: string }>(`select item_id, user_id, lido_em::text, releitura, criado_em::text from leituras where id = $1`, [id])).rows[0]
  const feed = async () => (await db.query<Record<string, unknown>>(`select * from feed_listar()`)).rows

  let itemAna: string
  let itemBeto: string
  let leituraAna: string

  beforeAll(async () => {
    await admin(`
      delete from compartilhamentos; delete from amizades; delete from itens; delete from series; delete from perfis;
      insert into perfis(user_id, apelido, escopo_amigos, feed_ativo) values
        ('${U}', 'ana', '{notas_criticas,lidos}', true), ('${OUTRO}', 'beto', '{notas_criticas,lidos}', true);
    `)
    const id = (await como(OUTRO, () => db.query<{ id: string }>(`select amizade_solicitar('ana') id`))).rows[0].id
    await db.query(`select amizade_responder($1, true)`, [id])
    itemAna = await salvar({ titulo: 'Da Ana', lido_em: '2026-03-01' })
    itemBeto = await como(OUTRO, () => salvar({ titulo: 'Do Beto', lido_em: '2026-03-02', nota: 4 }))
    leituraAna = (await db.query<{ id: string }>(`select id from leituras where item_id = $1`, [itemAna])).rows[0].id
  })

  it('update de item_id para o item de um amigo é rejeitado (privilégio e gatilho)', async () => {
    await expect(db.query(`update leituras set item_id = $1 where id = $2`, [itemBeto, leituraAna])).rejects.toThrow()
    expect((await leitura(leituraAna)).item_id).toBe(itemAna)
    // sem o privilégio de coluna, o gatilho ainda segura (superusuário, por exemplo)
    await db.query(`reset role`)
    try {
      await expect(db.query(`update leituras set item_id = $1 where id = $2`, [itemBeto, leituraAna])).rejects.toThrow('leitura_imutavel')
    } finally {
      await db.query(`set role authenticated`)
    }
    expect((await leitura(leituraAna)).item_id).toBe(itemAna)
  })

  it('update de releitura, criado_em, user_id e id é rejeitado (privilégio e gatilho)', async () => {
    const antes = await leitura(leituraAna)
    for (const set of [`releitura = true`, `criado_em = now() + interval '30 days'`, `user_id = '${OUTRO}'`, `id = gen_random_uuid()`]) {
      await expect(db.query(`update leituras set ${set} where id = $1`, [leituraAna]), set).rejects.toThrow()
      await db.query(`reset role`)
      try {
        await expect(db.query(`update leituras set ${set} where id = $1`, [leituraAna]), set).rejects.toThrow('leitura_imutavel')
      } finally {
        await db.query(`set role authenticated`)
      }
    }
    expect(await leitura(leituraAna)).toEqual(antes)
    // o privilégio de coluna: só lido_em
    const cols = (await db.query<{ c: string; p: boolean }>(
      `select column_name c, has_column_privilege('authenticated', 'leituras', column_name, 'update') p from information_schema.columns where table_name = 'leituras'`,
    )).rows
    expect(cols.filter((x) => x.p).map((x) => x.c)).toEqual(['lido_em'])
  })

  it('update de lido_em continua funcionando e sincroniza itens.lido_em', async () => {
    await db.query(`update leituras set lido_em = '2026-04-10' where id = $1`, [leituraAna])
    expect((await leitura(leituraAna)).lido_em).toBe('2026-04-10')
    expect((await db.query<{ d: string }>(`select lido_em::text d from itens where id = $1`, [itemAna])).rows[0].d).toBe('2026-04-10')
    // e a edição do lido_em pelo item (gatilho da 0025) também passa pelo gatilho novo
    await db.query(`select item_salvar($1, $2::jsonb, '{}')`, [itemAna, JSON.stringify({ titulo: 'Da Ana', tipo: 'manga', estado: 'lido', prioridade: 0, lido_em: '2026-04-11' })])
    expect((await leitura(leituraAna)).lido_em).toBe('2026-04-11')
  })

  it('insert ignora o criado_em do cliente e grava now()', async () => {
    const futuro = '2099-01-01T00:00:00Z'
    const id = (await db.query<{ id: string }>(`insert into leituras(item_id, user_id, lido_em, criado_em, releitura) values ($1, $2, '2026-05-01', $3, false) returning id`, [itemAna, U, futuro])).rows[0].id
    const l = await leitura(id)
    expect(new Date(l.criado_em).getFullYear()).toBeLessThan(2099)
    expect(l.releitura).toBe(true)
    const dif = (await db.query<{ s: number }>(`select abs(extract(epoch from (now() - criado_em)))::float s from leituras where id = $1`, [id])).rows[0].s
    expect(dif).toBeLessThan(5)
    // o mesmo vale para o passado
    const id2 = (await db.query<{ id: string }>(`insert into leituras(item_id, user_id, lido_em, criado_em) values ($1, $2, '2026-05-02', '2000-01-01') returning id`, [itemAna, U])).rows[0].id
    expect(new Date((await leitura(id2)).criado_em).getFullYear()).toBeGreaterThanOrEqual(2026)
  })

  it('feed_listar não mostra "releu" quando o dono da leitura não é o dono do item', async () => {
    const releu = async (item: string) => (await feed()).filter((x) => x.item_id === item && x.releitura)
    // leitura legítima do Beto no item dele: aparece para a Ana
    await como(OUTRO, () => db.query(`insert into leituras(item_id, user_id, lido_em) values ($1, $2, '2026-06-01')`, [itemBeto, OUTRO]))
    expect(await releu(itemBeto)).toHaveLength(1)
    // forja (feita fora das regras, como superusuário): leitura da Ana apontando para o item do Beto
    await admin(`
      alter table leituras disable trigger trg_leituras_validar;
      alter table leituras disable trigger trg_leituras_imutaveis;
      insert into leituras(item_id, user_id, lido_em, releitura, criado_em) values ('${itemBeto}', '${U}', '2026-06-02', true, now());
      alter table leituras enable trigger trg_leituras_validar;
      alter table leituras enable trigger trg_leituras_imutaveis;
    `)
    expect((await db.query<{ n: number }>(`select count(*)::int n from leituras where item_id = $1 and releitura and user_id = auth.uid()`, [itemBeto])).rows[0].n).toBe(1)
    expect(await releu(itemBeto)).toHaveLength(1)
    // para os amigos da Ana, nada de "Ana releu" o item do Beto
    expect((await como(OUTRO, feed)).filter((x) => x.item_id === itemBeto && x.releitura && x.dono_id === U)).toHaveLength(0)
  })

  it('migration: revoga o update da tabela, libera só lido_em e recria feed_listar sem mudar o retorno', () => {
    const sql = readFileSync(path.join(PASTA, '0029_leituras_blindar_update.sql'), 'utf8')
    expect(sql).toContain('revoke update on leituras from authenticated;')
    expect(sql).toContain('grant update (lido_em) on leituras to authenticated;')
    expect(sql).toContain('new.criado_em := now();')
    expect(sql).toMatch(/and l\.releitura\s+and l\.user_id = i\.user_id/)
    expect(sql).toContain('grant execute on function feed_listar(int, timestamptz) to authenticated;')
    // nenhuma migration anterior foi tocada: a 0025 continua com a policy original e sem o gatilho novo
    const m25 = readFileSync(path.join(PASTA, '0025_releitura_e_diario.sql'), 'utf8')
    expect(m25).not.toContain('leituras_imutaveis')
  })
})

describe('melhor volume da série (migration 0030)', () => {
  // Ana (U) é a dona/visitante; Beto (OUTRO), Carla, Edu são amigos com escopo de notas; Gui é amigo SEM `notas_criticas`.
  const ID = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(4)}-${String(n).repeat(12)}`
  const BETO = OUTRO
  const CARLA = ID(2)
  const EDU = ID(3)
  const GUI = ID(5)
  const como = async <T,>(uid: string, fn: () => Promise<T>): Promise<T> => {
    await db.query(`select set_config('app.uid','${uid}',false)`)
    try {
      return await fn()
    } finally {
      await db.query(`select set_config('app.uid','${U}',false)`)
    }
  }
  const admin = async (sql: string) => {
    await db.query(`reset role`)
    try {
      await db.exec(sql)
    } finally {
      await db.query(`set role authenticated`)
    }
  }
  const salvar = async (extra: object) =>
    (await db.query<{ id: string }>(`select item_salvar(null, $1::jsonb, '{}') id`, [JSON.stringify({ titulo: 'x', tipo: 'hq', estado: 'lido', prioridade: 0, ...extra })])).rows[0].id
  const serieDe = async (nome: string) =>
    (await db.query<{ id: string }>(`insert into series(user_id, nome, tipo) values (auth.uid(), $1, 'hq') returning id`, [nome])).rows[0].id
  const marcar = (item: string, marcar = true) => db.query(`select item_melhor_da_serie_definir($1, $2)`, [item, marcar])
  const marca = async (id: string) => (await db.query<{ m: boolean }>(`select melhor_da_serie m from itens where id = $1`, [id])).rows[0].m
  const erro = async (fn: () => Promise<unknown>) => {
    try {
      await fn()
      return null
    } catch (e) {
      return (e as Error).message
    }
  }
  /** Série da Ana com `n` volumes lidos (1..n). */
  const serieComLidos = async (nome: string, n: number) => {
    const serie = await serieDe(nome)
    const ids: string[] = []
    for (let k = 1; k <= n; k++) ids.push(await salvar({ titulo: `${nome} ${k}`, serie_id: serie, numero_volume: k }))
    return { serie, ids }
  }

  beforeAll(async () => {
    await admin(`
      insert into auth.users values ('${CARLA}'), ('${EDU}'), ('${GUI}') on conflict do nothing;
      delete from obra_equivalencias; delete from compartilhamentos; delete from amizades; delete from itens; delete from series; delete from perfis;
      insert into perfis(user_id, apelido, escopo_amigos) values
        ('${U}', 'ana', '{notas_criticas,lidos,colecao,series,ranking}'),
        ('${BETO}', 'beto', '{notas_criticas,lidos,colecao,series,ranking}'),
        ('${CARLA}', 'carla', '{notas_criticas,lidos,colecao,series,ranking}'),
        ('${EDU}', 'edu', '{notas_criticas,lidos,colecao,series,ranking}'),
        ('${GUI}', 'gui', '{lidos,colecao,series,ranking}');
    `)
    for (const uid of [BETO, CARLA, EDU, GUI]) {
      const id = await como(uid, async () => (await db.query<{ id: string }>(`select amizade_solicitar('ana') id`)).rows[0].id)
      await db.query(`select amizade_responder($1, true)`, [id])
    }
  })

  it('1. marca com 2 lidos; com 1 lido recusa', async () => {
    const { ids } = await serieComLidos('Marca 1', 2)
    await marcar(ids[0])
    expect(await marca(ids[0])).toBe(true)
    const sozinha = await serieComLidos('Marca 1 sozinha', 1)
    expect(await erro(() => marcar(sozinha.ids[0]))).toContain('melhor_exige_dois_lidos')
    expect(await marca(sozinha.ids[0])).toBe(false)
  })

  it('2. recusa não lido, sem série e variante', async () => {
    const { serie, ids } = await serieComLidos('Marca 2', 2)
    const comprado = await salvar({ titulo: 'Marca 2 c', serie_id: serie, numero_volume: 3, estado: 'comprado' })
    const desejo = await salvar({ titulo: 'Marca 2 d', serie_id: serie, numero_volume: 4, estado: 'desejo' })
    const semSerie = await salvar({ titulo: 'Marca 2 solto' })
    const variante = await salvar({ titulo: 'Marca 2 v', serie_id: serie, numero_volume: 1, variante_de: ids[0] })
    expect(await erro(() => marcar(comprado))).toContain('melhor_exige_lido')
    expect(await erro(() => marcar(desejo))).toContain('melhor_exige_lido')
    expect(await erro(() => marcar(semSerie))).toContain('melhor_exige_serie')
    expect(await erro(() => marcar(variante))).toContain('melhor_em_variante')
  })

  it('3. marcar outro desmarca o anterior; o índice único recusa dois por update direto', async () => {
    const { ids } = await serieComLidos('Marca 3', 3)
    await marcar(ids[0])
    await marcar(ids[1])
    expect([await marca(ids[0]), await marca(ids[1]), await marca(ids[2])]).toEqual([false, true, false])
    // marcar o que já está marcado é idempotente
    await marcar(ids[1])
    expect(await marca(ids[1])).toBe(true)
    // update direto deixaria dois marcados: o índice único barra
    expect(await erro(() => db.query(`update itens set melhor_da_serie = true where id = $1`, [ids[2]]))).toMatch(/itens_melhor_da_serie_unico|duplicate key|unique/i)
    // desmarcar
    await marcar(ids[1], false)
    expect(await marca(ids[1])).toBe(false)
  })

  it('4. lido sem nota pode ser marcado; apagar a nota mantém a marca', async () => {
    const { ids } = await serieComLidos('Marca 4', 2)
    expect((await db.query<{ nota: string | null }>(`select nota from itens where id = $1`, [ids[0]])).rows[0].nota).toBeNull()
    await marcar(ids[0])
    expect(await marca(ids[0])).toBe(true)
    await db.query(`update itens set nota = 4.5 where id = $1`, [ids[0]])
    await db.query(`update itens set nota = null where id = $1`, [ids[0]])
    expect(await marca(ids[0])).toBe(true)
  })

  it('5. a marca cai ao sair de lido, mudar de série, virar variante ou a série ficar com 1 lido', async () => {
    // sair de lido
    let s = await serieComLidos('Cai 1', 3)
    await marcar(s.ids[0])
    await db.query(`update itens set estado = 'comprado' where id = $1`, [s.ids[0]])
    expect(await marca(s.ids[0])).toBe(false)
    // mudar de série (inclusive para nulo)
    s = await serieComLidos('Cai 2', 3)
    const outra = await serieDe('Cai 2 destino')
    await marcar(s.ids[0])
    await db.query(`update itens set serie_id = $1 where id = $2`, [outra, s.ids[0]])
    expect(await marca(s.ids[0])).toBe(false)
    await marcar(s.ids[1])
    await db.query(`update itens set serie_id = null where id = $1`, [s.ids[1]])
    expect(await marca(s.ids[1])).toBe(false)
    // virar variante
    s = await serieComLidos('Cai 3', 3)
    await marcar(s.ids[1])
    await db.query(`select item_definir_variante($1, $2)`, [s.ids[1], s.ids[0]])
    expect(await marca(s.ids[1])).toBe(false)
    // a série ficou com 1 lido: o outro volume sai de lido
    s = await serieComLidos('Cai 4', 2)
    await marcar(s.ids[0])
    await db.query(`update itens set estado = 'comprado' where id = $1`, [s.ids[1]])
    expect(await marca(s.ids[0])).toBe(false)
    // ... ou é apagado
    s = await serieComLidos('Cai 5', 2)
    await marcar(s.ids[0])
    await db.query(`delete from itens where id = $1`, [s.ids[1]])
    expect(await marca(s.ids[0])).toBe(false)
    // com 3 lidos, sair um deles NÃO derruba a marca de outro
    s = await serieComLidos('Cai 6', 3)
    await marcar(s.ids[0])
    await db.query(`update itens set estado = 'comprado' where id = $1`, [s.ids[2]])
    expect(await marca(s.ids[0])).toBe(true)
  })

  it('5b. a sincronização de variantes (cascata) também derruba a marca quando o principal sai de lido', async () => {
    const { serie, ids } = await serieComLidos('Cai 7', 2)
    const variante = await salvar({ titulo: 'Cai 7 v', serie_id: serie, numero_volume: 1, variante_de: ids[0] })
    await marcar(ids[0])
    expect(await marca(ids[0])).toBe(true)
    await db.query(`update itens set estado = 'comprado' where id = $1`, [variante])
    expect((await db.query<{ estado: string }>(`select estado from itens where id = $1`, [ids[0]])).rows[0].estado).toBe('comprado')
    expect(await marca(ids[0])).toBe(false)
  })

  it('6. INSERT com melhor_da_serie = true grava false', async () => {
    const { serie } = await serieComLidos('Insert', 2)
    const { rows } = await db.query<{ melhor_da_serie: boolean }>(
      `insert into itens(user_id, serie_id, titulo, numero_volume, estado, melhor_da_serie) values (auth.uid(), $1, 'ins', 9, 'lido', true) returning melhor_da_serie`,
      [serie]
    )
    expect(rows[0].melhor_da_serie).toBe(false)
  })

  it('7. outro usuário não marca item alheio; sem login recusa', async () => {
    const { ids } = await serieComLidos('Alheio', 2)
    expect(await como(BETO, () => erro(() => marcar(ids[0])))).toContain('item_nao_encontrado')
    expect(await marca(ids[0])).toBe(false)
    await db.query(`select set_config('app.uid','',false)`)
    expect(await erro(() => marcar(ids[0]))).toContain('nao_autenticado')
    await db.query(`select set_config('app.uid','${U}',false)`)
  })

  describe('vitrine e rankings', () => {
    const doBeto = (secao: string, serie: string | null = null) =>
      db.query<Record<string, unknown>>(`select * from amigo_itens('beto', $1, $2)`, [secao, serie]).then((r) => r.rows)
    const doLink = (token: string, secao: string, serie: string | null = null) =>
      db.query<Record<string, unknown>>(`select * from link_itens($1, $2, $3)`, [token, secao, serie]).then((r) => r.rows)
    const escopoDoBeto = (escopo: string) => admin(`update perfis set escopo_amigos = '${escopo}' where user_id = '${BETO}'`)
    let serieBeto: string
    let p: string
    let q: string

    beforeAll(async () => {
      await como(BETO, async () => {
        serieBeto = await serieDe('Vitrine')
        // P é mais antigo que Q: sem a marca, a ordem do ranking é Q, P (created_at desc).
        p = await salvar({ titulo: 'Vit P', serie_id: serieBeto, numero_volume: 1, nota: 4 })
        q = await salvar({ titulo: 'Vit Q', serie_id: serieBeto, numero_volume: 2, nota: 4 })
        await marcar(p)
      })
      await admin(`update itens set created_at = now() - interval '2 days' where id = '${p}'; update itens set created_at = now() - interval '1 day' where id = '${q}';`)
    })

    it('8. amigo vê a marca só com notas_criticas + lidos; o link público nunca vê', async () => {
      const marcaDe = (linhas: Record<string, unknown>[], id: string) => linhas.find((x) => x.id === id)?.melhor_da_serie
      expect(marcaDe(await doBeto('serie', serieBeto), p)).toBe(true)
      expect(marcaDe(await doBeto('serie', serieBeto), q)).toBe(false)
      expect(marcaDe(await doBeto('ranking'), p)).toBe(true)
      await escopoDoBeto('{lidos,colecao,series,ranking}')
      expect(marcaDe(await doBeto('serie', serieBeto), p)).toBe(false)
      expect(marcaDe(await doBeto('ranking'), p)).toBe(false)
      await escopoDoBeto('{notas_criticas,colecao,series,ranking}')
      expect(marcaDe(await doBeto('serie', serieBeto), p)).toBe(false)
      await escopoDoBeto('{notas_criticas,lidos,colecao,series,ranking}')
      expect(marcaDe(await doBeto('serie', serieBeto), p)).toBe(true)
      // link com todos os escopos: nunca
      const token = (await como(BETO, () => db.query<{ t: string }>(`select compartilhamento_gerar('{colecao,lidos,notas_criticas,series,ranking}'::text[]) t`))).rows[0].t
      expect(marcaDe(await doLink(token, 'serie', serieBeto), p)).toBe(false)
      expect(marcaDe(await doLink(token, 'ranking'), p)).toBe(false)
    })

    it('10. no ranking, notas iguais: o marcado vem primeiro para o amigo; no link a ordem antiga continua', async () => {
      const ordem = (linhas: Record<string, unknown>[]) => linhas.map((x) => x.id).filter((id) => id === p || id === q)
      expect(ordem(await doBeto('ranking'))).toEqual([p, q])
      const token = (await como(BETO, () => db.query<{ t: string }>(`select compartilhamento_gerar('{colecao,lidos,notas_criticas,series,ranking}'::text[]) t`))).rows[0].t
      expect(ordem(await doLink(token, 'ranking'))).toEqual([q, p])
      // uma nota maior nunca fica atrás da marca
      const r = await como(BETO, () => salvar({ titulo: 'Vit R', serie_id: serieBeto, numero_volume: 3, nota: 5 }))
      const geral = (await doBeto('ranking')).map((x) => x.id).filter((id) => id === p || id === q || id === r)
      expect(geral).toEqual([r, p, q])
    })

    it('9. ranking_amigos: n_melhor conta amigos com a marca, desempata e ignora quem não compartilha notas; meu_melhor', async () => {
      await admin(`delete from itens; delete from series;`)
      // Zeta e Alfa: mesmas notas, mesmos leitores. Sem a marca, Alfa vem primeiro (título). Beto e Carla marcam Zeta; Edu marca Alfa.
      const leitores = [
        { uid: BETO, marca: 'zeta' },
        { uid: CARLA, marca: 'zeta' },
        { uid: EDU, marca: 'alfa' },
      ]
      for (const { uid, marca: alvo } of leitores) {
        await como(uid, async () => {
          const serie = await serieDe(`Série ${uid.slice(0, 4)}`)
          const z = await salvar({ titulo: 'Zeta', obra_chave: 'zeta|1|hq', serie_id: serie, numero_volume: 1, nota: 4, lido_em: '2026-03-01' })
          const a = await salvar({ titulo: 'Alfa', obra_chave: 'alfa|1|hq', serie_id: serie, numero_volume: 2, nota: 4, lido_em: '2026-03-01' })
          await marcar(alvo === 'zeta' ? z : a)
        })
      }
      // Gui não compartilha notas: sua marca e sua nota não contam.
      await como(GUI, async () => {
        const serie = await serieDe('Série gui')
        const z = await salvar({ titulo: 'Zeta', obra_chave: 'zeta|1|hq', serie_id: serie, numero_volume: 1, nota: 5, lido_em: '2026-03-01' })
        await salvar({ titulo: 'Alfa', obra_chave: 'alfa|1|hq', serie_id: serie, numero_volume: 2, nota: 5, lido_em: '2026-03-01' })
        await marcar(z)
      })
      // Ana leu os dois; marcou Zeta.
      const sa = await serieDe('Série ana')
      const za = await salvar({ titulo: 'Zeta', obra_chave: 'zeta|1|hq', serie_id: sa, numero_volume: 1, nota: 2 })
      await salvar({ titulo: 'Alfa', obra_chave: 'alfa|1|hq', serie_id: sa, numero_volume: 2, nota: 2 })
      await marcar(za)

      const rank = async (ordem: string) =>
        (await db.query<Record<string, unknown>>(`select * from ranking_amigos(null, null, null, $1, false, 30, 0)`, [ordem])).rows
      for (const ordem of ['nota', 'media']) {
        const linhas = (await rank(ordem)).filter((l) => l.titulo === 'Zeta' || l.titulo === 'Alfa')
        expect(linhas.map((l) => l.titulo)).toEqual(['Zeta', 'Alfa'])
        expect(linhas[0]).toMatchObject({ n: 3, n_melhor: 2, meu_melhor: true })
        expect(linhas[1]).toMatchObject({ n: 3, n_melhor: 1, meu_melhor: false })
      }
      // `lidos` e `recentes` não mudam: Alfa vem antes de Zeta pelo título (tudo o mais igual).
      const porLidos = (await rank('lidos')).filter((l) => l.titulo === 'Zeta' || l.titulo === 'Alfa')
      expect(porLidos.map((l) => l.titulo)).toEqual(['Alfa', 'Zeta'])
      // meu_melhor só vale com o meu item lido: volta a comprado e a marca de Ana cai (e some do retorno)
      await db.query(`update itens set estado = 'comprado' where id = $1`, [za])
      const depois = (await rank('nota')).find((l) => l.titulo === 'Zeta')!
      expect(depois.meu_melhor).toBe(false)
    })
  })

  it('a 0030 não toca nas migrations 0001–0029 (nenhuma menção ao nome novo)', () => {
    for (const f of ['0023_ranking_amigos', '0024_spoiler_na_critica', '0029_leituras_blindar_update']) {
      expect(readFileSync(path.join(PASTA, `${f}.sql`), 'utf8')).not.toContain('melhor_da_serie')
    }
  })
})

describe('notificações (migration 0033)', () => {
  // Ana (U, dona dos posts), Beto (amigo), Caio (desconhecido) e Dani (pede amizade a Ana).
  const CAIO = '88888888-8888-8888-8888-888888888888'
  const DANI = '66666666-6666-6666-6666-666666666666'
  const como = async <T,>(uid: string, fn: () => Promise<T>): Promise<T> => {
    await db.query(`select set_config('app.uid','${uid}',false)`)
    try {
      return await fn()
    } finally {
      await db.query(`select set_config('app.uid','${U}',false)`)
    }
  }
  const admin = async (sql: string) => {
    await db.query(`reset role`)
    try {
      await db.exec(sql)
    } finally {
      await db.query(`set role authenticated`)
    }
  }
  const lido = async (titulo: string) =>
    (await db.query<{ id: string }>(`select item_salvar(null, $1::jsonb, '{}') id`, [JSON.stringify({ titulo, tipo: 'hq', estado: 'lido', prioridade: 0 })])).rows[0].id
  const lista = async () => (await db.query<Record<string, unknown>>(`select * from notificacoes_listar()`)).rows
  const naoLidas = async () => (await db.query<{ n: number }>(`select notificacoes_contar_nao_lidas() n`)).rows[0].n
  const doTipo = async (tipo: string) => (await lista()).filter((r) => r.tipo === tipo)
  /** Conta as linhas como superusuário: como `authenticated` a RLS sem política esconde tudo. */
  const total = async () => {
    await db.query(`reset role`)
    try {
      return Number((await db.query<{ n: string }>(`select count(*) n from notificacoes`)).rows[0].n)
    } finally {
      await db.query(`set role authenticated`)
    }
  }

  beforeAll(async () => {
    await admin(`
      insert into auth.users values ('${CAIO}'), ('${DANI}') on conflict do nothing;
      delete from notificacoes; delete from amizades; delete from itens; delete from series; delete from perfis;
      insert into perfis(user_id, apelido, nome_exibicao) values ('${U}', 'ana', 'Ana'), ('${OUTRO}', 'beto', 'Beto'), ('${CAIO}', 'caio', null), ('${DANI}', 'dani', 'Dani');
    `)
    // Beto é amigo de Ana (aceito); o pedido dele já gerou aviso para Ana, que limpamos para os testes de feed.
    const idBeto = await como(OUTRO, async () => (await db.query<{ id: string }>(`select amizade_solicitar('ana') id`)).rows[0].id)
    await db.query(`select amizade_responder($1, true)`, [idBeto])
    await db.query(`select feed_configurar(true)`)
    await admin(`delete from notificacoes`)
  })

  it('as tabelas não têm acesso direto e ninguém lê o aviso alheio', async () => {
    const id = await lido('Decomposição')
    await como(OUTRO, () => db.query(`select feed_curtir($1)`, [id]))
    expect(await naoLidas()).toBe(1)
    // O grant em bloco do teste devolve privilégio de tabela; o que vale é a RLS sem política (nenhuma linha).
    expect((await db.query(`select * from notificacoes`)).rows).toHaveLength(0)
    // Beto (o autor) e Caio não veem o aviso de Ana.
    await como(OUTRO, async () => {
      expect(await lista()).toHaveLength(0)
      expect(await naoLidas()).toBe(0)
    })
    await como(CAIO, async () => expect(await lista()).toHaveLength(0))
    // E não conseguem marcá-lo como lido.
    await como(OUTRO, () => db.query(`select notificacoes_marcar_lidas(null)`))
    expect(await naoLidas()).toBe(1)
    await db.query(`select notificacoes_marcar_lidas(null)`)
    await admin(`delete from notificacoes; delete from feed_curtidas`)
  })

  it('curtida: uma só por autor e item, a própria não notifica, descurtir remove a não lida', async () => {
    const id = await lido('Curtida')
    await db.query(`select feed_curtir($1)`, [id]) // a própria
    expect(await total()).toBe(0)
    await como(OUTRO, async () => {
      await db.query(`select feed_curtir($1)`, [id])
      await db.query(`select feed_curtir($1)`, [id]) // repetida
    })
    const [n] = await doTipo('curtida')
    expect(await total()).toBe(1)
    expect(n).toMatchObject({ autor_apelido: 'beto', autor_nome: 'Beto', titulo: 'Curtida', lida: false })
    // Só ids e nomes: nenhuma coluna de nota, crítica ou texto.
    expect(Object.keys(n).sort()).toEqual(['autor_apelido', 'autor_nome', 'criado_em', 'id', 'item_id', 'lida', 'numero_volume', 'serie_nome', 'tipo', 'titulo'])
    // Descurtir remove a não lida; curtir de novo cria outra (uma só).
    await como(OUTRO, () => db.query(`select feed_descurtir($1)`, [id]))
    expect(await total()).toBe(0)
    await como(OUTRO, () => db.query(`select feed_curtir($1)`, [id]))
    expect(await total()).toBe(1)
    // Depois de lida, descurtir e curtir de novo NÃO gera aviso novo e a lida fica.
    await db.query(`select notificacoes_marcar_lidas(null)`)
    expect(await naoLidas()).toBe(0)
    await como(OUTRO, async () => {
      await db.query(`select feed_descurtir($1)`, [id])
      await db.query(`select feed_curtir($1)`, [id])
    })
    expect(await total()).toBe(1)
    expect(await naoLidas()).toBe(0)
  })

  it('comentário: um por comentário, sem o texto; apagar remove a não lida; desconhecido não consegue comentar', async () => {
    const id = await lido('Conversa')
    await db.query(`select feed_comentar($1, 'eu mesma')`, [id])
    expect(await total()).toBe(1) // só a curtida do teste anterior (lida)
    const c1 = await como(OUTRO, async () => (await db.query<{ c: string }>(`select feed_comentar($1, 'Segredo do final!') c`, [id])).rows[0].c)
    await como(OUTRO, () => db.query(`select feed_comentar($1, 'Outro')`, [id]))
    const novos = await doTipo('comentario')
    expect(novos).toHaveLength(2)
    expect(JSON.stringify(novos)).not.toContain('Segredo')
    expect(await naoLidas()).toBe(2)
    await como(OUTRO, () => db.query(`select feed_apagar_comentario($1)`, [c1]))
    expect(await doTipo('comentario')).toHaveLength(1)
    // O comentário já lido fica como histórico mesmo se apagado.
    await db.query(`select notificacoes_marcar_lidas(null)`)
    const [resto] = await como(OUTRO, async () => (await db.query<{ id: string }>(`select id from feed_comentarios_listar($1) where meu`, [id])).rows)
    await como(OUTRO, () => db.query(`select feed_apagar_comentario($1)`, [resto.id]))
    expect(await doTipo('comentario')).toHaveLength(1)
    await como(CAIO, () => expect(db.query(`select feed_comentar($1, 'oi')`, [id])).rejects.toThrow('item_nao_encontrado'))
    expect(await doTipo('comentario')).toHaveLength(1)
  })

  it('só notifica quem podia ver o item e some se o item sai do feed', async () => {
    const id = await lido('Oculto depois')
    await como(OUTRO, () => db.query(`select feed_curtir($1)`, [id]))
    expect(await naoLidas()).toBe(1)
    await db.query(`select feed_ocultar($1, true)`, [id])
    expect(await naoLidas()).toBe(0)
    expect((await lista()).map((r) => r.titulo)).not.toContain('Oculto depois')
    await db.query(`select feed_ocultar($1, false)`, [id])
    expect(await naoLidas()).toBe(1)
    // Item oculto: o amigo nem consegue curtir, então nada é criado.
    const escondido = await lido('Escondido')
    await db.query(`select feed_ocultar($1, true)`, [escondido])
    const antes = await total()
    await como(OUTRO, () => expect(db.query(`select feed_curtir($1)`, [escondido])).rejects.toThrow('item_nao_encontrado'))
    expect(await total()).toBe(antes)
    // Ex-amigo: o aviso antigo some da lista.
    const idAmizade = (await db.query<{ amizade_id: string }>(`select amizade_id from amigos_listar() where apelido = 'beto'`)).rows[0].amizade_id
    await db.query(`select amizade_desfazer($1)`, [idAmizade])
    expect(await naoLidas()).toBe(0)
    const novo = await como(OUTRO, async () => (await db.query<{ id: string }>(`select amizade_solicitar('ana') id`)).rows[0].id)
    await db.query(`select amizade_responder($1, true)`, [novo])
    expect(await naoLidas()).toBe(1)
  })

  it('amizade: pedido avisa o destinatário, aceite avisa quem pediu, recusa remove o aviso, convite avisa quem o gerou', async () => {
    await admin(`delete from notificacoes`)
    const pedido = await como(DANI, async () => (await db.query<{ id: string }>(`select amizade_solicitar('ana') id`)).rows[0].id)
    const [p] = await doTipo('amizade_pedido')
    expect(p).toMatchObject({ autor_apelido: 'dani', item_id: null, lida: false })
    await como(DANI, async () => expect(await lista()).toHaveLength(0)) // quem pediu não recebe
    // Recusar remove o aviso não lido.
    await db.query(`select amizade_responder($1, false)`, [pedido])
    expect(await total()).toBe(0)
    // Pede de novo e Ana aceita: o aviso do pedido sai e Dani recebe "aceitou".
    const pedido2 = await como(DANI, async () => (await db.query<{ id: string }>(`select amizade_solicitar('ana') id`)).rows[0].id)
    expect(await doTipo('amizade_pedido')).toHaveLength(1)
    await db.query(`select amizade_responder($1, true)`, [pedido2])
    expect(await doTipo('amizade_pedido')).toHaveLength(0)
    await como(DANI, async () => {
      const [a] = await doTipo('amizade_aceita')
      expect(a).toMatchObject({ autor_apelido: 'ana', lida: false })
      expect(await naoLidas()).toBe(1)
    })
    // Convite por link: a amizade nasce aceita e quem gerou o convite (Caio) é avisado.
    const codigo = await como(CAIO, async () => (await db.query<{ c: string }>(`select convite_gerar() c`)).rows[0].c)
    await db.query(`select convite_aceitar($1)`, [codigo])
    await como(CAIO, async () => expect((await doTipo('amizade_aceita'))[0]).toMatchObject({ autor_apelido: 'ana' }))
    // "Pedir de volta" também é um aceite: Ana pede a Caio? Já são amigos; usa outro par (Beto ↔ Dani).
    const bd = await como(OUTRO, async () => (await db.query<{ id: string }>(`select amizade_solicitar('dani') id`)).rows[0].id)
    await como(DANI, async () => expect(await doTipo('amizade_pedido')).toHaveLength(1))
    await como(DANI, () => db.query(`select amizade_solicitar('beto')`)) // aceita pedindo de volta
    await como(DANI, async () => expect(await doTipo('amizade_pedido')).toHaveLength(0))
    await como(OUTRO, async () => expect((await doTipo('amizade_aceita')).map((r) => r.autor_apelido)).toContain('dani'))
    expect(bd).toBeTruthy()
  })

  it('0034: o aviso "aceitou seu pedido" de quem desfez a amizade some da lista e do contador (e volta se fizerem as pazes)', async () => {
    // Dani e Ana já são amigas (teste anterior). Dani aceitou um pedido de Ana: Ana tem o aviso "Dani aceitou".
    const amizadeAtual = async () => (await db.query<{ id: string }>(`select id from amizades where status = 'aceita' and ((solicitante = '${U}' and destinatario = '${DANI}') or (solicitante = '${DANI}' and destinatario = '${U}'))`)).rows
    await admin(`delete from notificacoes; insert into notificacoes (user_id, tipo, autor_id, ref_id) values ('${U}', 'amizade_aceita', '${DANI}', gen_random_uuid())`)
    expect((await amizadeAtual()).length).toBe(1)
    expect((await doTipo('amizade_aceita')).map((r) => r.autor_apelido)).toEqual(['dani'])
    expect(await naoLidas()).toBe(1)
    // Ana desfaz a amizade: o aviso deixa de aparecer, e a lista e o contador concordam.
    await db.query(`select amizade_desfazer($1)`, [(await amizadeAtual())[0].id])
    expect(await doTipo('amizade_aceita')).toHaveLength(0)
    expect(await lista()).toHaveLength(0)
    expect(await naoLidas()).toBe(0)
    // A linha continua no banco (só fica escondida).
    expect(await total()).toBe(1)
    // O pedido de amizade de quem ainda não é amigo continua aparecendo, na lista e no contador.
    await como(DANI, () => db.query(`select amizade_solicitar('ana')`))
    expect((await doTipo('amizade_pedido')).map((r) => r.autor_apelido)).toEqual(['dani'])
    expect(await naoLidas()).toBe(1)
    expect((await lista()).filter((r) => !r.lida)).toHaveLength(await naoLidas())
    // Fazem as pazes (Ana aceita o pedido): o aviso antigo volta a valer; lista e contador seguem iguais.
    const pedido = (await db.query<{ id: string }>(`select id from amizades where status = 'pendente'`)).rows[0].id
    await db.query(`select amizade_responder($1, true)`, [pedido])
    expect((await amizadeAtual()).length).toBe(1)
    expect((await doTipo('amizade_aceita')).map((r) => r.autor_apelido)).toEqual(['dani'])
    expect((await lista()).filter((r) => !r.lida)).toHaveLength(await naoLidas())
    await admin(`delete from notificacoes`)
  })

  it('marcar como lida: por ids ou todas, só as próprias; contador acompanha', async () => {
    await admin(`delete from notificacoes`)
    const a = await lido('Lida 1')
    const b = await lido('Lida 2')
    await como(OUTRO, async () => {
      await db.query(`select feed_curtir($1)`, [a])
      await db.query(`select feed_curtir($1)`, [b])
    })
    expect(await naoLidas()).toBe(2)
    const [primeira] = await lista()
    await como(OUTRO, async () => expect((await db.query<{ n: number }>(`select notificacoes_marcar_lidas(array[$1]::uuid[]) n`, [primeira.id])).rows[0].n).toBe(0))
    expect(await naoLidas()).toBe(2)
    expect((await db.query<{ n: number }>(`select notificacoes_marcar_lidas(array[$1]::uuid[]) n`, [primeira.id])).rows[0].n).toBe(1)
    expect(await naoLidas()).toBe(1)
    expect((await db.query<{ n: number }>(`select notificacoes_marcar_lidas(null) n`)).rows[0].n).toBe(1)
    expect(await naoLidas()).toBe(0)
    // Lidas há mais de 90 dias são apagadas na próxima marcação.
    await admin(`update notificacoes set lida_em = now() - interval '91 days'`)
    await db.query(`select notificacoes_marcar_lidas(null)`)
    expect(await total()).toBe(0)
  })

  it('apagar a conta ou o item do autor leva os avisos junto; sem login nada funciona', async () => {
    const id = await lido('Efêmero')
    await como(OUTRO, () => db.query(`select feed_curtir($1)`, [id]))
    expect(await total()).toBe(1)
    await admin(`delete from itens where id = '${id}'`)
    expect(await total()).toBe(0)
    await db.query(`select set_config('app.uid','',false)`)
    expect(await lista()).toHaveLength(0)
    expect(await naoLidas()).toBe(0)
    await expect(db.query(`select notificacoes_marcar_lidas(null)`)).rejects.toThrow('nao_autenticado')
    await db.query(`select set_config('app.uid','${U}',false)`)
  })

  describe('Web Push: assinaturas e preferências', () => {
    const assinar = (endpoint: string, ua = 'iPhone') => db.query(`select push_assinar($1, 'chave-p256dh', 'chave-auth', $2)`, [endpoint, ua])
    const meus = async () => (await db.query<{ endpoint: string }>(`select endpoint from push_assinaturas order by endpoint`)).rows.map((r) => r.endpoint)

    it('cada um vê só as suas; reassinar o mesmo aparelho não duplica; endpoint inválido é recusado', async () => {
      await admin(`delete from push_assinaturas; delete from push_preferencias`)
      await assinar('https://fcm.googleapis.com/fcm/send/a')
      await assinar('https://fcm.googleapis.com/fcm/send/a')
      await como(OUTRO, async () => {
        await assinar('https://fcm.googleapis.com/fcm/send/b')
        expect(await meus()).toEqual(['https://fcm.googleapis.com/fcm/send/b'])
      })
      expect(await meus()).toEqual(['https://fcm.googleapis.com/fcm/send/a'])
      await expect(assinar('http://inseguro/x')).rejects.toThrow('push_assinatura_invalida')
      await expect(assinar('https://push.exemplo/a')).rejects.toThrow('push_assinatura_invalida')
      await expect(db.query(`select push_assinar('https://x/y', '', 'a', null)`)).rejects.toThrow('push_assinatura_invalida')
      // Mesmo aparelho, outra conta: a assinatura muda de dono.
      await como(OUTRO, () => assinar('https://fcm.googleapis.com/fcm/send/a'))
      expect(await meus()).toEqual([])
      // Desassinar só mexe na própria.
      await db.query(`select push_desassinar('https://fcm.googleapis.com/fcm/send/b')`)
      await como(OUTRO, async () => expect(await meus()).toEqual(['https://fcm.googleapis.com/fcm/send/a', 'https://fcm.googleapis.com/fcm/send/b']))
      await como(OUTRO, () => db.query(`select push_desassinar('https://fcm.googleapis.com/fcm/send/b')`))
      await como(OUTRO, async () => expect(await meus()).toEqual(['https://fcm.googleapis.com/fcm/send/a']))
    })

    it('0034: só aceita endpoint https dos serviços de push dos navegadores (os 4 passam; http, IP, localhost e host parecido não)', async () => {
      await admin(`delete from push_assinaturas; delete from push_preferencias`)
      const validos = [
        'https://fcm.googleapis.com/fcm/send/abc',
        'https://updates.push.services.mozilla.com/wpush/v2/abc',
        'https://web.push.apple.com/QGxyz',
        'https://wns2-by3p.notify.windows.com/w/?token=abc',
        'https://FCM.googleapis.com:443/fcm/send/maiuscula',
      ]
      for (const e of validos) await assinar(e)
      expect(await meus()).toHaveLength(validos.length)
      const invalidos = [
        'http://fcm.googleapis.com/fcm/send/abc',
        'https://142.250.1.1/fcm/send/abc',
        'https://10.0.0.5/x',
        'https://[::1]/x',
        'https://localhost/x',
        'https://localhost:3000/x',
        'https://fcm.googleapis.com.evil.com/fcm/send/abc',
        'https://evilfcm.googleapis.com/x',
        'https://web.push.apple.com.evil.com/x',
        'https://push.apple.com/x',
        'https://xpush.apple.com/x',
        'https://fcm.googleapis.com@evil.com/x',
        'https://user:pass@fcm.googleapis.com/x',
        'https://fcm.googleapis.com:8443/x',
        'https://example.com/push',
        'ftp://fcm.googleapis.com/x',
        '',
      ]
      for (const e of invalidos) await expect(assinar(e), e).rejects.toThrow('push_assinatura_invalida')
      expect(await meus()).toHaveLength(validos.length)
    })

    it('preferências: padrão ligado ao assinar; cada pessoa só lê e altera as suas', async () => {
      await admin(`delete from push_assinaturas; delete from push_preferencias`)
      await assinar('https://fcm.googleapis.com/fcm/send/c')
      const { rows } = await db.query<Record<string, boolean>>(`select * from push_preferencias`)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ notif_push_curtidas: true, notif_push_comentarios: true, notif_push_amizades: true })
      await db.query(`select push_preferencias_definir(false, true, false)`)
      expect((await db.query<Record<string, boolean>>(`select * from push_preferencias`)).rows[0]).toMatchObject({ notif_push_curtidas: false, notif_push_comentarios: true, notif_push_amizades: false })
      await como(OUTRO, async () => expect((await db.query(`select * from push_preferencias`)).rows).toHaveLength(0))
      await expect(db.query(`select push_preferencias_definir(null, true, true)`)).rejects.toThrow('valor_invalido')
    })
  })

  it('a 0034 não altera migrations anteriores e não mexe em tabelas (só create or replace de duas funções)', () => {
    const sql = readFileSync(path.join(PASTA, '0034_push_endpoint_e_aviso_de_ex_amigo.sql'), 'utf8')
    expect(sql).not.toMatch(/\b(create|alter|drop)\s+table\b/i)
    expect(sql).not.toMatch(/\bdrop\s+function\b/i)
    expect(readFileSync(path.join(PASTA, '0033_notificacoes.sql'), 'utf8')).toContain("p_endpoint !~ '^https://'") // a 0033 segue como foi aplicada
  })

  it('a 0033 não altera as migrations anteriores (nenhuma menção ao nome novo)', () => {
    for (const f of ['0014_amigos_presentes_emprestimos', '0018_feed_amigos', '0031_feed_desfazer_e_nota_do_grupo', '0032_feed_capa_do_melhor_volume']) {
      expect(readFileSync(path.join(PASTA, `${f}.sql`), 'utf8')).not.toContain('notificacoes')
    }
  })
})
