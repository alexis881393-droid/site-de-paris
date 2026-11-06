"use client";

import { useMemo, useState } from "react";
import { CloudOff, FileSpreadsheet, Search, ShieldCheck } from "lucide-react";
import { useAccounting } from "@/lib/api-client";
import type { AccountingRowDTO, GlobalAccountingDTO, RaceDetailDTO } from "@/lib/dto";
import type { RaceAccounting } from "@/lib/accounting";
import { RACE_STATUSES, type RaceStatus } from "@/lib/constants";
import { RACE_STATUS_LABEL } from "@/lib/status";
import { formatDate, formatDateTime, formatMoney, formatPercentBps } from "@/lib/format";
import { RacePartnersPanel, remainingForRace } from "./partners";
import { EmptyState, buttonClasses, ICON, Input, Plate, SectionTitle, Select, Spinner, Stat, StatusBadge, Tag, cx } from "../ui";

export function AccountingTab({ detail, onSelectRace }: { detail: RaceDetailDTO | null; onSelectRace: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<RaceStatus | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (status) p.set("status", status);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return p;
  }, [q, status, from, to]);
  const { data, error } = useAccounting(params);

  return (
    <div className="space-y-10">
      {detail && <RacePanel detail={detail} partners={data?.partners} />}

      <section>
        <SectionTitle
          sub="Toutes les courses. Le revenu ne compte que les montants définitivement acquis ; les mises en attente de résultat sont des fonds détenus."
          aside={<ExportButtons />}
        >
          Comptabilité globale
        </SectionTitle>

        <div className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_14rem_10rem_10rem]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-dim" {...ICON} />
            <Input className="pl-9" placeholder="Rechercher une course…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher une course" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value as RaceStatus | "")} aria-label="Filtrer par statut">
            <option value="">Tous les statuts</option>
            {RACE_STATUSES.map((s) => <option key={s} value={s}>{RACE_STATUS_LABEL[s]}</option>)}
          </Select>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Du" title="Du (date de course)" />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Au" title="Au (date de course)" />
        </div>

        {error && !data ? (
          <p className="text-sm text-[#ff8a95]">{error.message}</p>
        ) : !data ? (
          <div className="grid place-items-center py-20"><Spinner className="h-7 w-7" /></div>
        ) : (
          <GlobalView data={data} onSelectRace={onSelectRace} />
        )}
      </section>
    </div>
  );
}

function RacePanel({ detail, partners }: { detail: RaceDetailDTO; partners?: GlobalAccountingDTO["partners"] }) {
  const a = detail.accounting;
  const { race } = detail;
  const cancelled = race.status === "cancelled" || race.status === "refunded";
  return (
    <section>
      <SectionTitle sub={race.description ?? undefined} aside={<StatusBadge status={race.status} />}>
        {race.name}
      </SectionTitle>
      <div className="grid gap-4 lg:grid-cols-[1.1fr_2fr]">
        <Plate glow>
          <div className="flex h-full flex-col justify-between gap-6 p-6">
            <div>
              <div className="font-cond text-sm font-semibold tracking-[0.06em] text-mute">
                {a.organizerRevenue === null ? "Fonds détenus (en attente de résultat)" : "Revenu définitif de l'organisateur"}
              </div>
              <div className="mt-2 font-display text-[clamp(2.2rem,5vw,3.4rem)] leading-none font-bold text-flame text-glow tabular-nums">
                {formatMoney(a.organizerRevenue ?? a.pendingStakes)}
              </div>
              <p className="mt-3 text-sm text-mute">
                {a.organizerRevenue === null
                  ? "Ces mises ne sont pas un bénéfice : leur répartition dépend du résultat (ou d'une annulation)."
                  : cancelled
                    ? "Course annulée : aucune commission, toutes les mises sont remboursées."
                    : a.noWinner
                      ? "Aucun pari sur le vainqueur : la cagnotte entière est conservée (commission incluse, comptée une seule fois)."
                      : `Commission de ${formatPercentBps(a.commissionBps)} prélevée sur la cagnotte.`}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4 border-t border-line pt-4">
              <Stat label="Fonds encore en caisse" value={formatMoney(a.cashHeld)} hint="Mises − versements − remboursements" />
              <Stat label="Parieurs / pilotes" value={`${a.bettorCount} / ${a.driverCount}`} />
            </div>
          </div>
        </Plate>
        <Plate>
          <dl className="grid gap-x-8 p-6 sm:grid-cols-2">
            <Line label="Total des mises encaissées" value={a.totalStakes} />
            <Line label={`Commission théorique (${formatPercentBps(a.commissionBps)})`} value={a.commissionTheoretical} />
            <Line label="Commission réellement conservée" value={a.commissionKept} pending="Selon le résultat" />
            <Line label="Cagnotte distribuable" value={cancelled ? 0 : a.distributable} />
            <Line label="Somme totale due aux gagnants" value={a.dueToWinners} />
            <Line label="Somme déjà versée" value={a.paidToWinners} />
            <Line label="Reste à payer" value={a.remainingToPay} strong={a.remainingToPay > 0} />
            <Line label="Conservé (aucun gagnant)" value={a.noWinnerKept} />
            {cancelled && (
              <>
                <Line label="Remboursements dus" value={a.refundsDue} />
                <Line label="Remboursements effectués" value={a.refundsPaid} />
                <Line label="Reste à rembourser" value={a.refundsRemaining} strong={a.refundsRemaining > 0} />
              </>
            )}
            <Line label="Montant total conservé par l'organisateur" value={a.organizerRevenue} pending="Non déterminé" strong />
          </dl>
        </Plate>
      </div>
      {!cancelled && partners && <RacePartnersPanel overview={partners} raceId={race.id} pending={a.organizerRevenue === null} />}
    </section>
  );
}

