import { PageContainer } from "@/components/layout/page";
import type { Metadata } from "next";
import { Suspense } from "react";
import { signOut } from "@/app/(auth)/actions";
import { InstallPanelBody } from "@/components/pwa/install-app";
import { NotificationPreferencesForm } from "@/components/settings/notification-preferences";
import { AccountForm } from "@/components/settings/account-form";
import { Button } from "@/components/ui/button";
import { SectionSkeleton } from "@/components/ui/feedback";
import { PageHeader, Panel } from "@/components/ui/panel";
import { getProfile, requireSession } from "@/lib/auth/dal";
import { getDisabledKinds } from "@/lib/data/notifications";

export const metadata: Metadata = { title: "Réglages" };

export default function SettingsPage() {
  return (
    <PageContainer>
      <PageHeader title="Réglages" />
      <Suspense fallback={<SectionSkeleton />}>
        <SettingsContent />
      </Suspense>
    </PageContainer>
  );
}

async function SettingsContent() {
  const [session, profile] = await Promise.all([requireSession("/settings"), getProfile()]);
  const disabledKinds = await getDisabledKinds(session.supabase);
  const timezones = Intl.supportedValuesOf("timeZone");
  return (
    <div className="space-y-6">
      <Panel title="Compte">
        <AccountForm values={profile} timezones={timezones} />
      </Panel>
      <Panel id="notifications" title="Notifications" description="Elles s’affichent dans l’application (cloche en haut de l’écran). Tout est actif par défaut.">
        {disabledKinds === null ? (
          <p className="text-[14px] text-muted">Disponible après la mise à jour de la base de données du site.</p>
        ) : (
          <NotificationPreferencesForm disabled={disabledKinds} isCoach={profile.is_coach} />
        )}
      </Panel>
      <Panel title="Application sur téléphone" description="TriCoach s’installe comme une application, sans passer par un magasin d’applications.">
        <InstallPanelBody />
      </Panel>
      <Panel title="Connexion">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px]">
            Connecté avec <span className="font-medium">{session.email ?? "votre adresse"}</span>
          </p>
          <form action={signOut}>
            <Button type="submit" variant="secondary" size="sm">
              Se déconnecter
            </Button>
          </form>
        </div>
      </Panel>
    </div>
  );
}
