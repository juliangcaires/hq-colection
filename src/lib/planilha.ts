/**
 * Exportar a coleção em planilha e reimportar atualizando. Funções puras (sem banco): o casamento da linha
 * com um item, o diff "campo antigo → novo" e a geração do CSV. A leitura/gravação fica em `importar-itens.ts`.
 *
 * Regras que valem aqui:
 *  - célula vazia NUNCA apaga nada; só entra o que está preenchido E é diferente do que já existe;
 *  - nada é apagado por ausência na planilha;
 *  - a linha com qualquer valor inválido é recusada inteira (nada dela é aplicado), sem abortar as outras;
 *  - na exportação, célula que começa com `=`, `+`, `-`, `@` (ou tab/CR) ganha um `'` na frente (injeção de fórmula);
 *    na importação esse `'` é removido, para o ida-e-volta não alterar o texto.
 */
import Papa from 'papaparse'
import { z } from 'zod'
import { normalizarIsbn } from '@/lib/isbn'
import { normalizarChave, normalizarEstado, normalizarNumeroVolume, normalizarTipo } from '@/lib/csv-importacao'
import { parseNumeroPtBr } from '@/lib/numeros'
import type { EstadoItem, TipoObra, TipoTag } from '@/lib/types'

/** Tamanho máximo do arquivo aceito (o limite de 3000 linhas já cabe folgado em 2 MB). */
export const MAX_BYTES_PLANILHA = 2 * 1024 * 1024
/** Linhas por chamada da PRÉVIA (só lê: pode ser maior que o lote de gravação). */
export const LINHAS_POR_LOTE_PREVIA = 60

/** Ordem das colunas da planilha exportada; o importador lê todas pelo nome. */
export const COLUNAS_PLANILHA = [
  'id',
  'serie',
  'numero_volume',
  'tipo',
  'titulo',
  'isbn',
  'editora',
  'universo',
  'personagem',
  'selo',
  'autor',
  'estado',
  'nota',
  'lido_em',
  'tags_extra',
  'critica',
] as const

/** Campos de tag que a planilha entende, na ordem de exibição. `editora` e `selo` têm um valor só por item. */
const CAMPOS_TAG = ['editora', 'universo', 'personagem', 'selo', 'autor'] as const satisfies readonly TipoTag[]
const TAGS_DE_UM_VALOR: readonly string[] = ['editora', 'selo']

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type LinhaPlanilha = Partial<Record<(typeof COLUNAS_PLANILHA)[number], string | undefined>>

// ---------------------------------------------------------------------------------------------
// Células
// ---------------------------------------------------------------------------------------------

/** Neutraliza injeção de fórmula (Excel/Sheets executam célula que começa com = + - @). */
export function neutralizarFormula(valor: string): string {
  return /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor
}

/** Desfaz `neutralizarFormula` e apara as pontas: `'=SOMA(A1)` volta a `=SOMA(A1)`. */
export function limparCelula(valor: string | undefined | null): string {
  const t = (valor ?? '').trim()
  return /^'[=+\-@\t\r]/.test(t) ? t.slice(1) : t
}

/** Divide "A; B" em ["A", "B"] (sem vazios nem repetidos, ignorando caixa e acento). */
export function dividirValores(celula: string | undefined | null): string[] {
  const vistos = new Set<string>()
  const saida: string[] = []
  for (const parte of limparCelula(celula).split(';')) {
    const nome = parte.trim()
    const chave = normalizarChave(nome)
    if (!nome || vistos.has(chave)) continue
    vistos.add(chave)
    saida.push(nome)
  }
  return saida
}

/** ISBN-13 com hífen depois do prefixo: o Excel mantém como texto (sem hífen ele vira 9,78E+12 ao salvar). */
export function isbnParaPlanilha(isbn: string | null): string {
  if (!isbn) return ''
  const n = normalizarIsbn(isbn)
  return n ? `${n.slice(0, 3)}-${n.slice(3)}` : isbn.trim()
}