function Line({ label, value, strong, pending = "—" }: { label: string; value: number | null; strong?: boolean; pending?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.05] py-2.5">
      <dt className="text-sm text-mute">{label}</dt>
      <dd className={cx("text-right font-display tabular-nums", strong ? "font-bold text-flame-soft" : "font-semibold text-ink")}>
        {value === null ? <span className="font-sans text-sm font-normal text-dim">{pending}</span> : formatMoney(value)}
      </dd>
    </div>
  );
}

function GlobalView({ data, onSelectRace }: { data: GlobalAccountingDTO; onSelectRace: (id: string) => void }) {
  const g = data.global;
  const visibleIds = useMemo(() => new Set(data.races.map((r) => r.id)), [data.races]);
  const partnerRaces = data.partners.races.filter((r) => visibleIds.has(r.raceId));
  const partnersDue = partnerRaces.reduce((s, r) => s + r.revenue, 0);
  const partnersPaid = partnerRaces.reduce((s, r) => s + r.shares.reduce((x, sh) => x + (sh.status === "paid" ? sh.amount : 0), 0), 0);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[1.25fr_1fr_1fr]">
        <Plate glow className="md:col-span-2 lg:col-span-1 lg:row-span-2">
          <div className="flex h-full flex-col justify-between gap-6 p-6">
            <div>
              <div className="font-cond text-sm font-semibold tracking-[0.06em] text-mute">Revenu total définitivement acquis</div>
              <div className="mt-2 font-display text-[clamp(2.4rem,5.5vw,3.8rem)] leading-none font-bold text-flame text-glow tabular-nums">{formatMoney(g.revenue)}</div>
              <dl className="mt-5 space-y-2 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-mute">Commissions acquises</dt><dd className="font-display font-semibold tabular-nums">{formatMoney(g.commissionsEarned)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-mute">Cagnottes conservées sans gagnant</dt><dd className="font-display font-semibold tabular-nums">{formatMoney(g.noWinnerKept)}</dd></div>
              </dl>
            </div>
            <p className="text-xs text-dim">Les deux postes sont exclusifs pour une même course : aucun double comptage.</p>
          </div>
        </Plate>
        <Plate><div className="grid grid-cols-2 gap-4 p-5">
          <Stat label="Courses" value={g.raceCount} />
          <Stat label="Actives" value={g.activeCount} />
          <Stat label="Terminées" value={g.finishedCount} />
          <Stat label="Annulées" value={g.cancelledCount} />
        </div></Plate>
        <Plate><div className="grid grid-cols-2 gap-4 p-5">
          <Stat label="Total historique des mises" value={formatMoney(g.totalStakes)} className="col-span-2" />
          <Stat label="Mises en attente" value={formatMoney(g.pendingStakes)} hint="Fonds détenus, pas un bénéfice" />
          <Stat label="Fonds en caisse" value={formatMoney(g.cashHeld)} />
        </div></Plate>
        <Plate><div className="grid grid-cols-2 gap-4 p-5">
          <Stat label="Gains restant à payer" value={formatMoney(g.remainingToPay)} accent={g.remainingToPay > 0} />
          <Stat label="Gains déjà versés" value={formatMoney(g.paidToWinners)} />
          {(g.refundsRemaining > 0 || g.refundsPaid > 0) && (
            <>
              <Stat label="Remboursements restants" value={formatMoney(g.refundsRemaining)} accent={g.refundsRemaining > 0} />
              <Stat label="Mises remboursées" value={formatMoney(g.refundsPaid)} />
            </>
          )}
        </div></Plate>
        <Plate><div className="grid grid-cols-2 gap-4 p-5">
          <Stat label="Reste à verser aux associés" value={formatMoney(partnersDue - partnersPaid)} accent={partnersDue - partnersPaid > 0} />
          <Stat label="Déjà versé aux associés" value={formatMoney(partnersPaid)} />
        </div></Plate>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <BarChart title="Mises par jour de course" rows={data.daily.map((d) => ({ key: d.day, value: d.stakes }))} />
        <BarChart title="Revenu acquis par jour de course" rows={data.daily.map((d) => ({ key: d.day, value: d.revenue }))} />
      </div>

      <RaceTable rows={data.races} partners={data.partners} onSelectRace={onSelectRace} />
      <BackupPanel data={data} />
    </div>
  );
}

