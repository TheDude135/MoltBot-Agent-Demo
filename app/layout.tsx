import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Deploy Demo",
  description:
    "External demo that provisions a MoltBot Ninja sub-agent from a blueprint via the public REST API.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