/** AAAA-MM-DD ou DD/MM/AAAA (ou D/M/AAAA) → AAAA-MM-DD; null se não for uma data real. */
export function normalizarDataPlanilha(bruto: string): string | null {
  const t = bruto.trim()
  let a: number, m: number, d: number
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(t)
  if (r) {
    a = Number(r[1])
    m = Number(r[2])
    d = Number(r[3])
  } else if ((r = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) {
    d = Number(r[1])
    m = Number(r[2])
    a = Number(r[3])
  } else {
    return null
  }
  const data = new Date(Date.UTC(a, m - 1, d))
  if (a < 1900 || data.getUTCFullYear() !== a || data.getUTCMonth() !== m - 1 || data.getUTCDate() !== d) return null
  return `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Nota de 0,5 a 5 em passos de meia estrela (mesma regra do banco); null se inválida. */
export function normalizarNotaPlanilha(bruto: string): number | null {
  const n = parseNumeroPtBr(bruto)
  if (n === null || n < 0.5 || n > 5 || n * 2 !== Math.trunc(n * 2)) return null
  return n
}

function numeroParaPlanilha(n: number | null): string {
  return n === null || n === undefined ? '' : String(n).replace('.', ',')
}

// ---------------------------------------------------------------------------------------------
// Linha lida do arquivo
// ---------------------------------------------------------------------------------------------

const texto = (max: number) => z.string().max(max, `texto longo demais (máximo ${max} caracteres)`).optional()

/** Uma linha como chega do navegador: tudo texto, com tetos de tamanho. */
export const linhaPlanilhaSchema = z.object({
  id: texto(64),
  titulo: texto(200),
  serie: texto(200),
  numero_volume: texto(20),
  tipo: texto(30),
  estado: texto(30),
  editora: texto(300),
  universo: texto(300),
  personagem: texto(300),
  selo: texto(80),
  autor: texto(300),
  isbn: texto(40),
  nota: texto(10),
  lido_em: texto(30),
  tags_extra: texto(500),
  critica: texto(2000),
})

// ---------------------------------------------------------------------------------------------
// Linha nova (sem item correspondente)
// ---------------------------------------------------------------------------------------------

export type DadosNovos = {
  titulo: string
  tipo: TipoObra
  estado: EstadoItem
  numeroVolume: number | null
  isbn: string | null
  nota: number | null
  lidoEm: string | null
}

/** Valida e normaliza uma linha que vai virar item novo. Vazio vira o padrão histórico (hq, comprado). */
export function validarLinhaNova(row: LinhaPlanilha): { ok: true; dados: DadosNovos } | { ok: false; motivo: string } {
  const tipo = normalizarTipo(limparCelula(row.tipo))
  if (!tipo) return { ok: false, motivo: `tipo "${row.tipo}" não reconhecido (use hq ou manga)` }
  const estado = normalizarEstado(limparCelula(row.estado))
  if (!estado) return { ok: false, motivo: `estado "${row.estado}" não reconhecido (use desejo, comprado ou lido)` }
  const numero = normalizarNumeroVolume(limparCelula(row.numero_volume))
  if (!numero.ok) return { ok: false, motivo: `numero_volume "${row.numero_volume}" não é um número` }

  const isbnBruto = limparCelula(row.isbn)
  let isbn: string | null = null
  if (isbnBruto) {
    isbn = normalizarIsbn(isbnBruto)
    if (!isbn) return { ok: false, motivo: `ISBN "${isbnBruto}" inválido (confira o dígito verificador)` }
  }

  const notaBruta = limparCelula(row.nota)
  let nota: number | null = null
  if (notaBruta) {
    nota = normalizarNotaPlanilha(notaBruta)
    if (nota === null) return { ok: false, motivo: `nota "${notaBruta}" inválida (use de 0,5 a 5, em meias estrelas)` }
  }

  const lidoBruto = limparCelula(row.lido_em)
  let lidoEm: string | null = null
  if (lidoBruto) {
    lidoEm = normalizarDataPlanilha(lidoBruto)
    if (!lidoEm) return { ok: false, motivo: `lido_em "${lidoBruto}" não é uma data (use AAAA-MM-DD ou DD/MM/AAAA)` }
  }

  const serie = limparCelula(row.serie)
  const titulo = limparCelula(row.titulo) || (serie ? `${serie}${numero.valor != null ? ` #${numero.valor}` : ''}` : '')
  if (!titulo) return { ok: false, motivo: 'sem título nem série — linha ignorada' }

  return { ok: true, dados: { titulo, tipo, estado, numeroVolume: numero.valor, isbn, nota, lidoEm } }
}

// ---------------------------------------------------------------------------------------------
// Casamento com os itens do usuário
// ---------------------------------------------------------------------------------------------

/** O item como está hoje no banco (somente itens do próprio usuário chegam aqui). */
export type ItemAtual = {
  id: string
  titulo: string
  numero_volume: number | null
  tipo: TipoObra
  isbn: string | null
  estado: EstadoItem
  nota: number | null
  critica: string | null
  lido_em: string | null
  capa_url: string | null
  serie_id: string | null
  serieNome: string | null
  /** Tags efetivas (do item + herdadas da série). */
  tags: { nome: string; tipo: TipoTag }[]
}

export type Casamento = { tipo: 'atualizar'; item: ItemAtual } | { tipo: 'novo' } | { tipo: 'erro'; motivo: string }

/** Chave de comparação de um ISBN: o ISBN-13 normalizado, ou o texto limpo quando não é um ISBN válido. */
export function chaveIsbn(isbn: string | null | undefined): string | null {
  const t = (isbn ?? '').trim()
  if (!t) return null
  return normalizarIsbn(t) ?? t.toUpperCase().replace(/[\s-]/g, '')
}

/**
 * Decide o que a linha é. `porId` e `porIsbn` só contêm itens DO USUÁRIO: um `id` que não está lá (inexistente ou
 * de outra pessoa) é recusado com a mesma mensagem, sem revelar qual dos dois é.
 */
export function casarLinha(
  row: LinhaPlanilha,
  porId: ReadonlyMap<string, ItemAtual>,
  porIsbn: ReadonlyMap<string, ItemAtual[]>
): Casamento {
  const id = limparCelula(row.id)
  if (id) {
    if (!UUID.test(id)) return { tipo: 'erro', motivo: `id "${id.slice(0, 40)}" não é um id válido` }
    const item = porId.get(id.toLowerCase())
    if (!item) return { tipo: 'erro', motivo: 'id não encontrado na sua coleção (linha ignorada)' }
    return { tipo: 'atualizar', item }
  }

  const isbnBruto = limparCelula(row.isbn)
  if (!isbnBruto) return { tipo: 'novo' }
  const isbn = normalizarIsbn(isbnBruto)
  if (!isbn) return { tipo: 'erro', motivo: `ISBN "${isbnBruto}" inválido (confira o dígito verificador)` }
  const candidatos = porIsbn.get(isbn) ?? []
  if (candidatos.length === 0) return { tipo: 'novo' }
  if (candidatos.length > 1) {
    return { tipo: 'erro', motivo: `o ISBN ${isbn} casa com ${candidatos.length} itens seus; use a coluna id para escolher` }
  }
  return { tipo: 'atualizar', item: candidatos[0] }
}

// ---------------------------------------------------------------------------------------------
// Diff de uma atualização
// ---------------------------------------------------------------------------------------------

export type Mudanca = { campo: string; antes: string; depois: string }

export type CamposAtualizaveis = Partial<{
  titulo: string
  numero_volume: number
  tipo: TipoObra
  isbn: string
  estado: EstadoItem
  nota: number
  lido_em: string
  critica: string
}>

export type PlanoAtualizacao = {
  campos: CamposAtualizaveis
  tagsNovas: { nome: string; tipo: TipoTag }[]
  mudancas: Mudanca[]
  avisos: string[]
}

const VAZIO = '—'
const mostrar = (v: string | null | undefined) => (v && v.trim() ? v : VAZIO)

/**
 * Compara a linha com o item e devolve só o que muda: campos PREENCHIDOS e DIFERENTES. Vazio nunca vira mudança.
 * Valor inválido recusa a linha inteira. `serie` não é alterada pela planilha (só avisa).
 */
export function planejarAtualizacao(
  row: LinhaPlanilha,
  atual: ItemAtual
): { ok: true; plano: PlanoAtualizacao } | { ok: false; motivo: string } {
  const campos: CamposAtualizaveis = {}
  const mudancas: Mudanca[] = []
  const avisos: string[] = []

  const titulo = limparCelula(row.titulo)
  if (titulo && titulo !== atual.titulo) {
    campos.titulo = titulo
    mudancas.push({ campo: 'titulo', antes: mostrar(atual.titulo), depois: titulo })
  }

  const numeroBruto = limparCelula(row.numero_volume)
  if (numeroBruto) {
    const n = normalizarNumeroVolume(numeroBruto)
    if (!n.ok) return { ok: false, motivo: `numero_volume "${numeroBruto}" não é um número` }
    if (n.valor !== null && n.valor !== atual.numero_volume) {
      campos.numero_volume = n.valor
      mudancas.push({ campo: 'numero_volume', antes: numeroParaPlanilha(atual.numero_volume) || VAZIO, depois: numeroParaPlanilha(n.valor) })
    }
  }

  const tipoBruto = limparCelula(row.tipo)
  if (tipoBruto) {
    const tipo = normalizarTipo(tipoBruto)
    if (!tipo) return { ok: false, motivo: `tipo "${tipoBruto}" não reconhecido (use hq ou manga)` }
    if (tipo !== atual.tipo) {
      campos.tipo = tipo
      mudancas.push({ campo: 'tipo', antes: atual.tipo, depois: tipo })
    }
  }

  let estadoFinal: EstadoItem = atual.estado
  const estadoBruto = limparCelula(row.estado)
  if (estadoBruto) {
    const estado = normalizarEstado(estadoBruto)
    if (!estado) return { ok: false, motivo: `estado "${estadoBruto}" não reconhecido (use desejo, comprado ou lido)` }
    if (estado !== atual.estado) {
      if (atual.estado === 'lido') {
        // Sair de "lido" apaga a data e as leituras do item (0010/0025): em lote, por planilha, é arriscado demais.
        avisos.push('estado: item já lido não volta para outro estado pela planilha (mudança ignorada)')
      } else {
        campos.estado = estado
        estadoFinal = estado
        mudancas.push({ campo: 'estado', antes: atual.estado, depois: estado })
      }
    }
  }

  const isbnBruto = limparCelula(row.isbn)
  if (isbnBruto && isbnBruto !== (atual.isbn ?? '').trim()) {
    const isbn = normalizarIsbn(isbnBruto)
    if (!isbn) return { ok: false, motivo: `ISBN "${isbnBruto}" inválido (confira o dígito verificador)` }
    if (isbn !== chaveIsbn(atual.isbn)) {
      campos.isbn = isbn
      mudancas.push({ campo: 'isbn', antes: mostrar(atual.isbn), depois: isbn })
    }
  }

  const notaBruta = limparCelula(row.nota)
  if (notaBruta) {
    const nota = normalizarNotaPlanilha(notaBruta)
    if (nota === null) return { ok: false, motivo: `nota "${notaBruta}" inválida (use de 0,5 a 5, em meias estrelas)` }
    if (nota !== atual.nota) {
      campos.nota = nota
      mudancas.push({ campo: 'nota', antes: numeroParaPlanilha(atual.nota) || VAZIO, depois: numeroParaPlanilha(nota) })
    }
  }

  const lidoBruto = limparCelula(row.lido_em)
  if (lidoBruto) {
    const lidoEm = normalizarDataPlanilha(lidoBruto)
    if (!lidoEm) return { ok: false, motivo: `lido_em "${lidoBruto}" não é uma data (use AAAA-MM-DD ou DD/MM/AAAA)` }
    if (estadoFinal !== 'lido') {
      avisos.push('lido_em: o item não está lido, então a data foi ignorada')
    } else if (lidoEm !== atual.lido_em) {
      campos.lido_em = lidoEm
      mudancas.push({ campo: 'lido_em', antes: mostrar(atual.lido_em), depois: lidoEm })
    }
  }

  const critica = limparCelula(row.critica)
  if (critica && critica !== (atual.critica ?? '').trim()) {
    campos.critica = critica
    mudancas.push({ campo: 'critica', antes: mostrar(atual.critica), depois: critica })
  }

  const serie = limparCelula(row.serie)
  if (serie && normalizarChave(serie) !== normalizarChave(atual.serieNome ?? '')) {
    avisos.push(`serie: "${serie}" difere da série do item (${atual.serieNome ?? 'sem série'}); a planilha não troca a série`)
  }

  // Tags: só ACRESCENTA. Nunca remove nem troca (a série compartilha as tags com os outros volumes).
  const tagsNovas: { nome: string; tipo: TipoTag }[] = []
  for (const tipo of CAMPOS_TAG) {
    const valores = dividirValores(row[tipo])
    if (valores.length === 0) continue
    const existentes = atual.tags.filter((t) => t.tipo === tipo)
    const chaves = new Set(existentes.map((t) => normalizarChave(t.nome)))
    const faltam = valores.filter((v) => !chaves.has(normalizarChave(v)))
    if (faltam.length === 0) continue
    if (TAGS_DE_UM_VALOR.includes(tipo) && existentes.length > 0) {
      avisos.push(`${tipo}: o item já tem "${existentes[0].nome}"; não troco por "${faltam[0]}" pela planilha`)
      continue
    }
    const aAdicionar = TAGS_DE_UM_VALOR.includes(tipo) ? faltam.slice(0, 1) : faltam
    for (const nome of aAdicionar) tagsNovas.push({ nome, tipo })
    mudancas.push({
      campo: tipo,
      antes: existentes.length ? existentes.map((t) => t.nome).join('; ') : VAZIO,
      depois: [...existentes.map((t) => t.nome), ...aAdicionar].join('; '),
    })
  }
  const outras = dividirValores(row.tags_extra)
  if (outras.length > 0) {
    const existentes = atual.tags.filter((t) => t.tipo === 'outro')
    const chaves = new Set(existentes.map((t) => normalizarChave(t.nome)))
    const faltam = outras.filter((v) => !chaves.has(normalizarChave(v)))
    if (faltam.length > 0) {
      for (const nome of faltam) tagsNovas.push({ nome, tipo: 'outro' })
      mudancas.push({
        campo: 'tags_extra',
        antes: existentes.length ? existentes.map((t) => t.nome).join('; ') : VAZIO,
        depois: [...existentes.map((t) => t.nome), ...faltam].join('; '),
      })
    }
  }

  return { ok: true, plano: { campos, tagsNovas, mudancas, avisos } }
}

// ---------------------------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------------------------

export type ItemParaExportar = {
  id: string
  titulo: string
  numero_volume: number | null
  tipo: TipoObra
  isbn: string | null
  estado: EstadoItem
  nota: number | null
  lido_em: string | null
  critica: string | null
  serieNome: string | null
  tags: { nome: string; tipo: TipoTag }[]
}

function nomesDasTags(tags: ItemParaExportar['tags'], tipo: TipoTag): string {
  return tags
    .filter((t) => t.tipo === tipo)
    .map((t) => t.nome)
    .join('; ')
}

export function linhaDeExportacao(item: ItemParaExportar): string[] {
  const valores: Record<(typeof COLUNAS_PLANILHA)[number], string> = {
    id: item.id,
    serie: item.serieNome ?? '',
    numero_volume: numeroParaPlanilha(item.numero_volume),
    tipo: item.tipo,
    titulo: item.titulo,
    isbn: isbnParaPlanilha(item.isbn),
    editora: nomesDasTags(item.tags, 'editora'),
    universo: nomesDasTags(item.tags, 'universo'),
    personagem: nomesDasTags(item.tags, 'personagem'),
    selo: nomesDasTags(item.tags, 'selo'),
    autor: nomesDasTags(item.tags, 'autor'),
    estado: item.estado,
    nota: numeroParaPlanilha(item.nota),
    lido_em: item.lido_em ?? '',
    tags_extra: nomesDasTags(item.tags, 'outro'),
    critica: item.critica ?? '',
  }
  return COLUNAS_PLANILHA.map((c) => neutralizarFormula(valores[c]))
}

/**
 * CSV UTF-8 com BOM e `;` como separador: é o que o Excel em português abre com duplo clique, com acento certo
 * e cada coluna no seu lugar. O importador detecta o separador sozinho.
 */
export function gerarCsvDaColecao(itens: ItemParaExportar[]): string {
  const csv = Papa.unparse(
    { fields: [...COLUNAS_PLANILHA], data: itens.map(linhaDeExportacao) },
    { delimiter: ';', newline: '\r\n' }
  )
  return `﻿${csv}\r\n`
}
