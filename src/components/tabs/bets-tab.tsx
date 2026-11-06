"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowDownUp, Ban, CheckCircle2, Lock, Search, ShieldAlert, Ticket } from "lucide-react";
import { api, refreshAll } from "@/lib/api-client";
import type { BetRowDTO, RaceDetailDTO } from "@/lib/dto";
import { amountSchema } from "@/lib/validation";
import { formatDateTime, formatMoney, formatOdds, formatTime } from "@/lib/format";
import { PAYMENT_LABEL, type PaymentState } from "@/lib/status";
import { Button, EmptyState, Field, ICON, Input, Modal, PaymentBadge, Plate, SectionTitle, Select, Stat, SummaryRow, Tag, cx } from "../ui";

const PAGE = 200;

export function BetsTab({ detail, onGoToDrivers }: { detail: RaceDetailDTO; onGoToDrivers: () => void }) {
  const { race } = detail;
  const [closeOpen, setCloseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const canCancel = race.status === "draft" || race.status === "open" || race.status === "closed";

  async function act(path: "close" | "cancel") {
    setBusy(true);
    try {
      await api(`/api/races/${race.id}/${path}`, { method: "POST" });
      toast.success(path === "close" ? "Paris clôturés" : "Course annulée", {
        description: path === "close" ? "Cotes figées. Vous pouvez enregistrer le résultat." : "Tous les parieurs sont à rembourser intégralement.",
      });
      setCloseOpen(false);
      setCancelOpen(false);
      await refreshAll();
    } catch (e) {
      toast.error("Action impossible", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const a = detail.accounting;
  const hasResult = race.status === "result" || race.status === "paid";
  const cancelled = race.status === "cancelled" || race.status === "refunded";

  return (
    <div className="space-y-6">
      <SectionTitle
        sub={
          {
            draft: "Les paris ne sont pas encore ouverts. Ouvrez-les depuis l'onglet Pilotes.",
            open: "Un seul pari par joueur et par course. Tout pari confirmé est définitif.",
            closed: "Paris clôturés : aucune nouvelle mise. Cotes définitives.",
            result: "Versez les gains puis marquez chaque paiement comme payé.",
            paid: "Tous les gains ont été versés.",
            cancelled: "Course annulée : remboursez chaque parieur puis marquez-le remboursé.",
            refunded: "Tous les remboursements ont été effectués.",
          }[race.status]
        }
        aside={
          <>
            {canCancel && (
              <Button variant="danger" icon={<Ban className="h-4 w-4" {...ICON} />} onClick={() => setCancelOpen(true)}>
                Annuler la course
              </Button>
            )}
            {race.status === "open" && (
              <Button size="lg" icon={<Lock className="h-4 w-4" {...ICON} />} onClick={() => setCloseOpen(true)}>
                CLÔTURER LES PARIS
              </Button>
            )}
            {race.status === "draft" && <Button variant="outline" onClick={onGoToDrivers}>Aller aux pilotes</Button>}
          </>
        }
      >
        Paris
      </SectionTitle>

      {race.status === "open" && <BetForm detail={detail} />}

      {(hasResult || cancelled) && (
        <Plate glow>
          <div className="grid grid-cols-2 gap-5 p-5 md:grid-cols-4">
            {cancelled ? (
              <>
                <Stat label="Remboursements dus" value={formatMoney(a.refundsDue)} />
                <Stat label="Déjà remboursé" value={formatMoney(a.refundsPaid)} />
                <Stat label="Reste à rembourser" value={formatMoney(a.refundsRemaining)} accent />
                <Stat label="Commission prélevée" value={formatMoney(0)} hint="Aucune commission en cas d'annulation" />
              </>
            ) : (
              <>
                <Stat label="Gagnants" value={detail.bets.filter((b) => b.outcome === "winner").length} hint={detail.result?.noWinner ? "Aucun pari sur le vainqueur" : undefined} />
                <Stat label="Total dû aux gagnants" value={formatMoney(a.dueToWinners)} />
                <Stat label="Reste à payer" value={formatMoney(a.remainingToPay)} accent />
                <Stat label="Conservé par l'organisateur" value={formatMoney(a.organizerRevenue)} />
              </>
            )}
          </div>
        </Plate>
      )}

      <BetTable detail={detail} />

      <Modal
        open={closeOpen}
        onOpenChange={setCloseOpen}
        size="sm"
        title="Clôturer les paris ?"
        description="Les nouvelles mises seront bloquées définitivement et les cotes figées. Ce n'est pas une annulation : les paris existants sont conservés."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCloseOpen(false)} disabled={busy}>Annuler</Button>
            <Button loading={busy} onClick={() => act("close")} icon={<Lock className="h-4 w-4" {...ICON} />}>Clôturer les paris</Button>
          </>
        }
      >
        <dl>
          <SummaryRow label="Course" value={race.name} />
          <SummaryRow label="Paris enregistrés" value={detail.bets.length} />
          <SummaryRow label="Cagnotte" value={formatMoney(detail.totalPool)} strong />
        </dl>
      </Modal>

      <Modal
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        size="sm"
        tone="danger"
        title="Annuler la course ?"
        description="Sans résultat officiel, tous les parieurs sont remboursés intégralement et aucune commission n'est prélevée. Action définitive."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelOpen(false)} disabled={busy}>Ne pas annuler</Button>
            <Button variant="danger" loading={busy} onClick={() => act("cancel")}>Annuler définitivement</Button>
          </>
        }
      >
        <dl>
          <SummaryRow label="Course" value={race.name} />
          <SummaryRow label="Parieurs à rembourser" value={detail.bets.length} />
          <SummaryRow label="Montant à rembourser" value={formatMoney(detail.totalPool)} strong />
          <SummaryRow label="Commission prélevée" value={formatMoney(0)} />
        </dl>
      </Modal>
    </div>
  );
}

