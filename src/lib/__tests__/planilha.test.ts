import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'
import {
  casarLinha,
  chaveIsbn,
  dividirValores,
  gerarCsvDaColecao,
  isbnParaPlanilha,
  limparCelula,
  linhaDeExportacao,
  linhaPlanilhaSchema,
  neutralizarFormula,
  normalizarDataPlanilha,
  normalizarNotaPlanilha,
  planejarAtualizacao,
  validarLinhaNova,
  COLUNAS_PLANILHA,
  type ItemAtual,
  type ItemParaExportar,
} from '@/lib/planilha'

const ID = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'
const ID_DE_OUTRO = '99999999-9999-4999-8999-999999999999'
// ISBNs reais com dígito verificador certo.
const ISBN13 = '9788535902778'
const ISBN10 = '8535902775'

function item(extra: Partial<ItemAtual> = {}): ItemAtual {
  return {
    id: ID,
    titulo: 'Batman #1',
    numero_volume: 1,
    tipo: 'hq',
    isbn: null,
    estado: 'comprado',
    nota: null,
    critica: null,
    lido_em: null,
    capa_url: null,
    serie_id: 'serie-1',
    serieNome: 'Batman',
    tags: [],
    ...extra,
  }
}

describe('isbn válidos para o teste', () => {
  it('os ISBNs de teste são válidos', () => {
    expect(chaveIsbn(ISBN13)).toBe(ISBN13)
    expect(chaveIsbn(ISBN10)).toBe(ISBN13)
  })
})

describe('casarLinha', () => {
  const porId = new Map([[ID, item()]])
  const porIsbn = new Map<string, ItemAtual[]>([[ISBN13, [item({ id: ID2 })]]])

  it('id de um item do usuário vira atualização', () => {
    const r = casarLinha({ id: ID }, porId, porIsbn)
    expect(r).toMatchObject({ tipo: 'atualizar', item: { id: ID } })
  })
  it('id é comparado sem diferenciar caixa', () => {
    expect(casarLinha({ id: ID.toUpperCase() }, porId, porIsbn).tipo).toBe('atualizar')
  })
  it('id de terceiro (ou inexistente) é recusado, sem virar item novo', () => {
    const r = casarLinha({ id: ID_DE_OUTRO, titulo: 'Qualquer' }, porId, porIsbn)
    expect(r).toEqual({ tipo: 'erro', motivo: expect.stringContaining('id não encontrado') })
  })
  it('id que não é uuid é recusado', () => {
    expect(casarLinha({ id: 'abc' }, porId, porIsbn).tipo).toBe('erro')
    expect(casarLinha({ id: "1' or '1'='1" }, porId, porIsbn).tipo).toBe('erro')
  })
  it('com id, o ISBN não decide o casamento', () => {
    const r = casarLinha({ id: ID, isbn: ISBN13 }, porId, porIsbn)
    expect(r).toMatchObject({ tipo: 'atualizar', item: { id: ID } })
  })
  it('sem id, casa pelo ISBN (ISBN-10 e hífens equivalem ao ISBN-13)', () => {
    expect(casarLinha({ isbn: ISBN10 }, porId, porIsbn)).toMatchObject({ tipo: 'atualizar', item: { id: ID2 } })
    expect(casarLinha({ isbn: '978-85-359-0277-8' }, porId, porIsbn)).toMatchObject({ tipo: 'atualizar', item: { id: ID2 } })
  })
  it('sem id e ISBN desconhecido (ou vazio) é item novo', () => {
    expect(casarLinha({ isbn: '9780306406157' }, porId, porIsbn)).toEqual({ tipo: 'novo' })
    expect(casarLinha({ titulo: 'X' }, porId, porIsbn)).toEqual({ tipo: 'novo' })
  })
  it('ISBN inválido (inventado por IA) é erro, não item novo', () => {
    const r = casarLinha({ isbn: '9788535902779' }, porId, porIsbn)
    expect(r).toEqual({ tipo: 'erro', motivo: expect.stringContaining('inválido') })
  })
  it('ISBN que casa com 2 itens seus exige o id', () => {
    const dois = new Map([[ISBN13, [item(), item({ id: ID2 })]]])
    expect(casarLinha({ isbn: ISBN13 }, porId, dois)).toEqual({ tipo: 'erro', motivo: expect.stringContaining('id') })
  })
})

