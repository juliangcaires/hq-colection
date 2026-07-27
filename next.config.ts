import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/sign/**",
      },
    ],
  },
  experimental: {
    serverActions: {
      // Padrão é 1MB — foto de capa tirada direto do celular passa disso fácil.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
