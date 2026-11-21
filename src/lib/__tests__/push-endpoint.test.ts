import { describe, expect, it } from 'vitest'
import { endpointDePushPermitido } from '@/lib/push-endpoint'

describe('endpointDePushPermitido', () => {
  it.each([
    ['Chrome / Android', 'https://fcm.googleapis.com/fcm/send/abc123'],
    ['Chrome (rota wp)', 'https://fcm.googleapis.com/wp/abc123'],
    ['Firefox', 'https://updates.push.services.mozilla.com/wpush/v2/abc123'],
    ['Firefox (outro subdomínio)', 'https://updates-autopush.stage.push.services.mozilla.com/wpush/v2/abc'],
    ['Safari / iPhone', 'https://web.push.apple.com/QGxyz'],
    ['Edge / Windows', 'https://wns2-by3p.notify.windows.com/w/?token=abc'],
    ['Edge / Windows (outra região)', 'https://db5p.notify.windows.com/w/?token=abc'],
    ['host em maiúsculas', 'https://FCM.GoogleAPIs.com/fcm/send/abc'],
    ['porta 443 explícita', 'https://fcm.googleapis.com:443/fcm/send/abc'],
  ])('aceita %s', (_nome, url) => {
    expect(endpointDePushPermitido(url)).toBe(true)
  })

  it.each([
    ['http (sem TLS)', 'http://fcm.googleapis.com/fcm/send/abc'],
    ['IPv4', 'https://142.250.1.1/fcm/send/abc'],
    ['IPv4 de rede interna', 'https://10.0.0.5/x'],
    ['IPv6', 'https://[::1]/x'],
    ['localhost', 'https://localhost/x'],
    ['localhost com porta', 'https://localhost:3000/x'],
    ['host parecido (sufixo do atacante)', 'https://fcm.googleapis.com.evil.com/fcm/send/abc'],
    ['host parecido (prefixo)', 'https://evilfcm.googleapis.com/fcm/send/abc'],
    ['host parecido (Apple)', 'https://web.push.apple.com.evil.com/x'],
    ['host parecido (Mozilla)', 'https://push.services.mozilla.com.evil.com/x'],
    ['domínio puro sem subdomínio (Apple)', 'https://push.apple.com/x'],
    ['domínio que só termina parecido', 'https://notpush.apple.com.br/x'],
    ['sufixo colado sem ponto', 'https://xpush.apple.com/x'],
    ['usuário@ para enganar o leitor', 'https://fcm.googleapis.com@evil.com/x'],
    ['usuário e senha', 'https://user:pass@fcm.googleapis.com/x'],
    ['porta diferente', 'https://fcm.googleapis.com:8443/x'],
    ['outro serviço', 'https://example.com/push'],
    ['esquema estranho', 'ftp://fcm.googleapis.com/x'],
    ['vazio', ''],
    ['texto solto', 'fcm.googleapis.com/fcm/send/abc'],
  ])('recusa %s', (_nome, url) => {
    expect(endpointDePushPermitido(url)).toBe(false)
  })

  it('recusa o que não é texto e endereços gigantes', () => {
    expect(endpointDePushPermitido(null)).toBe(false)
    expect(endpointDePushPermitido(undefined)).toBe(false)
    expect(endpointDePushPermitido(42)).toBe(false)
    expect(endpointDePushPermitido(`https://fcm.googleapis.com/${'a'.repeat(2100)}`)).toBe(false)
  })
})
