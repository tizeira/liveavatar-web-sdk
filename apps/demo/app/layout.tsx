import "./globals.css";
import type { Metadata, Viewport } from "next";
import { SessionProvider } from "../src/components/providers/SessionProvider";
import { Toaster } from "sonner";
import { OutageBanner } from "../src/components/OutageBanner";

export const metadata: Metadata = {
  title: "Clara - Tu Asesora de Skincare | Beta Skin Tech",
  description:
    "Clara es tu asistente virtual de skincare. Obtiene recomendaciones personalizadas para el cuidado de tu piel.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Clara",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#f2f6ff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <SessionProvider>{children}</SessionProvider>
        <Toaster position="top-center" richColors />
        <OutageBanner />
      </body>
    </html>
  );
}
