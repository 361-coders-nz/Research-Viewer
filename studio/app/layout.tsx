import type { Metadata } from "next";
import "./globals.css";
import { GeoBg } from "@/components/GeoBg";
import { TopBar } from "@/components/TopBar";
import { RoomProviders } from "@/components/RoomProviders";
import { ToastHost } from "@/components/ToastHost";
import { GlobalDropZone } from "@/components/GlobalDropZone";
import { TreeGeneratorHost } from "@/components/useTreeGenerator";

export const metadata: Metadata = {
  title: "oxFlow Studio",
  description:
    "Interactive research canvas, recursive tree explorer, and course for the oxFlow knowledge base.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <GeoBg />
        <RoomProviders>
          <TreeGeneratorHost />
          <div className="shell">
            <TopBar />
            {children}
          </div>
          <GlobalDropZone />
          <ToastHost />
        </RoomProviders>
      </body>
    </html>
  );
}
