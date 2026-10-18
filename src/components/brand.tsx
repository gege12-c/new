import Link from "next/link";
import { APP_NAME, cn } from "@/lib/utils";

/** Marque : trois traits aux couleurs des trois disciplines, dans l'ordre de course. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex items-center gap-[3px]", className)}>
      <span className="h-3.5 w-1.5 rounded-sm bg-swim" />
      <span className="h-3.5 w-1.5 rounded-sm bg-bike" />
      <span className="h-3.5 w-1.5 rounded-sm bg-run" />
    </span>
  );
}

export function Brand({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5 text-[17px] font-semibold tracking-tight", className)}>
      <BrandMark />
      {APP_NAME}
    </Link>
  );
}
