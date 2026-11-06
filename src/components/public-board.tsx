"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { ArrowDownRight, ArrowUpRight, Banknote, Lock, Trophy } from "lucide-react";
import { usePublicOdds } from "@/lib/api-client";
import type { PublicDriverDTO, PublicOddsDTO } from "@/lib/dto";
import { formatDateTime, formatOdds, formatTime } from "@/lib/format";
import { Backdrop } from "./backdrop";
import { Logo } from "./logo";
import { EmptyState, ICON, Plate, Spinner, cx } from "./ui";

/**
 * Couleurs des pilotes (palette catégorielle validée sur fond sombre : séparation daltonisme ≥ 8,
 * contraste ≥ 3:1). Au-delà de 8 pilotes, les couleurs reviennent avec un trait en pointillés.
 */
const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const colorOf = (i: number) => SERIES[i % SERIES.length]!;
const dashOf = (i: number) => (i >= SERIES.length ? "6 4" : undefined);

type Race = NonNullable<PublicOddsDTO["race"]>;

/** Partie publique : cotes des pilotes et leur évolution. Aucune donnée de parieur. */
export function PublicBoard() {
  const router = useRouter();
  const params = useSearchParams();
  const course = params.get("course");
  const { data, error } = usePublicOdds(course);
  const race = data?.race ?? null;

  return (
    <div className="min-h-dvh">
      <Backdrop intensity="high" />
      <header className="header-neon relative bg-void/70 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <Logo />
            <span className="hidden h-8 w-px bg-line sm:block" aria-hidden />
            <span className="hidden font-cond text-sm font-semibold tracking-[0.16em] text-mute sm:block">COTES EN DIRECT</span>
          </div>
          <a href="/admin" className="text-xs text-dim transition-colors hover:text-mute">
            Espace privé
          </a>
        </div>
      </header>

      <main className="stagger mx-auto max-w-[1200px] space-y-6 px-4 pt-6 pb-16 sm:px-6">
        <CashNotice />

        {!data ? (
          error ? (
            <p className="text-center text-sm text-[#ffb3ba]">Cotes momentanément indisponibles. Nouvelle tentative automatique…</p>
          ) : (
            <div className="grid place-items-center py-24"><Spinner className="h-7 w-7" /></div>
          )
        ) : !race ? (
          <Plate>
            <EmptyState icon={<Lock className="h-6 w-6" {...ICON} />} title="Aucune course en cours">
              Les cotes s&apos;afficheront ici dès l&apos;ouverture des paris de la prochaine course.
            </EmptyState>
          </Plate>
        ) : (
          <>
            {data.races.length > 1 && (
              <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Courses">
                {data.races.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => router.replace(`?course=${r.id}`, { scroll: false })}
                    className={cx(
                      "chamfer-sm flex shrink-0 items-center gap-2 px-3.5 py-2 pointer-coarse:py-3 text-sm font-medium ring-1 ring-inset transition-colors",
                      r.id === race.id ? "bg-flame/12 text-ink ring-flame/60" : "text-mute ring-line hover:text-ink hover:ring-line-strong",
                    )}
                  >
                    {r.status === "open" && <span className="h-1.5 w-1.5 rounded-full bg-flame shadow-[0_0_8px_var(--color-flame)]" aria-hidden />}
                    {r.name}
                  </button>
                ))}
              </nav>
            )}
            <RaceOdds race={race} />
          </>
        )}
      </main>

      <footer className="mx-auto max-w-[1200px] px-4 pb-[max(2rem,env(safe-area-inset-bottom))] text-xs text-dim sm:px-6">
        Cotes indicatives, recalculées après chaque pari (pari mutuel) : elles évoluent jusqu&apos;à la clôture. Montants en dollars fictifs FiveM, non convertibles en argent réel.
      </footer>
    </div>
  );
}

