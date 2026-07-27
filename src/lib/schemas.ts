import { z } from 'zod'

export const tipoObraSchema = z.enum(['hq', 'manga'])
export const estadoItemSchema = z.enum(['desejo', 'comprado', 'lido'])
export const tipoTagSchema = z.enum([
  'personagem',
  'editora',
  'arco',
  'selo',
  'autor',
  'universo',
  'outro',
])

export const tagInputSchema = z.object({
  nome: z.string().trim().min(1, 'Nome obrigatório').max(80),
  tipo: tipoTagSchema,
  cor: z.string().trim().max(20).optional().nullable(),
})

export const serieInputSchema = z.object({
  nome: z.string().trim().min(1, 'Nome obrigatório').max(200),
  tipo: tipoObraSchema.default('hq'),
  total_volumes: z.coerce.number().int().positive().optional().nullable(),
  em_publicacao: z.coerce.boolean().default(true),
  tem_numeracao: z.coerce.boolean().default(false),
  observacoes: z.string().trim().max(2000).optional().nullable(),
  tagIds: z.array(z.string().uuid()).default([]),
})

export const itemInputSchema = z.object({
  titulo: z.string().trim().min(1, 'Título obrigatório').max(200),
  serie_id: z.string().uuid().optional().nullable(),
  numero_volume: z.coerce.number().optional().nullable(),
  tipo: tipoObraSchema.default('hq'),
  isbn: z.string().trim().max(20).optional().nullable(),
  estado: estadoItemSchema.default('desejo'),
  prioridade: z.coerce.number().int().default(0),
  preco: z.coerce.number().nonnegative().optional().nullable(),
  loja: z.string().trim().max(120).optional().nullable(),
  data_aquisicao: z.string().optional().nullable(),
  nota: z.coerce.number().int().min(1).max(5).optional().nullable(),
  observacoes: z.string().trim().max(2000).optional().nullable(),
  tagIds: z.array(z.string().uuid()).default([]),
})

/** Vincular/desvincular vários itens de uma série de uma vez. */
export const itensDaSerieSchema = z.object({
  serieId: z.string().uuid(),
  itemIds: z.array(z.string().uuid()).min(1, 'Selecione ao menos um item').max(500),
})

/** Inclusão de itens numa série levando junto o número de cada volume.
 *  `numero` é nulo quando a série não é numerada — aí o valor é simplesmente ignorado. */
export const itensComNumeroSchema = z.object({
  serieId: z.string().uuid(),
  itens: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        numero: z.number().finite().nullable(),
      })
    )
    .min(1, 'Selecione ao menos um item')
    .max(500),
})

export const adquirirInputSchema = z.object({
  preco: z.coerce.number().nonnegative().optional().nullable(),
  loja: z.string().trim().max(120).optional().nullable(),
  data_aquisicao: z.string().optional().nullable(),
})

export type TagInput = z.infer<typeof tagInputSchema>
export type ItensDaSerieInput = z.infer<typeof itensDaSerieSchema>
export type ItensComNumeroInput = z.infer<typeof itensComNumeroSchema>
export type SerieInput = z.infer<typeof serieInputSchema>
export type ItemInput = z.infer<typeof itemInputSchema>
export type AdquirirInput = z.infer<typeof adquirirInputSchema>
