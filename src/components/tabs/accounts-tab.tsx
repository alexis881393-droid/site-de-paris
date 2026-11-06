"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Ban, Check, Copy, KeyRound, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { api, useAccounts } from "@/lib/api-client";
import type { AccessCodeDTO, AccountDTO } from "@/lib/dto";
import { formatDateTime } from "@/lib/format";
import { Button, EmptyState, ICON, Modal, Plate, SectionTitle, Spinner, Tag } from "../ui";

/** Comptes administrateurs et codes d'accès à usage unique. */
export function AccountsTab() {
  const { data, error, mutate } = useAccounts();
  const [newCode, setNewCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      const r = await api<{ code: string }>("/api/admin/codes", { method: "POST" });
      setNewCode(r.code);
      await mutate();
    } catch (e) {
      toast.error("Génération impossible", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return error ? (
      <p className="text-sm text-[#ffb3ba]">{error.message}</p>
    ) : (
      <div className="grid place-items-center py-24"><Spinner className="h-7 w-7" /></div>
    );
  }

  const activeCodes = data.codes.filter((c) => c.status === "active").length;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <section>
        <SectionTitle sub="Chaque administrateur a créé son compte avec un code d'accès.">Comptes créés ({data.users.length})</SectionTitle>
        <Plate>
          <ul className="divide-y divide-white/[0.06]">
            {data.users.map((u) => (
              <AccountRow key={u.id} u={u} onDone={() => mutate()} />
            ))}
          </ul>
        </Plate>
      </section>

      <section>
        <SectionTitle
          sub="Un code = un seul compte. Le code complet n'est affiché qu'une fois."
          aside={
            <Button icon={<KeyRound className="h-4 w-4" {...ICON} />} loading={busy} onClick={generate}>
              Générer un code
            </Button>
          }
        >
          Codes d&apos;accès {activeCodes > 0 && <Tag tone="live">{activeCodes} actif{activeCodes > 1 ? "s" : ""}</Tag>}
        </SectionTitle>
        <Plate>
          {data.codes.length === 0 ? (
            <EmptyState icon={<KeyRound className="h-6 w-6" {...ICON} />} title="Aucun code généré">
              Générez un code et transmettez-le à la personne qui doit accéder à l&apos;espace privé.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-white/[0.06]">
              {data.codes.map((c) => (
                <CodeRow key={c.id} c={c} onDone={() => mutate()} />
              ))}
            </ul>
          )}
        </Plate>
      </section>

      <NewCodeDialog code={newCode} onClose={() => setNewCode(null)} />
    </div>
  );
}

function AccountRow({ u, onDone }: { u: AccountDTO; onDone: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await api(`/api/admin/accounts/${u.id}`, { method: "DELETE" });
      toast.success("Compte supprimé", { description: u.username });
      setConfirm(false);
      onDone();
    } catch (e) {
      toast.error("Suppression impossible", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5">
      <div className="chamfer-sm grid h-9 w-9 shrink-0 place-items-center bg-flame/10 text-flame ring-1 ring-inset ring-flame/30">
        <UserRound className="h-4 w-4" {...ICON} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-display text-[1.02rem] font-semibold">{u.username}</span>
          {u.isMe && <Tag tone="done">Vous</Tag>}
        </div>
        <div className="text-xs text-dim">
          Créé le {formatDateTime(u.createdAt)} · {u.invitedBy ? `invité par ${u.invitedBy}` : "code initial"}
        </div>
      </div>
      <div className="text-right text-xs text-mute">
        <div className="text-dim">Dernière connexion</div>
        <div className="tabular-nums">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "—"}</div>
      </div>
      {!u.isMe && (
        <Button size="sm" variant="ghost" title="Supprimer ce compte" aria-label={`Supprimer le compte ${u.username}`} onClick={() => setConfirm(true)}>
          <Trash2 className="h-4 w-4" {...ICON} />
        </Button>
      )}
      <Modal
        open={confirm}
        onOpenChange={setConfirm}
        size="sm"
        tone="danger"
        title="Supprimer ce compte ?"
        description={`« ${u.username} » ne pourra plus se connecter. Ses sessions ouvertes sont fermées immédiatement.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)} disabled={busy}>Annuler</Button>
            <Button variant="danger" loading={busy} onClick={remove} icon={<Trash2 className="h-4 w-4" {...ICON} />}>Supprimer</Button>
          </>
        }
      />
    </li>
  );
}

function CodeRow({ c, onDone }: { c: AccessCodeDTO; onDone: () => void }) {
  const [arm, setArm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function revoke() {
    setBusy(true);
    try {
      await api(`/api/admin/codes/${c.id}`, { method: "DELETE" });
      toast.success("Code révoqué");
      onDone();
    } catch (e) {
      toast.error("Révocation impossible", { description: (e as Error).message });
    } finally {
      setBusy(false);
      setArm(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
      <span className="font-display text-sm tracking-[0.12em] text-mute tabular-nums">RB-••••-••••-{c.hint}</span>
      {c.status === "active" ? <Tag tone="live">Actif</Tag> : c.status === "used" ? <Tag tone="done">Utilisé</Tag> : <Tag tone="muted">Révoqué</Tag>}
      <div className="min-w-0 flex-1 text-xs text-dim">
        {c.status === "used"
          ? `par ${c.usedBy} le ${formatDateTime(c.usedAt!)}`
          : c.status === "revoked"
            ? `le ${formatDateTime(c.revokedAt!)}`
            : `créé le ${formatDateTime(c.createdAt)}${c.createdBy ? ` par ${c.createdBy}` : ""}`}
      </div>
      {c.status === "active" &&
        (arm ? (
          <span className="inline-flex gap-1">
            <Button size="sm" variant="danger" loading={busy} onClick={revoke}>Révoquer</Button>
            <Button size="sm" variant="ghost" onClick={() => setArm(false)} disabled={busy}>Non</Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" icon={<Ban className="h-3.5 w-3.5" {...ICON} />} onClick={() => setArm(true)}>
            Révoquer
          </Button>
        ))}
    </li>
  );
}

function NewCodeDialog({ code, onClose }: { code: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copie impossible : sélectionnez le code à la main.");
    }
  }

  return (
    <Modal
      open={code !== null}
      onOpenChange={(o) => { if (!o) onClose(); }}
      size="sm"
      title="Nouveau code d'accès"
      description="Transmettez ce code à la personne concernée. Il ne sera plus jamais affiché en entier."
      footer={<Button onClick={onClose}>J&apos;ai noté le code</Button>}
    >
      <div className="space-y-4">
        <div className="chamfer-sm flex items-center justify-between gap-3 bg-void px-4 py-3.5 ring-1 ring-inset ring-flame/40">
          <code className="select-all font-display text-xl font-semibold tracking-[0.14em] text-flame-soft">{code}</code>
          <Button size="sm" variant="outline" onClick={copy} icon={copied ? <Check className="h-3.5 w-3.5" {...ICON} /> : <Copy className="h-3.5 w-3.5" {...ICON} />}>
            {copied ? "Copié" : "Copier"}
          </Button>
        </div>
        <p className="flex items-start gap-2 text-sm text-mute">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-go" {...ICON} />
          À usage unique : la personne va sur l&apos;espace privé, onglet « Créer un compte », saisit ce code puis choisit son pseudo et son mot de passe.
        </p>
      </div>
    </Modal>
  );
}
