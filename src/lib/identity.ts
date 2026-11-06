/**
 * Normalisation des noms : insensible à la casse, aux accents, aux espaces
 * multiples et aux variantes Unicode (NFKC). "  Jean  DUPONT " = "jean dupont".
 */
export function normalizeName(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Nettoyage d'affichage : espaces superflus retirés, casse conservée. */
export function cleanDisplayName(input: string): string {
  return input.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/**
 * Numéro de téléphone RP normalisé : chiffres uniquement (le "+" initial est conservé).
 * "06 12-34.56 78" = "0612345678". null si aucun chiffre.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (input == null) return null;
  const t = input.normalize("NFKC").trim();
  const digits = t.replace(/\D+/g, "");
  if (!digits) return null;
  return (t.startsWith("+") ? "+" : "") + digits;
}

/** Affichage : espaces superflus retirés. */
export function cleanPhone(input: string | null | undefined): string | null {
  const v = input?.normalize("NFKC").replace(/\s+/g, " ").trim();
  return v ? v : null;
}

/**
 * Clé d'identité du parieur dans une course.
 * Préfixes distincts ("tel:" / "name:") : un nom RP ne peut jamais entrer
 * en collision avec un numéro de téléphone.
 */
export function bettorIdentityKey(name: string, phone?: string | null): string {
  const p = normalizePhone(phone);
  if (p) return `tel:${p}`;
  return `name:${normalizeName(name)}`;
}
