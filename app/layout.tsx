// Root layout for the Agent Deploy demo. Sets the document metadata and pulls in
// global styles; every page renders inside this <html>/<body> shell.
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
    // suppressHydrationWarning on <body>: browser extensions (e.g. ColorZilla
    // injects cz-shortcut-listen, Grammarly injects data-gr-*) add attributes to
    // <body> before React hydrates, which would otherwise trip a hydration
    // mismatch. This suppresses only this element's own attribute diff, not its
    // children, so real mismatches inside the app still surface.
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
