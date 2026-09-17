import type { Metadata, Viewport } from "next";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/nunito-sans";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "Recall — Private Memory",
  description:
    "A private, offline second memory. Capture anything — links, screenshots, PDFs, text, voice — then find it later with natural search. Everything stays on this device.",
  applicationName: "Recall",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Recall",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf4ec" },
    { media: "(prefers-color-scheme: dark)", color: "#201913" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

/** Runs before first paint: applies the stored theme preference (or system). */
const themeInit = `(function(){try{var p=localStorage.getItem("recall-theme")||"system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light";}catch(x){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased bg-background text-foreground">
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        {/* relative paths so the app works from any subpath (GitHub Pages) */}
        <link rel="manifest" href="manifest.json" />
        <link rel="icon" type="image/png" sizes="64x64" href="favicon.png" />
        <link rel="apple-touch-icon" sizes="192x192" href="icons/icon-192.png" />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