function BetForm({ detail }: { detail: RaceDetailDTO }) {
  const { race, drivers } = detail;
  const [bettorName, setBettorName] = useState("");
  const [fivemId, setFivemId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [amount, setAmount] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string | null>(null);

  const parsed = amountSchema.safeParse(amount);
  const amountError = amount && !parsed.success ? parsed.error.issues[0]?.message : null;
  const driver = drivers.find((d) => d.id === driverId);
  const valid = bettorName.trim().length > 0 && !!driver && parsed.success;

  // Contrôle immédiat (non bloquant côté serveur, qui reste seul juge) : joueur déjà inscrit ?
  const already = useMemo(() => {
    const n = bettorName.trim().toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/\s+/g, " ");
    const f = fivemId.replace(/\s+/g, "").toLowerCase();
    if (!n && !f) return null;
    return detail.bets.find(
      (b) =>
        (f && b.fivemId?.toLowerCase() === f) ||
        (n && b.bettorName.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/\s+/g, " ") === n && (!f || !b.fivemId)),
    ) ?? null;
  }, [bettorName, fivemId, detail.bets]);

  function review(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    requestId.current = crypto.randomUUID(); // un identifiant par confirmation : double clic sans doublon
    setConfirm(true);
  }

  async function submit() {
    if (!valid || !parsed.success) return;
    setBusy(true);
    try {
      await api(`/api/races/${race.id}/bets`, {
        method: "POST",
        json: { bettorName, fivemId: fivemId || null, driverId, amount: parsed.data, requestId: requestId.current },
      });
      toast.success("Pari enregistré", { description: `${bettorName.trim()} · ${formatMoney(parsed.data)} sur ${driver!.name}` });
      setConfirm(false);
      setBettorName("");
      setFivemId("");
      setAmount("");
      setDriverId("");
      await refreshAll();
      document.getElementById("bettor-name")?.focus();
    } catch (e) {
      toast.error("Pari refusé", { description: (e as Error).message });
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Plate glow>
        <form onSubmit={review} className="grid gap-4 p-4 sm:p-5 md:grid-cols-2 xl:grid-cols-[1.3fr_1fr_1.2fr_1fr_auto] xl:items-start">
          <Field label="Nom RP du parieur" htmlFor="bettor-name" required error={already ? `Déjà parié : ${already.bettorName} (${formatMoney(already.amount)} sur ${already.driverName}).` : null}>
            <Input id="bettor-name" value={bettorName} onChange={(e) => setBettorName(e.target.value)} maxLength={60} autoComplete="off" placeholder="Ex. Tony Marchetti" />
          </Field>
          <Field label="Identifiant FiveM" htmlFor="fivem-id" hint="Facultatif (license:…, discord:…)">
            <Input id="fivem-id" value={fivemId} onChange={(e) => setFivemId(e.target.value)} maxLength={80} autoComplete="off" placeholder="license:…" />
          </Field>
          <Field label="Pilote" htmlFor="bet-driver" required>
            <Select id="bet-driver" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">Choisir un pilote…</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.number != null ? `#${d.number} ` : ""}{d.name} — {formatOdds(d.oddsCents)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Mise ($ fictifs)" htmlFor="bet-amount" required error={amountError}>
            <Input id="bet-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="10000" />
          </Field>
          <Button type="submit" size="lg" disabled={!valid || !!already} icon={<Ticket className="h-4 w-4" {...ICON} />} className="md:col-span-2 xl:col-span-1 xl:mt-[1.65rem]">
            Enregistrer
          </Button>
        </form>
      </Plate>

      <Modal
        open={confirm}
        onOpenChange={(o) => !busy && setConfirm(o)}
        size="md"
        title="Confirmer le pari"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)} disabled={busy}>Annuler</Button>
            <Button loading={busy} onClick={submit} icon={<Lock className="h-4 w-4" {...ICON} />}>Confirmer définitivement</Button>
          </>
        }
      >
        <dl>
          <SummaryRow label="Parieur" value={<>{bettorName.trim()}{fivemId.trim() && <span className="block text-xs text-mute">{fivemId.trim()}</span>}</>} />
          <SummaryRow label="Course" value={race.name} />
          <SummaryRow label="Pilote choisi" value={driver ? `${driver.number != null ? `#${driver.number} ` : ""}${driver.name}` : "—"} />
          <SummaryRow label="Montant de la mise" value={parsed.success ? formatMoney(parsed.data) : "—"} strong />
        </dl>
        <div className="chamfer-sm mt-4 flex gap-3 bg-stop/10 px-4 py-3 ring-1 ring-inset ring-stop/50">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-stop" {...ICON} />
          <p className="font-cond text-[0.95rem] font-semibold tracking-[0.03em] text-[#ffb3ba]">
            ATTENTION : CE PARI EST DÉFINITIF. AUCUNE MODIFICATION OU SUPPRESSION NE SERA POSSIBLE APRÈS VALIDATION.
          </p>
        </div>
      </Modal>
    </>
  );
}

