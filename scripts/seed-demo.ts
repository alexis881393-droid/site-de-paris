/**
 * Données de DÉMONSTRATION — à n'utiliser que sur une base de test / dev local.
 * Jamais exécuté automatiquement. Refuse de s'exécuter si la base contient déjà des courses.
 *
 *   npm run db:seed-demo
 */
import { count } from "drizzle-orm";
import { races } from "../src/server/db/schema";
import { addDriver, closeBets, createRace, openBets, placeBet } from "../src/server/services/commands";
import { connect } from "./_db";

const { db, close, label } = await connect();
try {
  const [{ n }] = (await db.select({ n: count() }).from(races)) as [{ n: number }];
  if (n > 0 && !process.argv.includes("--force")) {
    console.error(`✖ ${label} contient déjà ${n} course(s). Démo refusée (utilisez une base de test, ou --force).`);
    process.exit(1);
  }

  const r1 = await createRace(db, { name: "[DÉMO] Night Run Vinewood", commissionPercent: "15", description: "Course de démonstration." });
  const d1 = [];
  for (const [i, name] of ["Lena Varga", "Marco « Diesel » Ruiz", "Kenji Hara", "Sasha Volkova"].entries()) {
    d1.push(await addDriver(db, r1.id, { name, number: [7, 21, 44, 88][i] }));
  }
  await openBets(db, r1.id);
  const bettors = ["Tony Marchetti", "Ava Brooks", "Rico Santos", "Mila Novak", "Jay Carter", "Noor Haddad", "Eli Moreau", "Zoe Lambert"];
  for (const [i, name] of bettors.entries()) {
    await placeBet(db, r1.id, { bettorName: name, driverId: d1[i % 4]!.id, amount: [10000, 25000, 5000, 40000, 15000, 8000, 30000, 12000][i]! });
  }

  const r2 = await createRace(db, { name: "[DÉMO] Sprint du port", commissionPercent: "12,5" });
  const d2 = [await addDriver(db, r2.id, { name: "Ines Duval", number: 3 }), await addDriver(db, r2.id, { name: "Bo Larsen", number: 9 })];
  await openBets(db, r2.id);
  await placeBet(db, r2.id, { bettorName: "Tony Marchetti", driverId: d2[0]!.id, amount: 20000 });
  await placeBet(db, r2.id, { bettorName: "Ava Brooks", driverId: d2[1]!.id, amount: 60000 });
  await closeBets(db, r2.id);

  console.log(`✔ Démo créée dans ${label} : 2 courses.`);
} finally {
  await close();
}