describe('planejarAtualizacao', () => {
  it('preenche o ISBN vazio e normaliza para ISBN-13', () => {
    const r = planejarAtualizacao({ id: ID, isbn: '85-359-0277-5' }, item())
    expect(r.ok && r.plano.campos).toEqual({ isbn: ISBN13 })
    expect(r.ok && r.plano.mudancas).toEqual([{ campo: 'isbn', antes: '—', depois: ISBN13 }])
  })
  it('célula vazia nunca apaga', () => {
    const atual = item({ isbn: ISBN13, nota: 4, critica: 'bom', estado: 'lido', lido_em: '2026-01-02', tags: [{ nome: 'Panini', tipo: 'editora' }] })
    const vazia = Object.fromEntries(COLUNAS_PLANILHA.map((c) => [c, ''])) as Record<string, string>
    const r = planejarAtualizacao({ ...vazia, id: ID }, atual)
    expect(r).toMatchObject({ ok: true, plano: { campos: {}, tagsNovas: [], mudancas: [] } })
  })
  it('valor igual ao atual não é mudança (e ISBN com hífen é o mesmo ISBN)', () => {
    const atual = item({ isbn: ISBN13, titulo: 'Batman #1', nota: 4.5 })
    const r = planejarAtualizacao({ id: ID, titulo: 'Batman #1', isbn: isbnParaPlanilha(ISBN13), nota: '4,5', numero_volume: '1', tipo: 'HQ' }, atual)
    expect(r).toMatchObject({ ok: true, plano: { campos: {}, mudancas: [] } })
  })
  it('só os campos diferentes entram, com antes → depois', () => {
    const r = planejarAtualizacao({ id: ID, titulo: 'Batman #1 (Capa dura)', nota: '4,5', numero_volume: '2' }, item({ nota: 3 }))
    expect(r.ok && r.plano.campos).toEqual({ titulo: 'Batman #1 (Capa dura)', nota: 4.5, numero_volume: 2 })
    expect(r.ok && r.plano.mudancas.map((m) => [m.campo, m.antes, m.depois])).toEqual([
      ['titulo', 'Batman #1', 'Batman #1 (Capa dura)'],
      ['numero_volume', '1', '2'],
      ['nota', '3', '4,5'],
    ])
  })
  it('valores inválidos recusam a linha inteira, sem aplicar o resto', () => {
    expect(planejarAtualizacao({ id: ID, titulo: 'Novo', isbn: '9788535902779' }, item()).ok).toBe(false)
    expect(planejarAtualizacao({ id: ID, nota: '7' }, item()).ok).toBe(false)
    expect(planejarAtualizacao({ id: ID, nota: '4,3' }, item()).ok).toBe(false)
    expect(planejarAtualizacao({ id: ID, tipo: 'foguete' }, item()).ok).toBe(false)
    expect(planejarAtualizacao({ id: ID, estado: 'talvez' }, item()).ok).toBe(false)
    expect(planejarAtualizacao({ id: ID, numero_volume: 'abc' }, item()).ok).toBe(false)
    expect(planejarAtualizacao({ id: ID, lido_em: '31/02/2026', estado: 'lido' }, item()).ok).toBe(false)
  })
  it('ISBN legado inválido que não foi mexido não trava a linha', () => {
    const atual = item({ isbn: '123-abc' })
    const r = planejarAtualizacao({ id: ID, isbn: '123-abc', titulo: 'Outro' }, atual)
    expect(r).toMatchObject({ ok: true, plano: { campos: { titulo: 'Outro' } } })
  })
  it('item lido não volta para outro estado pela planilha (só avisa)', () => {
    const r = planejarAtualizacao({ id: ID, estado: 'desejo' }, item({ estado: 'lido' }))
    expect(r.ok && r.plano.campos).toEqual({})
    expect(r.ok && r.plano.avisos[0]).toContain('estado')
  })
  it('lido_em só vale para item lido', () => {
    const naoLido = planejarAtualizacao({ id: ID, lido_em: '2026-03-04' }, item())
    expect(naoLido.ok && naoLido.plano.campos).toEqual({})
    expect(naoLido.ok && naoLido.plano.avisos.length).toBe(1)
    const lido = planejarAtualizacao({ id: ID, lido_em: '04/03/2026' }, item({ estado: 'lido', lido_em: '2026-01-01' }))
    expect(lido.ok && lido.plano.campos).toEqual({ lido_em: '2026-03-04' })
    // virando lido na mesma linha, a data vale
    const virando = planejarAtualizacao({ id: ID, estado: 'lido', lido_em: '2026-03-04' }, item())
    expect(virando.ok && virando.plano.campos).toEqual({ estado: 'lido', lido_em: '2026-03-04' })
  })
  it('a série não é trocada pela planilha', () => {
    const r = planejarAtualizacao({ id: ID, serie: 'Superman' }, item())
    expect(r.ok && r.plano.campos).toEqual({})
    expect(r.ok && r.plano.avisos[0]).toContain('serie')
    const igual = planejarAtualizacao({ id: ID, serie: ' batman ' }, item())
    expect(igual.ok && igual.plano.avisos).toEqual([])
  })
  it('tags: só acrescenta, não troca editora existente e não repete', () => {
    const atual = item({ tags: [{ nome: 'Panini', tipo: 'editora' }, { nome: 'Batman', tipo: 'personagem' }] })
    const r = planejarAtualizacao({ id: ID, editora: 'JBC', personagem: 'batman; Robin', autor: 'Frank Miller', tags_extra: 'capa dura; Favorito' }, atual)
    expect(r.ok && r.plano.tagsNovas).toEqual([
      { nome: 'Robin', tipo: 'personagem' },
      { nome: 'Frank Miller', tipo: 'autor' },
      { nome: 'capa dura', tipo: 'outro' },
      { nome: 'Favorito', tipo: 'outro' },
    ])
    expect(r.ok && r.plano.avisos.some((a) => a.startsWith('editora'))).toBe(true)
  })
  it('preenche editora quando o item não tem nenhuma', () => {
    const r = planejarAtualizacao({ id: ID, editora: 'Panini' }, item())
    expect(r.ok && r.plano.tagsNovas).toEqual([{ nome: 'Panini', tipo: 'editora' }])
  })
  it('apóstrofo de neutralização é removido antes de comparar', () => {
    const r = planejarAtualizacao({ id: ID, titulo: "'=Zero" }, item({ titulo: '=Zero' }))
    expect(r.ok && r.plano.campos).toEqual({})
  })
})

