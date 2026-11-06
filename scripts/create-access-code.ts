/**
 * CODE D'ACCÈS À L'ESPACE PRIVÉ — script d'administration LOCAL.
 *
 *   npm run admin:code
 *
 * Crée un code à usage unique dans la base de DATABASE_URL (.env.local) et l'affiche une seule fois.
 * Sert au premier compte ; ensuite, les codes se génèrent depuis l'onglet « Comptes » du site.
 */
import { createAccessCode } from "../src/server/services/auth";
import { connect } from "./_db";

const { db, close, label } = await connect();
try {
  const { code } = await createAccessCode(db, null);
  console.log(`Base : ${label}`);
  console.log(`\n  Code d'accès (usage unique) :  ${code}\n`);
  console.log("Ouvrez /admin → « Créer un compte », saisissez ce code, puis choisissez pseudo et mot de passe.");
} catch (e) {
  console.error("✖ Échec :", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await close();
}
