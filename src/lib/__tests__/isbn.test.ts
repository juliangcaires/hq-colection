import { describe, expect, it } from 'vitest'
import {
  codigoDeBarrasEhIsbn,
  isbn10Valido,
  isbn10ParaIsbn13,
  isbn13ParaIsbn10,
  isbn13Valido,
  limparIsbn,
  normalizarIsbn,
} from '@/lib/isbn'

describe('limparIsbn', () => {
  it('tira hífens, espaços e ruído e põe o X em maiúsculo', () => {
    expect(limparIsbn('978-85-457-0287-0')).toBe('9788545702870')
    expect(limparIsbn(' ISBN 85 7164 x ')).toBe('857164X')
    expect(limparIsbn('0-8044-2957-x')).toBe('080442957X')
  })
})

describe('validação', () => {
  it('ISBN-13 válidos', () => {
    for (const i of ['9788545702870', '9780306406157', '9791032305843']) expect(isbn13Valido(i)).toBe(true)
  })
  it('ISBN-13 inválidos', () => {
    for (const i of ['9788545702871', '9780306406158', '1234567890123', '978854570287', '97885457028700', '']) {
      expect(isbn13Valido(i)).toBe(false)
    }
  })
  it('ISBN-10 válidos, incluindo X', () => {
    for (const i of ['0306406152', '080442957X', '8571640041']) expect(isbn10Valido(i)).toBe(true)
  })
  it('ISBN-10 inválidos', () => {
    for (const i of ['0306406153', '080442957Y', '030640615', 'ABCDEFGHIJ']) expect(isbn10Valido(i)).toBe(false)
  })
})

describe('conversão', () => {
  it('ISBN-10 → 13', () => {
    expect(isbn10ParaIsbn13('0306406152')).toBe('9780306406157')
    expect(isbn10ParaIsbn13('080442957X')).toBe('9780804429573')
  })
  it('ISBN-10 inválido não converte', () => {
    expect(isbn10ParaIsbn13('0306406153')).toBeNull()
  })
  it('ISBN-13 → 10 (só 978)', () => {
    expect(isbn13ParaIsbn10('9780306406157')).toBe('0306406152')
    expect(isbn13ParaIsbn10('9780804429573')).toBe('080442957X')
    expect(isbn13ParaIsbn10('9791032305843')).toBeNull()
  })
})

describe('normalizarIsbn', () => {
  it('aceita ISBN-13 com hífens', () => {
    expect(normalizarIsbn('978-85-457-0287-0')).toBe('9788545702870')
  })
  it('converte ISBN-10 em ISBN-13', () => {
    expect(normalizarIsbn('0-306-40615-2')).toBe('9780306406157')
  })
  it('rejeita dígito errado, tamanho errado e lixo', () => {
    expect(normalizarIsbn('978-85-457-0287-1')).toBeNull()
    expect(normalizarIsbn('12345')).toBeNull()
    expect(normalizarIsbn('abc')).toBeNull()
    expect(normalizarIsbn('9'.repeat(100))).toBeNull()
  })
})

describe('codigoDeBarrasEhIsbn', () => {
  it('só EAN-13 978/979 com dígito certo', () => {
    expect(codigoDeBarrasEhIsbn('9788545702870')).toBe(true)
    expect(codigoDeBarrasEhIsbn('9791032305843')).toBe(true)
    expect(codigoDeBarrasEhIsbn('7891234567895')).toBe(false) // EAN comum brasileiro (789)
    expect(codigoDeBarrasEhIsbn('9788545702871')).toBe(false)
    expect(codigoDeBarrasEhIsbn('0306406152')).toBe(false)
  })
})
