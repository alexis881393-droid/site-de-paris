"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import * as Popover from "@radix-ui/react-popover";
import { ArrowDown, ArrowUp, Check, Flag, Lock, Pencil, Plus, Search, Trash2, Trophy, Unlock, X } from "lucide-react";
import { api, refreshAll, useKnownDrivers } from "@/lib/api-client";
import type { DriverRowDTO, KnownDriverDTO, RaceDetailDTO } from "@/lib/dto";
import { normalizeName } from "@/lib/identity";
import { computeCommission, planResult } from "@/lib/finance";
import { formatDateTime, formatMoney, formatOdds, formatPercentBps, formatShare } from "@/lib/format";
import { Button, EmptyState, Field, ICON, Input, Modal, Plate, SectionTitle, SummaryRow, Tag, cx } from "../ui";

export function DriversTab({ detail, onGoToBets }: { detail: RaceDetailDTO; onGoToBets: () => void }) {
  const { race, drivers } = detail;
  const draft = race.status === "draft";
  const [openConfirm, setOpenConfirm] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const maxPool = Math.max(0, ...drivers.map((d) => d.pool));

  async function openBets() {
    setBusy(true);
    try {
      await api(`/api/races/${race.id}/open`, { method: "POST" });
      toast.success("Paris ouverts", { description: "La liste des pilotes est désormais verrouillée." });
      setOpenConfirm(false);
      await refreshAll();
    } catch (e) {
      toast.error("Ouverture impossible", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const sub = {
    draft: "Course en préparation : ajoutez, corrigez ou retirez les pilotes, puis ouvrez les paris.",
    open: "Paris ouverts : liste verrouillée. Cotes provisoires, recalculées à chaque mise.",
    closed: "Paris clôturés : cotes définitives. Enregistrez le résultat officiel.",
    result: "Résultat officiel enregistré. Seule la première place rapporte des gains.",
    paid: "Course terminée : tous les gains sont réglés.",
    cancelled: "Course annulée : toutes les mises sont remboursées, sans commission.",
    refunded: "Course annulée : remboursements terminés.",
  }[race.status];

  return (
    <div className="space-y-6">
      <SectionTitle
        sub={sub}
        aside={
          <>
            {draft && (
              <Button icon={<Unlock className="h-4 w-4" {...ICON} />} disabled={drivers.length < 2} title={drivers.length < 2 ? "Au moins deux pilotes" : undefined} onClick={() => setOpenConfirm(true)}>
                Ouvrir les paris
              </Button>
            )}
            {race.status === "open" && (
              <Button variant="outline" onClick={onGoToBets}>Enregistrer un pari</Button>
            )}
            {race.status === "closed" && (
              <Button icon={<Trophy className="h-4 w-4" {...ICON} />} onClick={() => setResultOpen(true)} disabled={drivers.length === 0}>
                Enregistrer le résultat
              </Button>
            )}
          </>
        }
      >
        Pilotes &amp; cotes
      </SectionTitle>

      {draft && <AddDriverForm raceId={race.id} current={drivers} />}

      <Plate glow={race.status === "open"}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="font-cond text-sm font-semibold tracking-[0.1em] text-mute">TOUR DES COTES</span>
            {detail.oddsFinal ? (
              <Tag tone="locked"><Lock className="h-3 w-3" {...ICON} />Cotes définitives</Tag>
            ) : race.status === "open" ? (
              <Tag tone="live" dot>En direct</Tag>
            ) : null}
          </div>
          <div className="flex gap-5 text-sm text-mute">
            <span>Cagnotte <b className="font-display text-ink tabular-nums">{formatMoney(detail.closure?.totalPool ?? detail.totalPool)}</b></span>
            <span>Distribuable <b className="font-display text-flame-soft tabular-nums">{formatMoney(detail.distributable)}</b></span>
          </div>
        </div>

        {drivers.length === 0 ? (
          <EmptyState icon={<Flag className="h-6 w-6" {...ICON} />} title="Aucun pilote">
            {draft ? "Ajoutez au moins deux pilotes avec le formulaire ci-dessus." : "Cette course n'a aucun pilote."}
          </EmptyState>
        ) : (
          <>
            {detail.totalPool === 0 && race.status !== "draft" && (
              <p className="border-b border-line bg-flame/[0.04] px-5 py-2.5 text-sm text-mute">
                Aucune mise enregistrée pour l&apos;instant : les cotes apparaîtront dès le premier pari.
              </p>
            )}
            <ol>
              {drivers.map((d, i) => (
                <DriverRow key={d.id} d={d} index={i} totalPool={detail.totalPool} maxPool={maxPool} editable={draft} raceId={race.id} />
              ))}
            </ol>
          </>
        )}
      </Plate>

      <p className="text-xs text-dim">
        Cote = cagnotte distribuable ÷ mises sur le pilote (pari mutuel). Affichage tronqué à deux décimales ; les gains réels sont calculés
        sur les montants exacts. Commission de la course : {formatPercentBps(race.commissionBps)}.
      </p>

      <Modal
        open={openConfirm}
        onOpenChange={setOpenConfirm}
        size="sm"
        title="Ouvrir les paris ?"
        description="À l'ouverture, la liste des pilotes est verrouillée définitivement : plus aucun ajout, retrait ni correction."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpenConfirm(false)} disabled={busy}>Annuler</Button>
            <Button loading={busy} onClick={openBets} icon={<Unlock className="h-4 w-4" {...ICON} />}>Ouvrir les paris</Button>
          </>
        }
      >
        <dl>
          <SummaryRow label="Course" value={race.name} />
          <SummaryRow label="Pilotes engagés" value={drivers.length} />
          <SummaryRow label="Commission" value={formatPercentBps(race.commissionBps)} />
        </dl>
      </Modal>

      {race.status === "closed" && <ResultDialog open={resultOpen} onOpenChange={setResultOpen} detail={detail} />}
    </div>
  );
}

function DriverRow({ d, index, totalPool, maxPool, editable, raceId }: { d: DriverRowDTO; index: number; totalPool: number; maxPool: number; editable: boolean; raceId: string }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(d.name);
  const [number, setNumber] = useState(d.number?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const width = maxPool > 0 ? Math.max(2, (d.pool / maxPool) * 100) : 0;

  async function save() {
    setBusy(true);
    try {
      await api(`/api/races/${raceId}/drivers/${d.id}`, { method: "PATCH", json: { name, number: number || null } });
      toast.success("Pilote corrigé");
      setEditing(false);
      await refreshAll();
    } catch (e) {
      toast.error("Correction impossible", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await api(`/api/races/${raceId}/drivers/${d.id}`, { method: "DELETE" });
      toast.success("Pilote retiré", { description: d.name });
      await refreshAll();
    } catch (e) {
      toast.error("Retrait impossible", { description: (e as Error).message });
      setBusy(false);
    }
  }

  return (
    <li
      className={cx(
        "relative grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-white/[0.05] px-4 py-3.5 last:border-0 sm:grid-cols-[3.75rem_minmax(0,1.4fr)_minmax(0,1fr)_8.5rem] sm:px-5",
        d.isWinner && "bg-gradient-to-r from-flame/15 via-flame/[0.04] to-transparent",
      )}
    >
      {d.isWinner && <span className="absolute inset-y-0 left-0 w-1 bg-flame shadow-[0_0_14px_rgb(255_107_0)]" aria-hidden />}
      {/* Numéro / position */}
      <div className={cx("chamfer-sm grid h-11 place-items-center font-display text-lg font-bold tabular-nums", d.isWinner ? "bg-flame text-black" : "bg-pit text-ink ring-1 ring-inset ring-line-strong")}>
        {d.number ?? <span className="text-sm text-dim">P{index + 1}</span>}
      </div>

      {/* Nom */}
      <div className="min-w-0">
        {editing ? (
          <div className="flex flex-wrap gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="h-9 min-w-40 flex-1" aria-label="Nom du pilote" autoFocus />
            <Input value={number} onChange={(e) => setNumber(e.target.value)} inputMode="numeric" className="h-9 w-20" placeholder="N°" aria-label="Numéro" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="truncate font-display text-[1.02rem] font-semibold">{d.name}</span>
              {d.isWinner && <Tag tone="live"><Trophy className="h-3 w-3" {...ICON} />Vainqueur</Tag>}
              {!d.isWinner && d.finalPosition && <Tag tone="muted">P{d.finalPosition}</Tag>}
            </div>
            <div className="mt-0.5 text-xs text-mute tabular-nums">
              {d.betCount} parieur{d.betCount > 1 ? "s" : ""} · {formatMoney(d.pool)} · {formatShare(d.pool, totalPool)}
            </div>
          </>
        )}
      </div>

      {/* Part de la cagnotte */}
      <div className="col-span-3 sm:col-span-1">
        <div className="track-bar h-2 w-full">
          <div className="h-full bg-gradient-to-r from-flame/60 to-flame-hot transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]" style={{ width: `${width}%` }} />
        </div>
      </div>

      {/* Cote */}
      <div className="col-start-3 row-start-1 flex items-center justify-end gap-2 sm:col-start-auto sm:row-start-auto">
        {editable ? (
          editing ? (
            <>
              <Button size="sm" variant="success" loading={busy} onClick={save} aria-label="Enregistrer"><Check className="h-4 w-4" {...ICON} /></Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setName(d.name); setNumber(d.number?.toString() ?? ""); }} aria-label="Annuler"><X className="h-4 w-4" {...ICON} /></Button>
            </>
          ) : confirmDelete ? (
            <>
              <Button size="sm" variant="danger" loading={busy} onClick={remove}>Retirer</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} aria-label="Annuler"><X className="h-4 w-4" {...ICON} /></Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Corriger ${d.name}`}><Pencil className="h-4 w-4" {...ICON} /></Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} aria-label={`Retirer ${d.name}`}><Trash2 className="h-4 w-4" {...ICON} /></Button>
            </>
          )
        ) : d.oddsCents === null ? (
          <span className="text-sm text-dim">Aucune mise</span>
        ) : (
          <span className={cx("font-display text-[1.65rem] leading-none font-bold tabular-nums", d.isWinner || d.oddsCents >= 100 ? "text-flame text-glow" : "text-flame-soft")}>
            {formatOdds(d.oddsCents)}
          </span>
        )}
      </div>
    </li>
  );
}

function AddDriverForm({ raceId, current }: { raceId: string; current: DriverRowDTO[] }) {
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: known } = useKnownDrivers(true);

  // Pilotes déjà créés lors des courses précédentes, sauf ceux déjà engagés dans cette course.
  const available = useMemo(() => {
    const taken = new Set(current.map((d) => normalizeName(d.name)));
    return (known ?? []).filter((k) => !taken.has(k.nameKey));
  }, [known, current]);

  async function add(driverName: string, driverNumber: string | number | null) {
    setBusy(true);
    try {
      await api(`/api/races/${raceId}/drivers`, { method: "POST", json: { name: driverName, number: driverNumber ?? null } });
      toast.success("Pilote ajouté", { description: driverName.trim() });
      await refreshAll();
      return true;
    } catch (err) {
      toast.error("Ajout impossible", { description: (err as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (await add(name, number || null)) {
      setName("");
      setNumber("");
      document.getElementById("driver-name")?.focus();
    }
  }

  async function pickKnown(key: string) {
    const k = available.find((x) => x.nameKey === key);
    if (!k) return;
    // Numéro repris s'il est libre dans cette course, sinon le pilote est ajouté sans numéro.
    const numberFree = k.number != null && !current.some((d) => d.number === k.number);
    await add(k.name, numberFree ? k.number : null);
  }

  return (
    <Plate>
      {(known?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-end sm:p-5">
          <div className="flex-1">
            <Field
              label="Pilote déjà enregistré"
              htmlFor="known-driver"
              hint={available.length ? `${available.length} pilote${available.length > 1 ? "s" : ""} disponible${available.length > 1 ? "s" : ""}. Tapez le début du nom, puis Entrée ou clic pour l'ajouter.` : "Tous les pilotes enregistrés sont déjà dans cette course."}
            >
              <KnownDriverSearch options={available} disabled={busy || available.length === 0} onPick={(k) => pickKnown(k.nameKey)} />
            </Field>
          </div>
        </div>
      )}
      <form onSubmit={submit} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:p-5">
        <div className="flex-1">
          <Field label="Nouveau pilote (nom RP)" htmlFor="driver-name" required>
            <Input id="driver-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Ex. Lena « Spark » Varga" autoComplete="off" />
          </Field>
        </div>
        <div className="sm:w-32">
          <Field label="Numéro" htmlFor="driver-number" hint="Facultatif">
            <Input id="driver-number" value={number} onChange={(e) => setNumber(e.target.value)} inputMode="numeric" placeholder="27" />
          </Field>
        </div>
        <Button type="submit" loading={busy} disabled={!name.trim()} icon={<Plus className="h-4 w-4" {...ICON} />} className="sm:mb-[1.35rem]">
          Ajouter le pilote
        </Button>
      </form>
    </Plate>
  );
}

/** Champ de recherche avec suggestions : filtre sur le début du nom (ou d'un de ses mots), accents et casse ignorés. */
function KnownDriverSearch({ options, disabled, onPick }: { options: KnownDriverDTO[]; disabled: boolean; onPick: (k: KnownDriverDTO) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const results = useMemo(() => {
    const q = normalizeName(query);
    if (!q) return options;
    const starts = options.filter((k) => k.nameKey.startsWith(q));
    const words = options.filter(
      (k) => !k.nameKey.startsWith(q) && (k.nameKey.split(/[\s«»"'()-]+/).some((w) => w.startsWith(q)) || String(k.number ?? "") === q),
    );
    return [...starts, ...words];
  }, [options, query]);

  const choose = (k: KnownDriverDTO | undefined) => {
    if (!k) return;
    onPick(k);
    setQuery("");
    setActive(0);
    setOpen(false);
  };

  return (
    <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-flame/80" {...ICON} />
          <Input
            id="known-driver"
            onClick={() => setOpen(true)}
            className="pl-9"
            role="combobox"
            aria-expanded={open}
            aria-controls="known-driver-list"
            aria-autocomplete="list"
            autoComplete="off"
            disabled={disabled}
            placeholder="Rechercher un pilote enregistré…"
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setActive((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (open) choose(results[active]);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
          />
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if ((e.target as HTMLElement).closest?.("#known-driver")) e.preventDefault();
          }}
          className="z-40 w-[var(--radix-popover-trigger-width)] animate-rise"
        >
          <div className="chamfer-sm bg-flame/50 p-px">
            <ul id="known-driver-list" role="listbox" className="chamfer-sm max-h-72 overflow-y-auto bg-pit py-1">
              {results.length === 0 ? (
                <li className="px-3 py-2.5 text-sm text-mute">Aucun pilote ne commence par « {query.trim()} ». Créez-le ci-dessous.</li>
              ) : (
                results.map((k, i) => (
                  <li
                    key={k.nameKey}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(k)}
                    className={cx("flex cursor-pointer items-center gap-3 px-3 py-2 text-sm", i === active ? "bg-flame/15 text-ink" : "text-ink/90")}
                  >
                    <span className="w-10 font-display font-semibold text-mute tabular-nums">{k.number != null ? `#${k.number}` : "—"}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{k.name}</span>
                    <span className="text-xs text-dim">{k.races} course{k.races > 1 ? "s" : ""}</span>
                  </li>
                ))
              )}
            </ul>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ResultDialog({ open, onOpenChange, detail }: { open: boolean; onOpenChange: (o: boolean) => void; detail: RaceDetailDTO }) {
  const { race, drivers, bets } = detail;
  const [winner, setWinner] = useState<string | null>(null);
  const [withRanking, setWithRanking] = useState(false);
  const [ranking, setRanking] = useState<string[]>([]);
  const [step, setStep] = useState<"pick" | "confirm">("pick");
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);

  const chooseWinner = (id: string) => {
    setWinner(id);
    setRanking([id, ...drivers.map((d) => d.id).filter((x) => x !== id)]);
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (i === 0 || j <= 0 || j >= ranking.length) return; // le vainqueur reste en tête
    const next = [...ranking];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setRanking(next);
  };

  const plan = useMemo(
    () => (winner ? planResult(bets.map((b) => ({ id: b.id, driverId: b.driverId, amount: b.amount, createdAt: b.createdAt })), winner, race.commissionBps) : null),
    [winner, bets, race.commissionBps],
  );

  async function submit() {
    if (!winner) return;
    setBusy(true);
    try {
      await api(`/api/races/${race.id}/result`, { method: "POST", json: { winnerDriverId: winner, ranking: withRanking ? ranking : undefined } });
      toast.success("Résultat enregistré", { description: `Vainqueur : ${byId.get(winner)?.name}. Gains calculés.` });
      onOpenChange(false);
      setStep("pick");
      await refreshAll();
    } catch (e) {
      toast.error("Enregistrement impossible", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => { onOpenChange(o); if (!o) setStep("pick"); }}
      size="lg"
      title={step === "pick" ? "Résultat officiel" : "Confirmer le résultat"}
      description={step === "pick" ? "Seule la première place intervient dans les calculs. Le classement complet est informatif." : "Une fois confirmé, le résultat est définitif et les gains sont calculés."}
      footer={
        step === "pick" ? (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
            <Button disabled={!winner} onClick={() => setStep("confirm")}>Vérifier</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep("pick")} disabled={busy}>Retour</Button>
            <Button loading={busy} onClick={submit} icon={<Trophy className="h-4 w-4" {...ICON} />}>Confirmer définitivement</Button>
          </>
        )
      }
    >
      {step === "pick" ? (
        <div className="space-y-5">
          <fieldset>
            <legend className="mb-2 font-cond text-sm font-semibold tracking-[0.05em] text-mute">Pilote arrivé premier</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {drivers.map((d) => (
                <label key={d.id} className={cx("chamfer-sm flex cursor-pointer items-center gap-3 px-3 py-2.5 ring-1 ring-inset transition-colors", winner === d.id ? "bg-flame/15 ring-flame" : "bg-void ring-line-strong hover:ring-flame/50")}>
                  <input type="radio" name="winner" className="accent-[#FF6B00]" checked={winner === d.id} onChange={() => chooseWinner(d.id)} />
                  <span className="w-8 font-display font-bold text-mute tabular-nums">{d.number ?? "—"}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
                  <span className="text-sm text-flame-soft tabular-nums">{formatOdds(d.oddsCents)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {winner && (
            <div>
              <label className="flex items-center gap-2 text-sm text-mute">
                <input type="checkbox" className="accent-[#FF6B00]" checked={withRanking} onChange={(e) => setWithRanking(e.target.checked)} />
                Renseigner le classement complet (informatif, sans effet sur les gains)
              </label>
              {withRanking && (
                <ol className="mt-3 space-y-1.5">
                  {ranking.map((id, i) => (
                    <li key={id} className="chamfer-sm flex items-center gap-3 bg-void px-3 py-2 ring-1 ring-inset ring-line">
                      <span className={cx("w-8 font-display font-bold tabular-nums", i === 0 ? "text-flame" : "text-mute")}>P{i + 1}</span>
                      <span className="flex-1 truncate">{byId.get(id)?.name}</span>
                      {i > 0 && (
                        <>
                          <Button size="sm" variant="ghost" disabled={i === 1} onClick={() => move(i, -1)} aria-label="Monter"><ArrowUp className="h-4 w-4" {...ICON} /></Button>
                          <Button size="sm" variant="ghost" disabled={i === ranking.length - 1} onClick={() => move(i, 1)} aria-label="Descendre"><ArrowDown className="h-4 w-4" {...ICON} /></Button>
                        </>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      ) : plan && winner ? (
        <div className="space-y-4">
          <dl>
            <SummaryRow label="Course" value={race.name} />
            <SummaryRow label="Pilote vainqueur" value={byId.get(winner)?.name} strong />
            <SummaryRow label="Total des mises" value={formatMoney(plan.totalPool)} />
            <SummaryRow label={`Commission (${formatPercentBps(race.commissionBps)})`} value={formatMoney(computeCommission(plan.totalPool, race.commissionBps))} />
            <SummaryRow label="Cagnotte distribuable" value={formatMoney(plan.distributable)} />
            <SummaryRow label="Parieurs gagnants" value={plan.payouts.length} />
            <SummaryRow label="Montant total à verser" value={formatMoney(plan.totalPayout)} strong />
            <SummaryRow label="Conservé par l'organisateur" value={formatMoney(plan.organizerKept)} />
          </dl>
          {plan.noWinner && (
            <p className="chamfer-sm bg-caution/10 px-3 py-2.5 text-sm text-caution ring-1 ring-inset ring-caution/30">
              Aucun pari sur ce pilote : l&apos;organisateur conserve 100 % de la cagnotte. Aucun paiement, aucun remboursement.
            </p>
          )}
          {!plan.noWinner && plan.winnerPool > 0n && plan.distributable < plan.winnerPool && (
            <p className="chamfer-sm bg-white/5 px-3 py-2.5 text-sm text-mute ring-1 ring-inset ring-line">
              Cote finale inférieure à ×1 : les gagnants récupèrent moins que leur mise (comportement normal du pari mutuel).
            </p>
          )}
          <p className="text-xs text-dim">Paris clôturés le {formatDateTime(detail.closure?.closedAt)}.</p>
        </div>
      ) : null}
    </Modal>
  );
}