type Sort = "date" | "amount-desc" | "amount-asc";

function BetTable({ detail }: { detail: RaceDetailDTO }) {
  const [q, setQ] = useState("");
  const [driver, setDriver] = useState("");
  const [outcome, setOutcome] = useState("");
  const [payment, setPayment] = useState<PaymentState | "">("");
  const [sort, setSort] = useState<Sort>("date");
  const [limit, setLimit] = useState(PAGE);

  const finalState = ["result", "paid", "cancelled", "refunded"].includes(detail.race.status);
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
    const out = detail.bets.filter(
      (b) =>
        (!n || b.bettorName.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").includes(n) || (b.fivemId ?? "").toLowerCase().includes(n)) &&
        (!driver || b.driverId === driver) &&
        (!outcome || b.outcome === outcome) &&
        (!payment || b.payment === payment),
    );
    if (sort === "amount-desc") out.sort((x, y) => y.amount - x.amount);
    else if (sort === "amount-asc") out.sort((x, y) => x.amount - y.amount);
    else out.sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1));
    return out;
  }, [detail.bets, q, driver, outcome, payment, sort]);
  const visibleTotal = rows.reduce((s, b) => s + b.amount, 0);
  const paymentOptions: PaymentState[] = finalState ? ["loser", "to_pay", "paid", "to_refund", "refunded"] : ["none"];

  return (
    <Plate>
      <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-dim" {...ICON} />
          <Input className="pl-9" placeholder="Rechercher un parieur ou un identifiant…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un parieur" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex">
          <Select value={driver} onChange={(e) => setDriver(e.target.value)} aria-label="Filtrer par pilote" className="lg:w-44">
            <option value="">Tous les pilotes</option>
            {detail.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Filtrer par résultat" className="lg:w-40" disabled={!finalState}>
            <option value="">Tous résultats</option>
            <option value="winner">Gagnants</option>
            <option value="loser">Perdants</option>
            <option value="refund">Remboursés / à rembourser</option>
          </Select>
          <Select value={payment} onChange={(e) => setPayment(e.target.value as PaymentState | "")} aria-label="Filtrer par paiement" className="lg:w-40" disabled={!finalState}>
            <option value="">Tous paiements</option>
            {paymentOptions.map((p) => <option key={p} value={p}>{PAYMENT_LABEL[p]}</option>)}
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Trier" className="lg:w-44">
            <option value="date">Plus récents</option>
            <option value="amount-desc">Mise décroissante</option>
            <option value="amount-asc">Mise croissante</option>
          </Select>
        </div>
      </div>

      {detail.bets.length === 0 ? (
        <EmptyState icon={<Ticket className="h-6 w-6" {...ICON} />} title="Aucun pari enregistré">
          {detail.race.status === "open" ? "Saisissez le premier pari avec le formulaire ci-dessus." : "Aucun pari n'a été placé sur cette course."}
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Search className="h-6 w-6" {...ICON} />} title="Aucun résultat">Aucun pari ne correspond aux filtres.</EmptyState>
      ) : (
        <div className="max-h-[70vh] overflow-auto">
          <table className="data-table min-w-[920px] text-sm">
            <thead>
              <tr>
                <th>Parieur</th>
                <th>Pilote</th>
                <th className="num"><span className="inline-flex items-center gap-1"><ArrowDownUp className="h-3 w-3" {...ICON} />Mise</span></th>
                <th className="num">{detail.oddsFinal ? "Cote finale" : "Cote indicative"}</th>
                <th>Résultat</th>
                <th className="num">À percevoir</th>
                <th>Paiement</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((b) => <BetRow key={b.id} b={b} />)}
            </tbody>
          </table>
          {rows.length > limit && (
            <div className="flex justify-center p-4">
              <Button variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>Afficher {Math.min(PAGE, rows.length - limit)} de plus</Button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-sm text-mute">
        <span>{rows.length} pari{rows.length > 1 ? "s" : ""} affiché{rows.length > 1 ? "s" : ""} sur {detail.bets.length}</span>
        <span>Total des mises visibles <b className="ml-1 font-display text-base text-flame-soft tabular-nums">{formatMoney(visibleTotal)}</b></span>
      </div>
    </Plate>
  );
}

function BetRow({ b }: { b: BetRowDTO }) {
  const [arm, setArm] = useState(false);
  const [busy, setBusy] = useState(false);
  const payable = b.settlement && b.settlement.status === "pending";

  async function pay() {
    if (!b.settlement) return;
    setBusy(true);
    try {
      const r = await api<{ alreadyPaid: boolean }>(`/api/settlements/${b.settlement.id}/pay`, { method: "POST" });
      const what = b.settlement.kind === "payout" ? "Paiement" : "Remboursement";
      if (r.alreadyPaid) toast.info(`${what} déjà enregistré`, { description: "Aucune double comptabilisation." });
      else toast.success(`${what} enregistré`, { description: `${b.bettorName} · ${formatMoney(b.settlement.amountDue)}` });
      await refreshAll();
    } catch (e) {
      toast.error("Enregistrement impossible", { description: (e as Error).message });
    } finally {
      setBusy(false);
      setArm(false);
    }
  }

  return (
    <tr className={cx(b.outcome === "winner" && "bg-flame/[0.05]")}>
      <td>
        <div className="font-medium">{b.bettorName}</div>
        <div className="text-xs text-dim">{b.fivemId ?? "—"} · {formatTime(b.createdAt)}</div>
      </td>
      <td className="whitespace-nowrap">
        {b.driverNumber != null && <span className="mr-1.5 font-display text-mute">#{b.driverNumber}</span>}
        {b.driverName}
      </td>
      <td className="num font-display font-semibold">{formatMoney(b.amount)}</td>
      <td className="num font-display text-flame-soft">{formatOdds(b.oddsCents)}</td>
      <td>
        {b.outcome === "winner" ? <Tag tone="live">Gagnant</Tag> : b.outcome === "loser" ? <Tag tone="muted">Perdant</Tag> : b.outcome === "refund" ? <Tag tone="locked">Remboursement</Tag> : <span className="text-dim">En attente</span>}
      </td>
      <td className="num">
        {b.amountDue == null ? (
          <span className="text-dim">—</span>
        ) : (
          <span className={cx("font-display font-semibold", b.indicative ? "text-mute" : b.amountDue > 0 ? "text-flame" : "text-dim")} title={b.indicative ? "Gain indicatif si ce pilote gagne, susceptible d'évoluer" : undefined}>
            {b.indicative && <span className="mr-1 text-xs font-normal">≈</span>}
            {formatMoney(b.amountDue)}
          </span>
        )}
      </td>
      <td>
        <PaymentBadge state={b.payment} />
        {b.settlement?.paidAt && <div className="mt-0.5 text-[0.7rem] text-dim">{formatDateTime(b.settlement.paidAt)}</div>}
      </td>
      <td className="text-right">
        {payable ? (
          arm ? (
            <span className="inline-flex gap-1">
              <Button size="sm" variant="success" loading={busy} onClick={pay} icon={<CheckCircle2 className="h-3.5 w-3.5" {...ICON} />}>Confirmer</Button>
              <Button size="sm" variant="ghost" onClick={() => setArm(false)} disabled={busy}>Non</Button>
            </span>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setArm(true)}>
              {b.settlement!.kind === "payout" ? "Marquer payé" : "Marquer remboursé"}
            </Button>
          )
        ) : b.payment === "to_pay" || b.payment === "to_refund" ? (
          <AlertTriangle className="ml-auto h-4 w-4 text-caution" {...ICON} />
        ) : null}
      </td>
    </tr>
  );
}
