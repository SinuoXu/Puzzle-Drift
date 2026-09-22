import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Puzzle Drift",
  description: "拼图漂流库",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
