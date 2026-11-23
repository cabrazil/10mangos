import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "10mangos — Controle Financeiro Pessoal Inteligente",
  description: "Controle simples, elegante e sem burocracia de contas, cartões e patrimônio.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="dark" suppressHydrationWarning>
      <body
        className="min-h-screen bg-slate-950 text-slate-100 antialiased selection:bg-emerald-500/20 selection:text-emerald-400"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
