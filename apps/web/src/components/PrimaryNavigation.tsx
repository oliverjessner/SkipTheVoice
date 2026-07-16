"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/audios", label: "Audios" },
  { href: "/settings", label: "Settings" },
];

export function PrimaryNavigation({ className = "nav" }: { className?: string }) {
  const pathname = usePathname();
  return <nav className={className} aria-label="Primary navigation">
    {items.map((item) => {
      const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
      return <Link href={item.href} aria-current={active ? "page" : undefined} key={item.href}>{item.label}</Link>;
    })}
  </nav>;
}
