"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Flag, Lock, Search, Trash2, Users, Wallet } from "lucide-react";
import { api, refreshAll } from "@/lib/api-client";
import type { RaceCardDTO, RaceDTO } from "@/lib/dto";
import { RACE_STATUSES, type RaceStatus } from "@/lib/constants";
import { RACE_STATUS_LABEL, canDeleteRace } from "@/lib/status";
import { formatDateTime, formatMoney, formatPercentBps } from "@/lib/format";
import { parseCommissionPercent } from "@/lib/finance";
import { Button, EmptyState, Field, ICON, Input, Modal, Select, StatusBadge, SummaryRow, Textarea, cx } from "./ui";

export function NewRaceDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (r: RaceDTO) => void }) {
  const [name, setName] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [description, setDescription] = useState("");
  const [commission, setCommission] = useState("");
  const [step, setStep] = useState<"form" | "confirm">("form");
  const [busy, setBusy] = useState(false);
  const bps = parseCommissionPercent(commission);
  const nameOk = name.trim().length > 0 && name.trim().length <= 120;

  const reset = () => {
    setName("");
    setScheduledAt("");
    setDescription("");
    setCommission("");
    setStep("form");
  };

  async function create() {
    setBusy(true);
    try {
      const race = await api<RaceDTO>("/api/races", {
        method: "POST",
        json: { name, description, scheduledAt: scheduledAt || null, commissionPercent: commission },
      });
      toast.success("Course créée", { description: `${race.name} · commission ${formatPercentBps(race.commissionBps)} (définitive)` });
      await refreshAll();
      onCreated(race);
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error("Création impossible", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) setStep("form");
        onOpenChange(o);
      }}
      title={step === "form" ? "Nouvelle course" : "Confirmer la commission"}
      description={step === "form" ? "La course démarre en préparation : vous pourrez ensuite ajouter les pilotes." : undefined}
      footer={
        step === "form" ? (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
            <Button disabled={!nameOk || bps === null} onClick={() => setStep("confirm")}>Continuer</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep("form")} disabled={busy}>Modifier</Button>
            <Button loading={busy} onClick={create} icon={<Lock className="h-4 w-4" {...ICON} />}>Créer la course</Button>
          </>
        )
      }
    >
      {step === "form" ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (nameOk && bps !== null) setStep("confirm");
          }}
        >
          <Field label="Nom de la course" htmlFor="race-name" required>
            <Input id="race-name" autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Night Run Vinewood" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date et heure (Paris)" htmlFor="race-date" hint="Facultatif">
              <Input id="race-date" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
            </Field>
            <Field
              label="Commission organisateur (%)"
              htmlFor="race-commission"
              required
              error={commission && bps === null ? "Entre 0 et 100, 2 décimales max. (ex. 12,5)" : null}
              hint="Définitive après création"
            >
              <Input id="race-commission" inputMode="decimal" value={commission} onChange={(e) => setCommission(e.target.value)} placeholder="15" />
            </Field>
          </div>
          <Field label="Description" htmlFor="race-desc" hint="Facultatif">
            <Textarea id="race-desc" maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Tracé, règles particulières…" />
          </Field>
          <button type="submit" hidden />
        </form>
      ) : (
        <div className="space-y-4">
          <dl>
            <SummaryRow label="Course" value={name.trim()} />
            <SummaryRow label="Date" value={scheduledAt ? scheduledAt.replace("T", " à ") : "Non définie"} />
            <SummaryRow label="Commission" value={bps !== null ? formatPercentBps(bps) : "—"} strong />
          </dl>
          <p className="chamfer-sm bg-caution/10 px-3 py-2.5 text-sm text-caution ring-1 ring-inset ring-caution/30">
            La commission ne pourra plus jamais être modifiée pour cette course.
          </p>
        </div>
      )}
    </Modal>
  );
}

