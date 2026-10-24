import type { NextConfig } from "next";

// Cabeçalhos estáticos para todas as rotas (a CSP, que leva nonce, é montada em `src/proxy.ts`).
const cabecalhosDeSeguranca = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: cabecalhosDeSeguranca }];
  },
  experimental: {
    serverActions: {
      // Padrão é 1MB — foto de capa tirada direto do celular passa disso fácil.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
