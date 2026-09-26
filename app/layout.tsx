import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "mobile.do — any URL or idea → mobile app",
  description:
    "Convert any website or prompt into a full-fledged mobile web app, PWA and iOS/Android shell — powered by the AI provider and API key of your choice.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0b12" },
    { media: "(prefers-color-scheme: light)", color: "#f6f6fb" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
