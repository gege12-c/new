import { PageContainer } from "@/components/layout/page";
import type { Metadata } from "next";
import { Suspense } from "react";
import { signOut } from "@/app/(auth)/actions";
import { AccountForm } from "@/components/settings/account-form";
import { Button } from "@/components/ui/button";
import { SectionSkeleton } from "@/components/ui/feedback";
import { PageHeader, Panel } from "@/components/ui/panel";
import { getProfile, requireSession } from "@/lib/auth/dal";

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
  const timezones = Intl.supportedValuesOf("timeZone");
  return (
    <div className="space-y-6">
      <Panel title="Compte">
        <AccountForm values={profile} timezones={timezones} />
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
