import "./globals.css";

export const metadata = {
  title: "#hello | Secure P2P Messenger",
  description: "End-to-end encrypted P2P messenger",
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: '#hello',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#000000',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-darker text-white min-h-screen flex flex-col">
        {children}
      </body>
    </html>
  );
}
