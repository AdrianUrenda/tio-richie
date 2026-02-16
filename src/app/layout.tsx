import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tío Richie — Tu coach de finanzas personales",
  description:
    "Coach de finanzas conductuales impulsado por IA para ayudarte a tomar mejores decisiones financieras.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
