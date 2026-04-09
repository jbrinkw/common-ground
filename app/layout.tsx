import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CommonGround",
  description: "A moderated space for productive disagreements",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
