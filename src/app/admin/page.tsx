import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthScreen } from "@/components/auth-screen";
import { ControlRoom } from "@/components/control-room";
import { SetupNotice } from "@/components/setup-notice";
import { databaseMode, getDb } from "@/server/db/client";
import { currentUser } from "@/server/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Espace privé · RACEBET CONTROL" };

/** Partie privée : session obligatoire (vérifiée ici ET sur chaque route API). */
export default async function AdminPage() {
  if (databaseMode() === "none") return <SetupNotice />;
  const user = await currentUser(await getDb());
  if (!user) return <AuthScreen />;
  return (
    <Suspense fallback={null}>
      <ControlRoom user={user} />
    </Suspense>
  );
}
