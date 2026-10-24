import { afterEach, describe, expect, it, vi } from 'vitest'
import { escaparLike } from '@/lib/like'
import { hojeIso } from '@/lib/datas'
import { codigoDoErroAuth, ERROS_AUTH } from '@/lib/auth-mensagens'

describe('escaparLike', () => {
  it('trata % _ e \\ como texto literal', () => {
    expect(escaparLike('CSV_Wild')).toBe('CSV\\_Wild')
    expect(escaparLike('100%')).toBe('100\\%')
    expect(escaparLike('a\\b')).toBe('a\\\\b')
    expect(escaparLike('normal')).toBe('normal')
  })
})

describe('hojeIso', () => {
  afterEach(() => vi.useRealTimers())

  it('usa o fuso pedido, não UTC', () => {
    // 01:30 UTC de 24/10 ainda é 23/10 em São Paulo (UTC-3).
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-24T01:30:00Z'))
    expect(hojeIso('America/Sao_Paulo')).toBe('2026-10-23')
    expect(hojeIso('UTC')).toBe('2026-10-24')
  })
})

describe('codigoDoErroAuth', () => {
  it('não diferencia e-mail inexistente de senha errada', () => {
    expect(codigoDoErroAuth({ code: 'invalid_credentials', status: 400 }, 'login')).toBe('credenciais')
    expect(codigoDoErroAuth({ code: 'user_not_found', status: 400 }, 'login')).toBe('credenciais')
  })
  it('mapeia limite e senha fraca, e cadastro duplicado vira mensagem neutra', () => {
    expect(codigoDoErroAuth({ status: 429 }, 'login')).toBe('limite')
    expect(codigoDoErroAuth({ code: 'weak_password', status: 422 }, 'cadastro')).toBe('senha-fraca')
    expect(codigoDoErroAuth({ code: 'user_already_exists', status: 422 }, 'cadastro')).toBe('cadastro')
  })
  it('todo código tem texto', () => {
    for (const texto of Object.values(ERROS_AUTH)) expect(texto.length).toBeGreaterThan(5)
  })
})
