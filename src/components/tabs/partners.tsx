"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, HandCoins, Lock, Settings2 } from "lucide-react";
import { api, refreshAll } from "@/lib/api-client";
import type { PartnerDTO, PartnerRaceDTO, PartnerShareDTO, PartnersOverviewDTO } from "@/lib/dto";
import { parseCommissionPercent, splitByShares } from "@/lib/finance";
import { formatDateTime, formatMoney, formatPercentBps } from "@/lib/format";
import { Button, Field, ICON, Input, Modal, Plate, Tag, cx } from "../ui";


/** Montant restant à verser aux associés pour une course. */
export const remainingForRace = (r: PartnerRaceDTO | undefined) =>
  r ? r.shares.reduce((s, x) => s + (x.status === "paid" ? 0 : x.amount), 0) : 0;

/** Redistribution du bénéfice de la course sélectionnée entre les 4 associés. */
export function RacePartnersPanel({
  overview,
  raceId,
  pending,
}: {
  overview: PartnersOverviewDTO;
  raceId: string;
  /** Résultat pas encore enregistré : bénéfice inconnu. */
  pending: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const race = overview.races.find((r) => r.raceId === raceId);
  const remaining = remainingForRace(race);
  const canPay = !!race && (race.locked || overview.sharesValid);

  return (
    <Plate glow={remaining > 0} className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 font-display font-semibold">
            <HandCoins className="h-4 w-4 text-flame" {...ICON} />
            Redistribution du bénéfice
          </span>
          {race &&
            (remaining === 0 ? (
              <Tag tone="done">Tout versé</Tag>
            ) : race.locked ? (
              <Tag tone="locked"><Lock className="h-3 w-3" {...ICON} />Répartition figée</Tag>
            ) : (
              <Tag tone="muted">Provisoire</Tag>
            ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {race && (
            <span className="text-sm text-mute">
              Reste à verser <b className={cx("font-display text-base tabular-nums", remaining > 0 ? "text-flame-soft" : "text-ink")}>{formatMoney(remaining)}</b>
            </span>
          )}
          <Button size="sm" variant="ghost" icon={<Settings2 className="h-4 w-4" {...ICON} />} onClick={() => setEditOpen(true)}>
            Associés
          </Button>
        </div>
      </div>

      {!overview.sharesValid && !race?.locked && (
        <p className="border-b border-line bg-caution/10 px-5 py-2.5 text-sm text-caution">
          Les parts des associés ne totalisent pas 100 % : corrigez-les avant tout versement.
        </p>
      )}

      <div className="grid gap-2 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4">
        {race
          ? race.shares.map((s) => <ShareCell key={s.partnerId} raceId={race.raceId} share={s} canPay={canPay} />)
          : overview.partners.map((p) => (
              <div key={p.id} className="chamfer-sm flex flex-col gap-2 bg-void px-3 py-2.5 ring-1 ring-inset ring-line">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium">{p.name}</span>
                  <span className="text-xs text-dim tabular-nums">{formatPercentBps(p.shareBps)}</span>
                </div>
                <div className="text-sm text-dim">{pending ? "Selon le résultat" : "Aucun bénéfice"}</div>
              </div>
            ))}
      </div>
      <p className="px-5 pb-4 text-xs text-dim">
        {pending
          ? "Le bénéfice sera réparti dès que le résultat officiel sera enregistré."
          : race
            ? `Bénéfice de la course : ${formatMoney(race.revenue)}, réparti au dollar près. La répartition est figée dès le premier versement.`
            : "Aucun bénéfice sur cette course : rien à redistribuer."}
      </p>

      <PartnersDialog open={editOpen} onOpenChange={setEditOpen} partners={overview.partners} />
    </Plate>
  );
}

function ShareCell({ raceId, share, canPay }: { raceId: string; share: PartnerShareDTO; canPay: boolean }) {
  const [arm, setArm] = useState(false);
  const [busy, setBusy] = useState(false);
  const paid = share.status === "paid";

  async function pay() {
    setBusy(true);
    try {
      const r = await api<{ alreadyPaid: boolean }>(`/api/races/${raceId}/partners/${share.partnerId}/pay`, { method: "POST" });
      if (r.alreadyPaid) toast.info("Part déjà versée", { description: "Aucune double comptabilisation." });
      else toast.success("Part versée", { description: `${share.name} · ${formatMoney(share.amount)}` });
      await refreshAll();
    } catch (e) {
      toast.error("Versement impossible", { description: (e as Error).message });
    } finally {
      setBusy(false);
      setArm(false);
    }
  }

  return (
    <div className={cx("chamfer-sm flex flex-col gap-2 px-3 py-2.5 ring-1 ring-inset", paid ? "bg-go/[0.05] ring-go/25" : "bg-void ring-line")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{share.name}</span>
        <span className="text-xs text-dim tabular-nums">{formatPercentBps(share.shareBps)}</span>
      </div>
      <div className="font-display text-lg font-semibold tabular-nums">{formatMoney(share.amount)}</div>
      {paid ? (
        <div className="flex items-center gap-1.5 text-xs text-go">
          <CheckCircle2 className="h-3.5 w-3.5" {...ICON} />
          Versé{share.paidAt ? ` le ${formatDateTime(share.paidAt)}` : ""}
        </div>
      ) : share.amount === 0 ? (
        <div className="text-xs text-dim">Rien à verser</div>
      ) : arm ? (
        <div className="flex gap-1.5 [&>*]:flex-1">
          <Button size="sm" variant="success" loading={busy} onClick={pay} icon={<CheckCircle2 className="h-3.5 w-3.5" {...ICON} />}>Confirmer</Button>
          <Button size="sm" variant="ghost" onClick={() => setArm(false)} disabled={busy}>Non</Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" disabled={!canPay} title={canPay ? undefined : "Parts des associés invalides"} onClick={() => setArm(true)}>
          Marquer versé
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Configuration des associés
// ---------------------------------------------------------------------------

const toPercentInput = (bps: number) => (bps / 100).toString().replace(".", ",");

function PartnersDialog({ open, onOpenChange, partners }: { open: boolean; onOpenChange: (o: boolean) => void; partners: PartnerDTO[] }) {
  const [rows, setRows] = useState<{ id: string; name: string; pct: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const reset = () => setRows(partners.map((p) => ({ id: p.id, name: p.name, pct: toPercentInput(p.shareBps) })));
  const parsed = rows.map((r) => parseCommissionPercent(r.pct));
  const total = parsed.reduce<number>((s, v) => s + (v ?? 0), 0);
  const valid = rows.length === 4 && parsed.every((v) => v !== null) && total === 10_000 && rows.every((r) => r.name.trim().length > 0);
  const example = valid
    ? splitByShares(100_000, rows.map((r, i) => ({ position: i + 1, shareBps: parsed[i]! }))).map((x) => Number(x.amount))
    : null;

  async function save() {
    setBusy(true);
    try {
      await api("/api/partners", { method: "PUT", json: { partners: rows.map((r, i) => ({ id: r.id, name: r.name, shareBps: parsed[i] })) } });
      toast.success("Associés enregistrés", { description: "Les nouvelles parts s'appliquent aux courses non encore figées." });
      onOpenChange(false);
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
      onOpenChange={(o) => { if (o) reset(); onOpenChange(o); }}
      size="md"
      title="Associés"
      description="Noms et parts du bénéfice. Les courses dont un versement a déjà eu lieu gardent leur répartition."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Annuler</Button>
          <Button loading={busy} disabled={!valid} onClick={save}>Enregistrer</Button>
        </>
      }
    >
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
            <Field label={`Associé ${i + 1}`} htmlFor={`partner-name-${i}`}>
              <Input
                id={`partner-name-${i}`}
                value={r.name}
                maxLength={40}
                autoComplete="off"
                autoCapitalize="words"
                onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
            </Field>
            <Field label="Part (%)" htmlFor={`partner-pct-${i}`} error={parsed[i] === null ? "0 à 100" : null}>
              <Input
                id={`partner-pct-${i}`}
                value={r.pct}
                inputMode="decimal"
                autoComplete="off"
                className="text-right"
                onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))}
              />
            </Field>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <span className={cx("text-sm", total === 10_000 ? "text-go" : "text-[#ff8a95]")}>
            Total : <b className="font-display tabular-nums">{formatPercentBps(total)}</b>
            {total !== 10_000 && " — doit faire 100 %"}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setRows((rs) => rs.map((x) => ({ ...x, pct: "25" })))}>
            Parts égales (25 %)
          </Button>
        </div>
        {example && (
          <p className="text-xs text-dim">
            Exemple : pour 100 000 $ de bénéfice → {rows.map((r, i) => `${r.name.trim() || "?"} ${formatMoney(example[i]!)}`).join(" · ")}.
          </p>
        )}
      </div>
    </Modal>
  );
}