/** Encart d'information : les paris se règlent en espèces. */
function CashNotice() {
  return (
    <aside className="chamfer flex items-start gap-4 bg-caution/[0.08] px-5 py-4 ring-1 ring-inset ring-caution/40 sm:items-center">
      <div className="chamfer-sm grid h-11 w-11 shrink-0 place-items-center bg-caution/15 text-caution ring-1 ring-inset ring-caution/40">
        <Banknote className="h-6 w-6" {...ICON} />
      </div>
      <div>
        <h2 className="font-display text-base font-semibold tracking-wide text-caution">Paris en espèces uniquement</h2>
        <p className="mt-0.5 text-sm text-ink/90">
          Pour parier, retirez d&apos;abord de l&apos;argent liquide (espèces). Les mises sont acceptées uniquement en espèces auprès des organisateurs.
        </p>
      </div>
    </aside>
  );
}

function statusLine(race: Race, winner: PublicDriverDTO | undefined) {
  switch (race.status) {
    case "open":
      return { label: "Paris ouverts · cotes en direct", live: true };
    case "closed":
      return { label: "Paris clôturés · cotes finales", live: false };
    default:
      return { label: winner ? `Résultat officiel · vainqueur : ${winner.name}` : "Résultat officiel", live: false };
  }
}

function RaceOdds({ race }: { race: Race }) {
  const colorIndex = useMemo(() => new Map(race.drivers.map((d, i) => [d.id, i])), [race.drivers]);
  const prev = race.history.length >= 2 ? race.history[race.history.length - 2]!.odds : null;
  const sorted = [...race.drivers].sort((a, b) => (a.oddsCents ?? Infinity) - (b.oddsCents ?? Infinity));
  const winner = race.drivers.find((d) => d.isWinner);
  const status = statusLine(race, winner);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="checker mb-3 w-40" aria-hidden />
          <h1 className="neon-text font-display text-3xl font-bold tracking-wide text-balance sm:text-4xl">{race.name}</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-mute">
            {status.live && (
              <span className="chamfer-sm inline-flex items-center gap-1.5 bg-flame px-2 py-0.5 font-cond text-[0.7rem] font-bold tracking-[0.18em] text-black">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-black" aria-hidden />
                LIVE
              </span>
            )}
            {status.label}
            {race.scheduledAt && <span className="text-dim">· départ {formatDateTime(race.scheduledAt)}</span>}
          </p>
        </div>
        <p className="text-xs text-dim">Mise à jour {formatTime(race.serverTime)}</p>
      </div>

      {race.drivers.length === 0 ? (
        <p className="text-sm text-mute">Pilotes bientôt annoncés.</p>
      ) : (
        <ul className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sorted.map((d, rank) => {
            const i = colorIndex.get(d.id)!;
            const before = prev?.[d.id] ?? null;
            const trend = before != null && d.oddsCents != null && before !== d.oddsCents ? (d.oddsCents > before ? "up" : "down") : null;
            return (
              <li
                key={d.id}
                className={cx(
                  "lift chamfer-sm flex items-center gap-3 bg-plate/90 px-4 py-3.5 ring-1 ring-inset backdrop-blur-sm",
                  d.isWinner ? "ring-flame/70 shadow-[0_0_24px_-8px_var(--color-flame)]" : "ring-line",
                )}
              >
                <span className="h-10 w-1.5 shrink-0" style={{ background: colorOf(i), boxShadow: `0 0 10px ${colorOf(i)}` }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-xs text-dim">
                    {d.isWinner ? (
                      <span className="flex items-center gap-1 font-semibold text-flame-soft"><Trophy className="h-3.5 w-3.5" {...ICON} />Vainqueur</span>
                    ) : d.oddsCents != null && rank === 0 && !winner ? (
                      <span className="font-semibold text-mute">Favori</span>
                    ) : (
                      <span>{d.number != null ? `#${d.number}` : "Pilote"}</span>
                    )}
                  </div>
                  <div className="truncate font-display text-[1.05rem] font-semibold">{d.name}</div>
                </div>
                <div className="text-right">
                  <div className={cx("font-display text-2xl font-semibold tabular-nums", (d.isWinner || (rank === 0 && !winner && d.oddsCents != null)) ? "neon-text" : "text-ink")}>
                    {d.oddsCents == null ? "—" : formatOdds(d.oddsCents)}
                  </div>
                  <div className="h-4 text-xs">
                    {d.oddsCents == null ? (
                      <span className="text-dim">aucune mise</span>
                    ) : trend === "up" ? (
                      <span className="inline-flex items-center gap-0.5 text-mute"><ArrowUpRight className="h-3.5 w-3.5" {...ICON} />en hausse</span>
                    ) : trend === "down" ? (
                      <span className="inline-flex items-center gap-0.5 text-mute"><ArrowDownRight className="h-3.5 w-3.5" {...ICON} />en baisse</span>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Plate>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3.5">
          <h2 className="font-display font-semibold">Évolution des cotes</h2>
          <span className="text-xs text-dim">après chaque pari · échelle logarithmique</span>
        </div>
        {race.history.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-mute">Aucun pari pour l&apos;instant : la courbe apparaîtra au premier pari.</p>
        ) : (
          <OddsChart race={race} />
        )}
      </Plate>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Graphique : une ligne par pilote, axe Y logarithmique, réticule + infobulle
// ---------------------------------------------------------------------------

const H = 320;
const PAD = { top: 16, right: 64, bottom: 28, left: 52 };
const TICKS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 3, 5, 10, 20, 50, 100, 200, 500, 1000];
/** Écart vertical minimal entre deux graduations ou deux étiquettes (unités du viewBox). */
const MIN_GAP = 18;

function OddsChart({ race }: { race: Race }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Largeur réelle en pixels : le texte garde sa taille sur tablette et téléphone.
  const [W, setW] = useState(1000);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { history, drivers } = race;
  const n = history.length;

  const { y, ticks } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of history)
      for (const v of Object.values(p.odds))
        if (v != null) {
          lo = Math.min(lo, v / 100);
          hi = Math.max(hi, v / 100);
        }
    if (!Number.isFinite(lo)) [lo, hi] = [1, 2];
    lo = Math.max(0.01, lo / 1.08);
    hi = Math.max(hi * 1.08, lo * 1.5);
    const [l0, l1] = [Math.log(lo), Math.log(hi)];
    const yy = (v: number) => PAD.top + (1 - (Math.log(v) - l0) / (l1 - l0)) * (H - PAD.top - PAD.bottom);
    // Graduations espacées d'au moins MIN_GAP, en partant du haut.
    const kept: number[] = [];
    for (const t of TICKS.filter((t) => t >= lo && t <= hi).reverse()) {
      if (kept.length === 0 || yy(t) - yy(kept[kept.length - 1]!) >= MIN_GAP) kept.push(t);
    }
    return { y: yy, ticks: kept };
  }, [history]);

  const x = (i: number) => PAD.left + (n === 1 ? (W - PAD.left - PAD.right) / 2 : (i / (n - 1)) * (W - PAD.left - PAD.right));

  // Tracé par pilote, interrompu tant que le pilote n'a aucune mise.
  const paths = drivers.map((d) => {
    let dStr = "";
    let pen = false;
    history.forEach((p, i) => {
      const v = p.odds[d.id];
      if (v == null) {
        pen = false;
        return;
      }
      dStr += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v / 100).toFixed(1)}`;
      pen = true;
    });
    return dStr;
  });

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || n === 0) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = n === 1 ? 0 : Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  }

  const hp = hover != null ? history[hover] : null;
  const last = history[n - 1]!;
  const showEndLabels = drivers.length <= 6;
  // Étiquettes de fin de ligne : décalées verticalement pour ne jamais se chevaucher.
  const endLabels = drivers
    .map((d) => ({ id: d.id, v: last.odds[d.id] ?? null }))
    .filter((l): l is { id: string; v: number } => l.v != null)
    .map((l) => ({ ...l, y: y(l.v / 100) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < endLabels.length; i++) {
    endLabels[i]!.y = Math.max(endLabels[i]!.y, endLabels[i - 1]!.y + MIN_GAP - 4);
  }

  return (
    <div className="relative px-2 pt-3 pb-2 sm:px-4">
      <div ref={boxRef}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full touch-pan-y select-none"
        role="img"
        aria-label={`Évolution des cotes de ${drivers.length} pilotes sur ${n} paris`}
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-dim text-[12px] tabular-nums">
              ×{t.toLocaleString("fr-FR")}
            </text>
          </g>
        ))}
        <text x={PAD.left} y={H - 8} className="fill-dim text-[12px]">{formatTime(history[0]!.t)}</text>
        {n > 1 && (
          <text x={W - PAD.right} y={H - 8} textAnchor="end" className="fill-dim text-[12px]">{formatTime(last.t)}</text>
        )}

        <defs>
          <filter id="odds-glow" x="-5%" y="-20%" width="110%" height="140%">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {paths.map((p, i) => (
          <path
            key={drivers[i]!.id}
            d={p}
            pathLength={dashOf(i) ? undefined : 1}
            className={dashOf(i) ? undefined : "draw-line"}
            filter="url(#odds-glow)"
            fill="none"
            stroke={colorOf(i)}
            strokeWidth={2}
            strokeDasharray={dashOf(i)}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={hover != null ? 0.85 : 1}
          />
        ))}
        {n === 1 &&
          drivers.map((d, i) => {
            const v = last.odds[d.id];
            return v == null ? null : <circle key={d.id} cx={x(0)} cy={y(v / 100)} r={4} fill={colorOf(i)} stroke="var(--color-plate)" strokeWidth={2} />;
          })}

        {showEndLabels &&
          endLabels.map((l) => (
            <text key={l.id} x={x(n - 1) + 8} y={l.y} dy="0.32em" className="fill-mute text-[12px] tabular-nums">
              {formatOdds(l.v)}
            </text>
          ))}

        {hp && hover != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--color-line-strong)" strokeWidth={1} />
            {drivers.map((d, i) => {
              const v = hp.odds[d.id];
              return v == null ? null : (
                <circle key={d.id} cx={x(hover)} cy={y(v / 100)} r={4.5} fill={colorOf(i)} stroke="var(--color-plate)" strokeWidth={2} />
              );
            })}
          </g>
        )}
      </svg>
      </div>

      {hp && hover != null && (
        <div
          className="chamfer-sm pointer-events-none absolute top-3 z-10 min-w-44 bg-pit/95 px-3 py-2.5 text-xs ring-1 ring-inset ring-line-strong"
          style={x(hover) / W > 0.55 ? { right: `${(1 - x(hover) / W) * 100 + 2}%` } : { left: `${(x(hover) / W) * 100 + 2}%` }}
        >
          <div className="mb-1.5 text-dim">Après le pari n° {hover + 1} · {formatTime(hp.t)}</div>
          {drivers
            .map((d, i) => ({ d, i, v: hp.odds[d.id] ?? null }))
            .sort((a, b) => (a.v ?? Infinity) - (b.v ?? Infinity))
            .map(({ d, i, v }) => (
              <div key={d.id} className="flex items-center justify-between gap-4 py-0.5">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0" style={{ background: colorOf(i) }} aria-hidden />
                  <span className="truncate text-ink">{d.name}</span>
                </span>
                <span className="font-display tabular-nums text-ink">{v == null ? "—" : formatOdds(v)}</span>
              </div>
            ))}
        </div>
      )}

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 px-2 pt-2 pb-1 text-xs text-mute" aria-label="Légende">
        {drivers.map((d, i) => (
          <li key={d.id} className="flex items-center gap-1.5">
            <svg width="16" height="4" aria-hidden>
              <line x1="0" x2="16" y1="2" y2="2" stroke={colorOf(i)} strokeWidth="2.5" strokeDasharray={dashOf(i) ? "4 3" : undefined} />
            </svg>
            {d.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
