/**
 * Escapa `%`, `_` e `\` para usar um texto literal em `ilike`.
 *
 * Sem isso o nome `CSV_Wild` casa também com `CSV Wild`, e `100%` casa com qualquer coisa.
 */
export function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`)
}
