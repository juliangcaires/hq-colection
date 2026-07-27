import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, IBM_Plex_Sans } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const bricolageGrotesque = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Minha Coleção",
  description: "Coleção pessoal de HQs e mangás",
  appleWebApp: {
    title: "Coleção",
    statusBarStyle: "black-translucent",
  },
  // `manifest.ts` já injeta o <link rel="manifest">; `apple-icon.png` já
  // injeta o <link rel="apple-touch-icon">. Ambos são convenções de arquivo
  // do Next 16 (app/manifest.ts e app/apple-icon.png) — sem tags manuais.
};

export const viewport: Viewport = {
  themeColor: "#100d16",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${bricolageGrotesque.variable} ${ibmPlexSans.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster theme="dark" />
      </body>
    </html>
  );
}
