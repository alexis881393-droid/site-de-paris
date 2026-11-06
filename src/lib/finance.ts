/**
 * RACEBET CONTROL — moteur financier du pari mutuel.
 *
 * Toutes les opérations monétaires sont faites en BigInt (entiers exacts) :
 * aucun nombre flottant JavaScript n'intervient dans un montant.
 *
 * RÈGLES D'ARRONDI (documentées et déterministes)
 * ------------------------------------------------
 * 1. Commission = plancher(cagnotte × points_de_base / 10 000).
 *    L'arrondi se fait toujours vers le bas : le dollar fractionnaire
 *    reste dans la cagnotte distribuable (en faveur des joueurs).
 * 2. Cagnotte distribuable = cagnotte − commission (entier exact).
 * 3. Gains : méthode des plus grands restes (Hamilton).
 *    a. part exacte_i = distribuable × mise_i / mises_gagnantes
 *    b. chaque gagnant reçoit plancher(part exacte_i)
 *    c. les dollars résiduels (< nombre de gagnants) sont attribués un par
 *       un aux gagnants ayant le plus grand reste fractionnaire
 *    d. égalité de reste : mise la plus élevée d'abord, puis pari le plus
 *       ancien (date d'enregistrement), puis identifiant du pari (ordre
 *       lexicographique) — critère totalement stable.
 *    => somme des gains = cagnotte distribuable, exactement.
 * 4. Aucun gagnant : l'organisateur conserve 100 % de la cagnotte ; la
 *    commission est absorbée (jamais comptée deux fois).
 * 5. Annulation : remboursement intégral de chaque mise, commission = 0.
 * 6. Les cotes affichées (2 décimales, tronquées) ne servent JAMAIS au calcul.
 */

export const BPS_DENOMINATOR = 10_000n;
export const MAX_AMOUNT = 1_000_000_000_000; // 1 000 milliards de $ fictifs par mise

export type BetForPayout = {
  id: string;
  amount: number | bigint;
  createdAt: Date | string | number;
};

export type Payout = { betId: string; amount: bigint };

const toBig = (v: number | bigint): bigint => {
  if (typeof v === "bigint") return v;
  if (!Number.isSafeInteger(v)) throw new Error(`Montant non entier ou hors limites : ${v}`);
  return BigInt(v);
};

export function computeCommission(totalPool: number | bigint, commissionBps: number): bigint {
  const total = toBig(totalPool);
  if (total < 0n) throw new Error("Cagnotte négative");
  if (!Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > 10_000) {
    throw new Error("Commission hors limites");
  }
  return (total * BigInt(commissionBps)) / BPS_DENOMINATOR; // division entière = plancher (valeurs >= 0)
}

export function computeDistributable(totalPool: number | bigint, commissionBps: number): bigint {
  return toBig(totalPool) - computeCommission(totalPool, commissionBps);
}

/**
 * Cote en centièmes (×4,25 → 425n), tronquée. null si aucune mise sur le pilote.
 * Uniquement pour l'affichage.
 */
export function computeOddsCents(
  distributable: number | bigint,
  driverPool: number | bigint,
): bigint | null {
  const pool = toBig(driverPool);
  if (pool <= 0n) return null;
  return (toBig(distributable) * 100n) / pool;
}

/** Cote exacte sous forme de fraction (pour les comparaisons et les tests). */
export function oddsFraction(distributable: number | bigint, driverPool: number | bigint) {
  return { numerator: toBig(distributable), denominator: toBig(driverPool) };
}

const timeOf = (d: Date | string | number) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/** Répartition exacte de la cagnotte distribuable entre les paris gagnants. */
export function allocatePayouts(distributable: number | bigint, winningBets: BetForPayout[]): Payout[] {
  const D = toBig(distributable);
  if (D < 0n) throw new Error("Cagnotte distribuable négative");
  if (winningBets.length === 0) return [];
  const W = winningBets.reduce((s, b) => s + toBig(b.amount), 0n);
  if (W <= 0n) throw new Error("Total des mises gagnantes nul");

  const rows = winningBets.map((b) => {
    const stake = toBig(b.amount);
    if (stake <= 0n) throw new Error("Mise non positive");
    const product = D * stake;
    return { bet: b, stake, base: product / W, remainder: product % W };
  });

  let leftover = D - rows.reduce((s, r) => s + r.base, 0n);
  const order = [...rows].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    if (a.stake !== b.stake) return a.stake > b.stake ? -1 : 1;
    const ta = timeOf(a.bet.createdAt);
    const tb = timeOf(b.bet.createdAt);
    if (ta !== tb) return ta - tb;
    return a.bet.id < b.bet.id ? -1 : a.bet.id > b.bet.id ? 1 : 0;
  });

  const bonus = new Map<string, bigint>();
  for (const r of order) {
    if (leftover <= 0n) break;
    bonus.set(r.bet.id, 1n);
    leftover -= 1n;
  }
  if (leftover !== 0n) throw new Error("Erreur de répartition (reste non nul)");

  return rows.map((r) => ({ betId: r.bet.id, amount: r.base + (bonus.get(r.bet.id) ?? 0n) }));
}

