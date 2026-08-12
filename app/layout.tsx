import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ALMA — наблюдение во времени",
  description: "Персональная система наблюдения: цикл, внутренние волны, внешний контекст и повторяемые личные паттерны.",
  applicationName: "ALMA",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "ALMA" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#020105",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
