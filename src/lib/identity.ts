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

/** Identifiant FiveM normalisé (license:xxx, steam:xxx, discord:xxx…), sans espaces, minuscules. */
export function normalizeFivemId(input: string | null | undefined): string | null {
  if (input == null) return null;
  const v = input.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  return v.length ? v : null;
}

/**
 * Clé d'identité du parieur dans une course.
 * Préfixes distincts ("fivem:" / "name:") : un nom RP ne peut jamais entrer
 * en collision avec un identifiant FiveM.
 */
export function bettorIdentityKey(name: string, fivemId?: string | null): string {
  const f = normalizeFivemId(fivemId);
  if (f) return `fivem:${f}`;
  return `name:${normalizeName(name)}`;
}
