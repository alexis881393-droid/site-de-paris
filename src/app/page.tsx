import { Suspense } from "react";
import { PublicBoard } from "@/components/public-board";
import { SetupNotice } from "@/components/setup-notice";
import { databaseMode } from "@/server/db/client";

export const dynamic = "force-dynamic";

/** Partie publique : cotes des pilotes et leur évolution, sans connexion. */
export default function Home() {
  if (databaseMode() === "none") return <SetupNotice />;
  return (
    <Suspense fallback={null}>
      <PublicBoard />
    </Suspense>
  );
}