describe('validarLinhaNova', () => {
  it('vazio vira o padrão (hq, comprado) e monta o título da série', () => {
    const r = validarLinhaNova({ serie: 'Batman', numero_volume: '3' })
    expect(r).toMatchObject({ ok: true, dados: { tipo: 'hq', estado: 'comprado', titulo: 'Batman #3', numeroVolume: 3 } })
  })
  it('recusa ISBN inválido, nota fora da régua, tipo desconhecido e linha sem título', () => {
    expect(validarLinhaNova({ titulo: 'X', isbn: '9788535902779' }).ok).toBe(false)
    expect(validarLinhaNova({ titulo: 'X', nota: '9' }).ok).toBe(false)
    expect(validarLinhaNova({ titulo: 'X', tipo: 'foguete' }).ok).toBe(false)
    expect(validarLinhaNova({ estado: 'lido' }).ok).toBe(false)
  })
  it('normaliza ISBN-10 para ISBN-13', () => {
    const r = validarLinhaNova({ titulo: 'X', isbn: ISBN10 })
    expect(r.ok && r.dados.isbn).toBe(ISBN13)
  })
})

describe('linhaPlanilhaSchema', () => {
  it('limita o tamanho das células', () => {
    expect(linhaPlanilhaSchema.safeParse({ critica: 'a'.repeat(2001) }).success).toBe(false)
    expect(linhaPlanilhaSchema.safeParse({ id: 'a'.repeat(65) }).success).toBe(false)
    expect(linhaPlanilhaSchema.safeParse({ titulo: 'ok' }).success).toBe(true)
  })
})