/** Histogramme mono-série (une seule échelle, pas de légende nécessaire : le titre nomme la série). */
function BarChart({ title, rows }: { title: string; rows: { key: string; value: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.value));
  const W = 600;
  const H = 180;
  const gap = 2;
  const bw = rows.length ? Math.min(44, Math.max(3, (W - gap * (rows.length - 1)) / rows.length)) : 0;
  const empty = rows.every((r) => r.value === 0);
  const ticks = [0, 0.5, 1];
  const shown = hover !== null ? rows[hover] : null;

  return (
    <Plate>
      <div className="p-5">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h3 className="font-display text-[0.95rem] font-semibold">{title}</h3>
          <span className="text-sm tabular-nums text-mute">
            {shown ? <>{formatDate(shown.key + "T12:00:00Z")} · <b className="text-ink">{formatMoney(shown.value)}</b></> : rows.length ? `${rows.length} jour${rows.length > 1 ? "s" : ""}` : ""}
          </span>
        </div>
        {rows.length === 0 || empty ? (
          <p className="py-12 text-center text-sm text-dim">{rows.length === 0 ? "Pas encore de données sur la période." : "Aucun montant sur la période."}</p>
        ) : (
          <svg
            viewBox={`0 0 ${W} ${H + 18}`}
            className="h-auto w-full touch-pan-y select-none"
            role="img"
            aria-label={title}
            onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={0} x2={W} y1={H - t * H} y2={H - t * H} stroke="rgb(255 255 255 / 0.07)" strokeDasharray={t === 0 ? undefined : "2 4"} />
                {t > 0 && <text x={W} y={H - t * H - 4} textAnchor="end" fontSize="10" fill="#5d5d63">{formatMoney(Math.round(max * t))}</text>}
              </g>
            ))}
            {rows.map((r, i) => {
              const h = r.value > 0 ? Math.max(2, (r.value / max) * (H - 14)) : 0;
              const x = i * (bw + gap);
              return (
                <g key={r.key} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
                  <rect x={x} y={0} width={bw + gap} height={H} fill="transparent" />
                  <path
                    d={h > 4 ? `M${x},${H} V${H - h + 4} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${H} Z` : `M${x},${H} V${H - h} h${bw} V${H} Z`}
                    fill={hover === i ? "#FF8C00" : "#FF6B00"}
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                </g>
              );
            })}
            {rows.length > 0 && (
              <>
                <text x={0} y={H + 14} fontSize="10" fill="#5d5d63">{formatDate(rows[0]!.key + "T12:00:00Z")}</text>
                {rows.length > 1 && <text x={W} y={H + 14} textAnchor="end" fontSize="10" fill="#5d5d63">{formatDate(rows[rows.length - 1]!.key + "T12:00:00Z")}</text>}
              </>
            )}
          </svg>
        )}
      </div>
    </Plate>
  );
}

