import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Altoque Peru WK",
  description: "Sistema multiusuario de registros, comisiones y validaciones",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
