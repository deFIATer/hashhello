import "./globals.css";

export const metadata = {
  title: "#hello | Secure P2P Messenger",
  description: "End-to-end encrypted P2P messenger",
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