function RaceTable({ rows, partners, onSelectRace }: { rows: AccountingRowDTO[]; partners: GlobalAccountingDTO["partners"]; onSelectRace: (id: string) => void }) {
  const byRace = new Map(partners.races.map((r) => [r.raceId, r]));
  if (rows.length === 0) {
    return <Plate><EmptyState icon={<Search className="h-6 w-6" {...ICON} />} title="Aucune course sur ces critères">Modifiez la période, le statut ou la recherche.</EmptyState></Plate>;
  }
  const cell = (a: RaceAccounting, v: number | null) => (v === null ? <span className="text-dim">—</span> : formatMoney(v));
  return (
    <Plate>
      <div className="max-h-[65vh] overflow-auto overscroll-x-contain pointer-coarse:max-h-none">
        <table className="data-table sticky-first min-w-[1100px] text-sm">
          <thead>
            <tr>
              <th>Course</th>
              <th>Statut</th>
              <th className="num">Parieurs</th>
              <th className="num">Mises</th>
              <th className="num">Comm.</th>
              <th className="num">Comm. acquise</th>
              <th className="num">Dû gagnants</th>
              <th className="num">Reste à payer</th>
              <th className="num">Reste aux associés</th>
              <th className="num">Revenu</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const a = r.accounting;
              return (
                <tr key={r.id} className="cursor-pointer" onClick={() => onSelectRace(r.id)} title="Afficher cette course">
                  <td>
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-dim">{formatDateTime(r.scheduledAt ?? r.createdAt)}</div>
                  </td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="num">{a.bettorCount}</td>
                  <td className="num font-display">{formatMoney(a.totalStakes)}</td>
                  <td className="num text-mute">{formatPercentBps(a.commissionBps)}</td>
                  <td className="num">{a.noWinner ? <Tag tone="result">Sans gagnant</Tag> : cell(a, a.commissionKept)}</td>
                  <td className="num">{formatMoney(a.dueToWinners)}</td>
                  <td className={cx("num", a.remainingToPay > 0 && "text-flame")}>{formatMoney(a.remainingToPay)}</td>
                  <td className="num">
                    {a.refundsRemaining > 0 ? (
                      <span className="text-caution" title="Remboursements restant à effectuer">{formatMoney(a.refundsRemaining)} <span className="text-xs">à rembourser</span></span>
                    ) : (
                      <span className={cx(remainingForRace(byRace.get(r.id)) > 0 && "text-flame")}>{formatMoney(remainingForRace(byRace.get(r.id)))}</span>
                    )}
                  </td>
                  <td className="num font-display font-semibold text-flame-soft">{cell(a, a.organizerRevenue)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Plate>
  );
}

function ExportButtons() {
  const links = [
    { href: "/api/export/csv?type=courses", label: "CSV courses", icon: FileSpreadsheet, v: "ghost" as const },
    { href: "/api/export/csv?type=paris", label: "CSV paris", icon: FileSpreadsheet, v: "ghost" as const },
    { href: "/api/export/csv?type=reglements", label: "CSV règlements", icon: FileSpreadsheet, v: "ghost" as const },
    { href: "/api/export/csv?type=associes", label: "CSV associés", icon: FileSpreadsheet, v: "ghost" as const },
  ];
  return (
    <>
      {links.map((l) => (
        <a key={l.href} href={l.href} download className={buttonClasses(l.v, "sm")}>
          <l.icon className="h-4 w-4" {...ICON} />
          {l.label}
        </a>
      ))}
    </>
  );
}

function BackupPanel({ data }: { data: GlobalAccountingDTO }) {
  const b = data.backup;
  return (
    <Plate>
      <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          {b.configured ? (
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-go" {...ICON} />
          ) : (
            <CloudOff className="mt-0.5 h-5 w-5 shrink-0 text-caution" {...ICON} />
          )}
          <div>
            <div className="font-display font-semibold">{b.configured ? "Sauvegardes automatiques configurées" : "Sauvegardes automatiques non configurées"}</div>
            <p className="mt-0.5 text-sm text-mute">
              {b.configured
                ? b.lastBackupAt
                  ? `Dernière sauvegarde réussie : ${formatDateTime(b.lastBackupAt)} (quotidienne, Cloudflare R2).`
                  : "Aucune sauvegarde réussie enregistrée pour l'instant. La tâche s'exécute une fois par jour."
                : `Variables manquantes : ${b.missing.join(", ")}.`}
            </p>
            {b.lastFailureAt && <p className="mt-1 text-sm text-[#ff8a95]">Échec le {formatDateTime(b.lastFailureAt)} : {b.lastFailureMessage}</p>}
          </div>
        </div>
      </div>
    </Plate>
  );
}
