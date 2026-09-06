import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GCE-TLY AI Assistant",
  description:
    "Official AI information assistant for Government College of Engineering, Tirunelveli",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F0F4FA" },
    { media: "(prefers-color-scheme: dark)", color: "#070A0F" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Prevent theme flash before React hydrates */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('gcetly-theme');if(t==='dark'){document.documentElement.classList.add('dark');document.documentElement.dataset.theme='dark';}else{document.documentElement.classList.remove('dark');document.documentElement.dataset.theme='light';}}catch(e){document.documentElement.classList.remove('dark');}})();`,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600&family=Noto+Sans+Tamil:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <link rel="apple-touch-icon" href="https://gcetly.ac.in/imgs/gcelogo.jpg" />
      </head>
      <body className="transition-colors duration-300">{children}</body>
    </html>
  );
}
