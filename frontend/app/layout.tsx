import type { Metadata } from "next";
import "../styles/globals.css";
import "github-markdown-css/github-markdown.css";

export const metadata: Metadata = {
  title: "NoteVLM",
  description: "Digitize documents into Markdown or LaTeX using Qwen3"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-canvas">
        {children}
      </body>
    </html>
  );
}
