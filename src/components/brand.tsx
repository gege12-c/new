import Link from "next/link";
import { APP_NAME, cn } from "@/lib/utils";

/**
 * Marque : trois blocs d’effort de hauteurs croissantes, aux couleurs des trois disciplines,
 * dans l’ordre de course. C’est le profil d’une séance réduit à l’essentiel.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex h-[18px] items-end gap-[3px]", className)}>
      <span className="h-[8px] w-[5px] rounded-[1.5px] bg-swim" />
      <span className="h-[13px] w-[5px] rounded-[1.5px] bg-bike" />
      <span className="h-[18px] w-[5px] rounded-[1.5px] bg-run" />
    </span>
  );
}

export function Brand({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5 text-[18px] font-bold tracking-[-0.02em]", className)} style={{ fontStretch: "112%" }}>
      <BrandMark />
      {APP_NAME}
    </Link>
  );
}
