/**
 * Apelidos de editora: o texto que as APIs devolvem ("Panini Comics") → nome canônico ("Panini").
 * Espelha a tabela `editora_apelidos` da migration 0011 (um teste confere que as duas listas batem);
 * o app usa esta cópia para não ir ao banco a cada casamento. Apelidos já vêm normalizados
 * (`normalizarTexto`).
 */
export const APELIDOS_DE_EDITORA: ReadonlyArray<readonly [apelido: string, editora: string]> = [
  ['panini', 'Panini'],
  ['panini brasil', 'Panini'],
  ['panini comics', 'Panini'],
  ['panini books', 'Panini'],
  ['panini manga', 'Panini'],
  ['editora panini', 'Panini'],
  ['panini brasil ltda', 'Panini'],
  ['jbc', 'JBC'],
  ['editora jbc', 'JBC'],
  ['japan brazil communication', 'JBC'],
  ['newpop', 'NewPOP'],
  ['new pop', 'NewPOP'],
  ['newpop editora', 'NewPOP'],
  ['new pop editora', 'NewPOP'],
  ['pipoca e nanquim', 'Pipoca & Nanquim'],
  ['editora pipoca e nanquim', 'Pipoca & Nanquim'],
  ['pipoca nanquim', 'Pipoca & Nanquim'],
  ['devir', 'Devir'],
  ['devir livraria', 'Devir'],
  ['editora devir', 'Devir'],
  ['mythos', 'Mythos'],
  ['mythos editora', 'Mythos'],
  ['editora mythos', 'Mythos'],
  ['conrad', 'Conrad'],
  ['conrad editora', 'Conrad'],
  ['editora conrad', 'Conrad'],
  ['conrad editora do brasil', 'Conrad'],
]