export type SettlementPlan = {
  totalPool: bigint;
  commissionBps: number;
  commissionTheoretical: bigint;
  distributable: bigint;
  winnerPool: bigint;
  noWinner: boolean;
  /** Commission réellement acquise (0 si aucun gagnant : la cagnotte entière est conservée). */
  commissionKept: bigint;
  /** Revenu définitif de l'organisateur. */
  organizerKept: bigint;
  totalPayout: bigint;
  payouts: Payout[];
};

/** Plan de règlement complet d'une course après déclaration du vainqueur. */
export function planResult(
  bets: (BetForPayout & { driverId: string })[],
  winnerDriverId: string,
  commissionBps: number,
): SettlementPlan {
  const totalPool = bets.reduce((s, b) => s + toBig(b.amount), 0n);
  const commissionTheoretical = computeCommission(totalPool, commissionBps);
  const distributable = totalPool - commissionTheoretical;
  const winning = bets.filter((b) => b.driverId === winnerDriverId);
  const winnerPool = winning.reduce((s, b) => s + toBig(b.amount), 0n);

  if (winning.length === 0) {
    return {
      totalPool,
      commissionBps,
      commissionTheoretical,
      distributable,
      winnerPool: 0n,
      noWinner: true,
      commissionKept: 0n,
      organizerKept: totalPool,
      totalPayout: 0n,
      payouts: [],
    };
  }

  const payouts = allocatePayouts(distributable, winning);
  const totalPayout = payouts.reduce((s, p) => s + p.amount, 0n);
  return {
    totalPool,
    commissionBps,
    commissionTheoretical,
    distributable,
    winnerPool,
    noWinner: false,
    commissionKept: commissionTheoretical,
    organizerKept: totalPool - totalPayout,
    totalPayout,
    payouts,
  };
}

/** Plan d'annulation : remboursement intégral, aucune commission. */
export function planCancellation(bets: BetForPayout[]) {
  const refunds = bets.map((b) => ({ betId: b.id, amount: toBig(b.amount) }));
  const totalRefund = refunds.reduce((s, r) => s + r.amount, 0n);
  return { refunds, totalRefund, commissionKept: 0n };
}

/** "12,5" | "12.5" | 12.5 → 1250 points de base. Max 2 décimales, 0 à 100. */
export function parseCommissionPercent(input: string | number): number | null {
  const s = String(input).trim().replace(",", ".").replace(/\s|%/g, "");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const [intPart, decPart = ""] = s.split(".");
  const bps = Number(intPart) * 100 + Number(decPart.padEnd(2, "0"));
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10_000) return null;
  return bps;
}

export const toNumber = (v: bigint): number => {
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new Error("Montant hors limites");
  return n;
};

/**
 * Répartit un montant entier entre des parts exprimées en points de base (total 10 000).
 * Arrondi par plus grands restes : la somme des parts vaut toujours exactement `total`.
 * Départage des restes égaux : position la plus petite d'abord (ordre stable).
 */
export function splitByShares<T extends { shareBps: number; position: number }>(
  total: bigint | number,
  shares: T[],
): { item: T; amount: bigint }[] {
  const t = BigInt(total);
  const sumBps = shares.reduce((s, x) => s + BigInt(x.shareBps), 0n);
  if (t < 0n) throw new RangeError("Montant négatif.");
  if (shares.length === 0 || sumBps === 0n) return shares.map((item) => ({ item, amount: 0n }));
  const rows = shares.map((item) => {
    const num = t * BigInt(item.shareBps);
    return { item, amount: num / sumBps, rest: num % sumBps };
  });
  let left = t - rows.reduce((s, r) => s + r.amount, 0n);
  const order = [...rows].sort((a, b) => (a.rest === b.rest ? a.item.position - b.item.position : a.rest > b.rest ? -1 : 1));
  for (const r of order) {
    if (left <= 0n) break;
    r.amount += 1n;
    left -= 1n;
  }
  return rows.map(({ item, amount }) => ({ item, amount }));
}
