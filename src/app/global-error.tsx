'use client'

// Substitui o layout raiz quando ele mesmo falha: precisa de <html>/<body> e de estilo próprio.
export default function ErroGlobal({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          background: '#100d16',
          color: '#f4f1f8',
          fontFamily: 'system-ui, sans-serif',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 12,
          margin: 0,
          textAlign: 'center',
          padding: 16,
        }}
      >
        <h1 style={{ fontSize: 22, margin: 0 }}>Algo deu errado</h1>
        <p style={{ opacity: 0.7, margin: 0 }}>Não foi possível carregar o aplicativo.</p>
        <button
          onClick={() => retry()}
          style={{ padding: '8px 16px', borderRadius: 8, border: 0, cursor: 'pointer' }}
        >
          Tentar de novo
        </button>
      </body>
    </html>
  )
}
