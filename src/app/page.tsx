import { Suspense } from "react";
import { ControlRoom } from "@/components/control-room";
import { Logo } from "@/components/logo";
import { databaseMode } from "@/server/db/client";

export const dynamic = "force-dynamic";

export default function Home() {
  if (databaseMode() === "none") return <SetupNotice />;
  return (
    <Suspense fallback={null}>
      <ControlRoom />
    </Suspense>
  );
}

/** Affiché tant que DATABASE_URL n'est pas configurée : aucune fausse donnée. */
function SetupNotice() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-4 py-16">
      <Logo />
      <div className="chamfer plate-frame mt-10">
        <div className="chamfer plate-core p-6 sm:p-8">
          <h1 className="font-display text-2xl font-semibold">Base de données non configurée</h1>
          <p className="mt-3 text-mute">
            Le site a besoin d&apos;une base PostgreSQL Neon pour enregistrer les courses, les paris et la comptabilité. Aucune donnée n&apos;est
            stockée dans le navigateur.
          </p>
          <ol className="mt-6 list-decimal space-y-2 pl-5 text-sm text-ink/90">
            <li>Créez un projet gratuit sur neon.tech et copiez la chaîne de connexion « Pooled connection ».</li>
            <li>Dans Vercel : Settings → Environment Variables → ajoutez <code className="text-flame-soft">DATABASE_URL</code>.</li>
            <li>Appliquez les migrations depuis votre PC : <code className="text-flame-soft">npm run db:migrate</code>.</li>
            <li>Redéployez le projet.</li>
          </ol>
          <p className="mt-6 text-xs text-dim">Voir le README, section « Base de données Neon ».</p>
        </div>
      </div>
    </main>
  );
}
