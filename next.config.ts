import type { NextConfig } from "next";

// Cabeçalhos estáticos para todas as rotas (a CSP, que leva nonce, é montada em `src/proxy.ts`).
const cabecalhosDeSeguranca = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: cabecalhosDeSeguranca },
      {
        // Service worker do Web Push: nunca em cache (o navegador precisa ver a versão nova) e com CSP própria,
        // já que o proxy não passa por aqui (ver o matcher em `src/proxy.ts`).
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'none'; script-src 'self'" },
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      // Padrão é 1MB — foto de capa tirada direto do celular passa disso fácil.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