describe('exportação', () => {
  const exemplo: ItemParaExportar = {
    id: ID,
    titulo: 'Batman: Ano Um',
    numero_volume: 1.5,
    tipo: 'hq',
    isbn: ISBN13,
    estado: 'lido',
    nota: 4.5,
    lido_em: '2026-03-04',
    critica: 'Clássico; "imperdível"\nsegunda linha',
    serieNome: 'Batman',
    tags: [
      { nome: 'Panini', tipo: 'editora' },
      { nome: 'Robin', tipo: 'personagem' },
      { nome: 'Batman', tipo: 'personagem' },
      { nome: 'capa dura', tipo: 'outro' },
    ],
  }

  it('neutraliza células que começam com = + - @ (e tab/CR)', () => {
    for (const v of ['=1+1', '+55', '-2', '@SOMA(A1)', '\tX', '\rX']) expect(neutralizarFormula(v)).toBe(`'${v}`)
    expect(neutralizarFormula('Batman')).toBe('Batman')
    expect(neutralizarFormula('')).toBe('')
  })
  it('limparCelula desfaz a neutralização e só ela', () => {
    expect(limparCelula("'=1+1")).toBe('=1+1')
    expect(limparCelula("'Allen")).toBe("'Allen")
    expect(limparCelula('  x ')).toBe('x')
    expect(limparCelula(undefined)).toBe('')
  })
  it('exporta no layout do importador, com vírgula decimal e ISBN com hífen', () => {
    const linha = linhaDeExportacao(exemplo)
    expect(linha).toHaveLength(COLUNAS_PLANILHA.length)
    const por = Object.fromEntries(COLUNAS_PLANILHA.map((c, i) => [c, linha[i]]))
    expect(por).toMatchObject({
      id: ID,
      serie: 'Batman',
      numero_volume: '1,5',
      tipo: 'hq',
      isbn: '978-8535902778',
      editora: 'Panini',
      personagem: 'Robin; Batman',
      estado: 'lido',
      nota: '4,5',
      lido_em: '2026-03-04',
      tags_extra: 'capa dura',
    })
  })
  it('CSV: BOM, separador ;, e fórmula neutralizada em título e crítica', () => {
    const csv = gerarCsvDaColecao([
      exemplo,
      { ...exemplo, id: ID2, titulo: '=HYPERLINK("http://x")', critica: '@cmd', serieNome: null, isbn: null },
    ])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain(';')
    const lido = Papa.parse<string[]>(csv.slice(1), { delimiter: ';' }).data
    expect(lido[0]).toEqual([...COLUNAS_PLANILHA])
    const iTitulo = COLUNAS_PLANILHA.indexOf('titulo')
    const iCritica = COLUNAS_PLANILHA.indexOf('critica')
    expect(lido[1][iCritica]).toBe('Clássico; "imperdível"\nsegunda linha')
    expect(lido[2][iTitulo]).toBe(`'=HYPERLINK("http://x")`)
    expect(lido[2][iCritica]).toBe("'@cmd")
  })
  it('ida e volta: exportar e reimportar sem editar não muda nada', () => {
    const atual: ItemAtual = {
      ...exemplo,
      capa_url: null,
      serie_id: 's',
      tags: exemplo.tags,
      titulo: '-Zero: o começo',
      critica: '=cuidado',
    }
    const csv = gerarCsvDaColecao([atual])
    const [cab, dados] = Papa.parse<string[]>(csv.slice(1), { delimiter: ';' }).data
    const row = Object.fromEntries(cab.map((c, i) => [c, dados[i]]))
    const r = planejarAtualizacao(row, atual)
    expect(r).toMatchObject({ ok: true, plano: { campos: {}, tagsNovas: [], mudancas: [], avisos: [] } })
  })
})

describe('dividirValores, datas e notas', () => {
  it('divide por ; sem vazios nem repetidos', () => {
    expect(dividirValores('A; b ;; a ;C')).toEqual(['A', 'b', 'C'])
    expect(dividirValores(undefined)).toEqual([])
  })
  it('aceita AAAA-MM-DD e DD/MM/AAAA e recusa datas que não existem', () => {
    expect(normalizarDataPlanilha('2026-03-04')).toBe('2026-03-04')
    expect(normalizarDataPlanilha('4/3/2026')).toBe('2026-03-04')
    expect(normalizarDataPlanilha('2026-02-30')).toBeNull()
    expect(normalizarDataPlanilha('ontem')).toBeNull()
  })
  it('nota: meia estrela de 0,5 a 5', () => {
    expect(normalizarNotaPlanilha('4,5')).toBe(4.5)
    expect(normalizarNotaPlanilha('0')).toBeNull()
    expect(normalizarNotaPlanilha('5,5')).toBeNull()
    expect(normalizarNotaPlanilha('3,3')).toBeNull()
  })
})
