import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NOVA",
  description: "One intelligence layer for thinking, creating, researching and acting.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
