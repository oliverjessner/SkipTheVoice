import type { Metadata } from "next";
import Image from "next/image";
import logo from "../../../assets/logo.webp";
import { PrimaryNavigation } from "@/components/PrimaryNavigation";
import "./globals.css";

export const metadata: Metadata = {
  title: "SkipTheVoice",
  description: "Your WhatsApp voice messages, without the noise.",
  icons: { icon: logo.src, apple: logo.src },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><div className="shell">
    <aside className="sidebar">
      <div className="brand">
        <Image className="brand-icon" src={logo} width={32} height={32} alt="" priority />
        <span>SkipTheVoice</span>
      </div>
      <PrimaryNavigation />
    </aside>
    <header className="mobile-nav">
      <div className="mobile-brand">
        <Image className="brand-icon" src={logo} width={28} height={28} alt="" priority />
        <strong>SkipTheVoice</strong>
      </div>
      <PrimaryNavigation className="mobile-menu" />
    </header>
    <main className="main">{children}</main>
  </div></body></html>;
}
