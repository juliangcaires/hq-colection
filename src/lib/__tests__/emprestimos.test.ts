import { describe, expect, it } from 'vitest'
import { diasEntre, emprestimoInputSchema, situacaoDoEmprestimo, textoDoPrazo } from '@/lib/emprestimos'

const ITEM = '11111111-1111-4111-8111-111111111111'

describe('situacaoDoEmprestimo', () => {
  const hoje = '2026-11-09'
  it.each([
    [{ devolver_ate: '2026-11-01', devolvido_em: null }, 'atrasado'],
    [{ devolver_ate: '2026-11-09', devolvido_em: null }, 'vence_hoje'],
    [{ devolver_ate: '2026-11-20', devolvido_em: null }, 'em_dia'],
    [{ devolver_ate: null, devolvido_em: null }, 'sem_prazo'],
    [{ devolver_ate: '2026-11-01', devolvido_em: '2026-11-05' }, 'devolvido'],
  ] as const)('%j → %s', (e, esperado) => {
    expect(situacaoDoEmprestimo(e, hoje)).toBe(esperado)
  })
  it('textos do prazo em português, no singular e no plural', () => {
    expect(textoDoPrazo({ devolver_ate: '2026-11-08', devolvido_em: null }, hoje)).toBe('Atrasado há 1 dia')
    expect(textoDoPrazo({ devolver_ate: '2026-11-01', devolvido_em: null }, hoje)).toBe('Atrasado há 8 dias')
    expect(textoDoPrazo({ devolver_ate: '2026-11-10', devolvido_em: null }, hoje)).toBe('Devolver em 1 dia')
    expect(textoDoPrazo({ devolver_ate: '2026-11-09', devolvido_em: null }, hoje)).toBe('Devolver hoje')
  })
  it('diasEntre atravessa mês e ano', () => {
    expect(diasEntre('2026-12-30', '2027-01-02')).toBe(3)
    expect(diasEntre('2026-11-09', '2026-11-09')).toBe(0)
  })
})

describe('emprestimoInputSchema', () => {
  it('aceita o mínimo (item e nome) e limpa espaços', () => {
    expect(emprestimoInputSchema.parse({ itemId: ITEM, paraQuem: '  Maria  ' }).paraQuem).toBe('Maria')
  })
  it('recusa nome vazio ou gigante, data torta e prazo antes do empréstimo', () => {
    expect(() => emprestimoInputSchema.parse({ itemId: ITEM, paraQuem: '   ' })).toThrow()
    expect(() => emprestimoInputSchema.parse({ itemId: ITEM, paraQuem: 'x'.repeat(121) })).toThrow()
    expect(() => emprestimoInputSchema.parse({ itemId: ITEM, paraQuem: 'a', emprestadoEm: '10/11/2026' })).toThrow()
    expect(() => emprestimoInputSchema.parse({ itemId: ITEM, paraQuem: 'a', emprestadoEm: '2026-11-10', devolverAte: '2026-11-01' })).toThrow()
    expect(() => emprestimoInputSchema.parse({ itemId: 'nao-uuid', paraQuem: 'a' })).toThrow()
    expect(() => emprestimoInputSchema.parse({ itemId: ITEM, paraQuem: 'a', observacao: 'x'.repeat(501) })).toThrow()
  })
})