export function RaceManagerDialog({
  open,
  onOpenChange,
  races,
  activeId,
  onSelect,
  onNew,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  races: RaceCardDTO[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<RaceStatus | "">("");
  const [toDelete, setToDelete] = useState<RaceCardDTO | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  // Une course avec des paris exige de taper SUPPRIMER (perte de l'historique comptable).
  const needsTyping = (toDelete?.betCount ?? 0) > 0;
  const askDelete = (r: RaceCardDTO) => {
    setConfirmText("");
    setToDelete(r);
  };

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
    return races.filter(
      (r) => (!status || r.status === status) && (!n || r.name.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").includes(n)),
    );
  }, [races, q, status]);

  async function remove() {
    if (!toDelete) return;
    setBusy(true);
    try {
      await api(`/api/races/${toDelete.id}`, { method: "DELETE" });
      toast.success("Course supprimée", { description: toDelete.name });
      setToDelete(null);
      await refreshAll();
    } catch (e) {
      toast.error("Suppression refusée", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal open={open} onOpenChange={onOpenChange} size="xl" title="Courses" description={`${races.length} course${races.length > 1 ? "s" : ""} enregistrée${races.length > 1 ? "s" : ""}. L'historique n'est jamais supprimé automatiquement.`}>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-dim" {...ICON} />
            <Input className="pl-9" placeholder="Rechercher une course…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher une course" />
          </div>
          <Select className="sm:w-60" value={status} onChange={(e) => setStatus(e.target.value as RaceStatus | "")} aria-label="Filtrer par statut">
            <option value="">Tous les statuts</option>
            {RACE_STATUSES.map((s) => (
              <option key={s} value={s}>{RACE_STATUS_LABEL[s]}</option>
            ))}
          </Select>
          <Button variant="outline" onClick={onNew}>Nouvelle course</Button>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={<Flag className="h-6 w-6" {...ICON} />} title={races.length ? "Aucune course ne correspond" : "Aucune course"}>
            {races.length ? "Modifiez la recherche ou le filtre de statut." : "Créez votre première course pour commencer."}
          </EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((r) => (
              <div key={r.id} className={cx("chamfer p-px transition-colors", r.id === activeId ? "bg-flame/70" : "bg-white/10 hover:bg-flame/40")}>
                <div className="chamfer flex h-full flex-col bg-plate p-4">
                  <button
                    className="group flex-1 text-left"
                    onClick={() => {
                      onSelect(r.id);
                      onOpenChange(false);
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-display text-[0.98rem] font-semibold leading-snug group-hover:text-flame-soft">{r.name}</h3>
                      <StatusBadge status={r.status} className="shrink-0" />
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-mute">
                      <CalendarClock className="h-3.5 w-3.5" {...ICON} />
                      {r.scheduledAt ? formatDateTime(r.scheduledAt) : `Créée le ${formatDateTime(r.createdAt)}`}
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                      <div className="flex items-center gap-1.5 text-mute"><Flag className="h-3.5 w-3.5" {...ICON} /><span className="text-ink tabular-nums">{r.driverCount}</span> pilotes</div>
                      <div className="flex items-center gap-1.5 text-mute"><Users className="h-3.5 w-3.5" {...ICON} /><span className="text-ink tabular-nums">{r.betCount}</span> paris</div>
                      <div className="col-span-2 flex items-center gap-1.5 text-mute"><Wallet className="h-3.5 w-3.5" {...ICON} />Mises <span className="ml-auto font-display font-semibold text-flame-soft tabular-nums">{formatMoney(r.totalStakes)}</span></div>
                      <div className="col-span-2 flex justify-between text-mute">Commission <span className="text-ink tabular-nums">{formatPercentBps(r.commissionBps)}</span></div>
                    </dl>
                  </button>
                  <div className="mt-3 border-t border-white/5 pt-3">
                    {canDeleteRace(r.status, r.betCount) ? (
                      <Button size="sm" variant="ghost" className="text-[#ff8a95]" icon={<Trash2 className="h-3.5 w-3.5" {...ICON} />} onClick={() => askDelete(r)}>
                        Supprimer
                      </Button>
                    ) : (
                      <p className="py-1 text-xs text-dim">
                        {r.status === "result"
                          ? "Suppression possible une fois tous les gains payés."
                          : r.status === "cancelled"
                            ? "Suppression possible une fois tous les remboursements faits."
                            : "Course en cours : terminez-la ou annulez-la pour pouvoir la supprimer."}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
        size="sm"
        tone="danger"
        title="Supprimer la course ?"
        description="La course, ses pilotes, ses paris et ses règlements seront effacés définitivement. Elle disparaîtra aussi de la comptabilité globale."
        footer={
          <>
            <Button variant="ghost" onClick={() => setToDelete(null)} disabled={busy}>Annuler</Button>
            <Button variant="danger" loading={busy} disabled={needsTyping && confirmText.trim().toUpperCase() !== "SUPPRIMER"} onClick={remove}>
              Supprimer définitivement
            </Button>
          </>
        }
      >
        {toDelete && (
          <div className="space-y-4">
            <dl>
              <SummaryRow label="Course" value={toDelete.name} />
              <SummaryRow label="Statut" value={RACE_STATUS_LABEL[toDelete.status]} />
              <SummaryRow label="Paris" value={toDelete.betCount} />
              <SummaryRow label="Total des mises" value={formatMoney(toDelete.totalStakes)} />
            </dl>
            {needsTyping && (
              <>
                <p className="text-sm text-mute">
                  Un résumé de la course (nom, nombre de paris, total des mises) reste dans le journal des opérations.
                </p>
                <Field label="Tapez SUPPRIMER pour confirmer" htmlFor="confirm-delete">
                  <Input id="confirm-delete" autoComplete="off" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="SUPPRIMER" />
                </Field>
              </>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
