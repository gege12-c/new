/**
 * Contrôles statiques des migrations. Supabase charge l'extension pg_safeupdate pour l'API :
 * tout DELETE ou UPDATE sans WHERE y échoue (« DELETE requires a WHERE clause »), même exécuté
 * par une fonction ou un trigger. Les bases de test locales n'ont pas cette extension.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.join(__dirname, "../../supabase/migrations");

/** Instructions DELETE/UPDATE sans WHERE (définitions de triggers, politiques et ON CONFLICT exclues). */
export function unguardedWrites(sql: string): string[] {
  const code = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const found: string[] = [];
  for (const match of code.matchAll(/\b(delete\s+from|update)\s+([a-z_."]+)([\s\S]*?);/gi)) {
    const statement = match[0];
    const before = code.slice(Math.max(0, match.index - 40), match.index);
    if (/^update\s+(of|on|to)\b/i.test(statement)) continue; // create trigger … update of / on ; create policy … for update to
    if (/(insert|before|after|or|for|do)\s*$/i.test(before.trim().split(/\s+/).slice(-1)[0] ?? "")) continue; // trigger events, policy commands, on conflict do update
    if (!/\bwhere\b/i.test(statement)) found.push(statement.replace(/\s+/g, " ").slice(0, 120));
  }
  return found;
}

describe("migrations", () => {
  it("n'écrivent jamais sans WHERE (pg_safeupdate)", () => {
    for (const file of readdirSync(DIR).filter((f) => f.endsWith(".sql"))) {
      expect({ file, writes: unguardedWrites(readFileSync(path.join(DIR, file), "utf8")) }).toEqual({ file, writes: [] });
    }
  });

  it("repère une écriture sans WHERE", () => {
    expect(unguardedWrites("begin; delete from pg_temp.t; update public.x set a = 1; end;")).toHaveLength(2);
    expect(unguardedWrites("delete from pg_temp.t where true; insert into t values (1) on conflict (id) do update set a = 1;")).toEqual([]);
    expect(unguardedWrites("create trigger t after insert or update or delete on public.x for each row execute function f();")).toEqual([]);
  });
});
