import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils";
import { AdminRoleButton } from "./admin-role-button";

export interface AdminAccount {
  id: string;
  display_name: string;
  email: string | null;
  is_coach: boolean;
  is_admin: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  athletes: number;
  coaches: number;
}

const chip = "rounded-[6px] px-1.5 py-[2px] text-[11.5px]";

/** Comptes et rôles : aucune donnée sportive, seulement l'identité, les rôles et les relations. */
export function AccountsPanel({ accounts, currentUserId, timeZone }: { accounts: AdminAccount[]; currentUserId: string; timeZone: string }) {
  const date = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone });
  return (
    <Panel
      title="Comptes et rôles"
      description={`${accounts.length} compte${accounts.length > 1 ? "s" : ""}. Le mode coach est choisi par chacun dans ses réglages ; l’administration se donne ici.`}
    >
      <div className="-mx-4 overflow-x-auto sm:-mx-5">
        <table className="w-full min-w-[680px] text-left text-[13px]">
          <thead className="text-[12px] text-muted">
            <tr className="border-b border-line">
              <th scope="col" className="px-4 py-2 font-medium sm:px-5">
                Compte
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Rôles
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Relations
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Inscription
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Dernière connexion
              </th>
              <th scope="col" className="py-2 pr-4 font-medium sm:pr-5">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {accounts.map((account) => (
              <tr key={account.id} className="align-top">
                <th scope="row" className="px-4 py-2.5 font-normal sm:px-5">
                  <span className="block font-semibold text-ink">{account.display_name}</span>
                  <span className="block text-muted">{account.email ?? "adresse inconnue"}</span>
                </th>
                <td className="py-2.5 pr-3">
                  <span className="flex flex-wrap gap-1">
                    <span className={cn(chip, "bg-surface-3 text-ink")}>Athlète</span>
                    {account.is_coach ? <span className={cn(chip, "bg-surface-3 text-ink")}>Coach</span> : null}
                    {account.is_admin ? <span className={cn(chip, "bg-ink text-canvas")}>Admin</span> : null}
                  </span>
                </td>
                <td className="figure py-2.5 pr-3 text-ink-soft">
                  {[account.is_coach ? `${account.athletes} athlète${account.athletes > 1 ? "s" : ""}` : null, account.coaches ? `${account.coaches} coach${account.coaches > 1 ? "s" : ""}` : null]
                    .filter(Boolean)
                    .join(" · ") || <span className="text-muted">—</span>}
                </td>
                <td className="figure py-2.5 pr-3 text-ink-soft">{date.format(new Date(account.created_at))}</td>
                <td className={cn("figure py-2.5 pr-3", account.last_sign_in_at ? "text-ink-soft" : "text-muted")}>
                  {account.last_sign_in_at ? date.format(new Date(account.last_sign_in_at)) : "jamais"}
                </td>
                <td className="py-2 pr-4 text-right sm:pr-5">
                  <AdminRoleButton userId={account.id} isAdmin={account.is_admin} self={account.id === currentUserId} name={account.display_name} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
