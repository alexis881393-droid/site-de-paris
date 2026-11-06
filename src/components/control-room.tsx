"use client";

import * as Popover from "@radix-ui/react-popover";
import * as Tabs from "@radix-ui/react-tabs";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, ChevronDown, Eye, Flag, History, KeyRound, LogOut, Plus, Ticket, UserRound, Users } from "lucide-react";
import { api, useRace, useRaces } from "@/lib/api-client";
import type { SessionUserDTO } from "@/lib/dto";
import { formatDateTime, formatMoney, formatPercentBps } from "@/lib/format";
import { ACTIVE_STATUSES } from "@/lib/status";
import { Logo } from "./logo";
import { NewRaceDialog, RaceManagerDialog } from "./race-dialogs";
import { Button, EmptyState, ICON, Spinner, StatusBadge, cx } from "./ui";
import { DriversTab } from "./tabs/drivers-tab";
import { BetsTab } from "./tabs/bets-tab";
import { AccountingTab } from "./tabs/accounting-tab";
import { AccountsTab } from "./tabs/accounts-tab";

const TABS = [
  { id: "pilotes", label: "Pilotes", icon: Users, key: "1" },
  { id: "paris", label: "Paris", icon: Ticket, key: "2" },
  { id: "comptabilite", label: "Comptabilité", icon: BarChart3, key: "3" },
  { id: "comptes", label: "Comptes", icon: KeyRound, key: "4" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const STORAGE_KEY = "racebet:lastRace";

export function ControlRoom({ user }: { user: SessionUserDTO }) {
  const router = useRouter();
  const params = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get("tab")) ? params.get("tab") : "pilotes") as TabId;
  const urlRace = params.get("course");

  const { data: races, error: racesError, isLoading } = useRaces();
  const [newOpen, setNewOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const setParams = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );
  const setParam = useCallback((key: string, value: string | null) => setParams({ [key]: value }), [setParams]);

  const selectRace = useCallback(
    (id: string) => {
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {}
      setParam("course", id);
    },
    [setParam],
  );

  // Sélection par défaut : dernière course consultée, sinon la plus récente encore active.
  const raceId = useMemo(() => {
    if (!races) return urlRace;
    if (urlRace && races.some((r) => r.id === urlRace)) return urlRace;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {}
    if (stored && races.some((r) => r.id === stored)) return stored;
    return (races.find((r) => ACTIVE_STATUSES.includes(r.status)) ?? races[0])?.id ?? null;
  }, [races, urlRace]);

  const { data: detail, error: detailError } = useRace(raceId);
  const current = races?.find((r) => r.id === raceId) ?? null;

  // Raccourcis : 1/2/3 = onglets, N = nouvelle course, H = historique.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || el.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      const t = TABS.find((x) => x.key === e.key);
      if (t) setParam("tab", t.id);
      else if (e.key.toLowerCase() === "n") setNewOpen(true);
      else if (e.key.toLowerCase() === "h") setManagerOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setParam]);

  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/admin");
    }
  }

  const activeRaces = races?.filter((r) => ACTIVE_STATUSES.includes(r.status)) ?? [];

  return (
    <div className="min-h-dvh">
      {/* ------------------------------------------------------------- En-tête */}
      <header className="sticky top-0 z-30 border-b border-line/80 bg-void/80 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6 md:px-8 xl:px-6">
          <Logo />
          <div className="mx-1 hidden h-8 w-px bg-line md:block" aria-hidden />

          <Popover.Root open={switcherOpen} onOpenChange={setSwitcherOpen}>
            <Popover.Trigger asChild>
              <button
                className="chamfer-sm group order-3 flex min-w-0 flex-1 basis-full items-center gap-3 bg-plate px-3 py-2 pointer-coarse:py-2.5 text-left ring-1 ring-inset ring-line-strong transition-shadow hover:ring-flame/60 md:order-none md:basis-0 md:max-w-md"
                aria-label="Changer de course"
              >
                <Flag className="h-4 w-4 shrink-0 text-flame" {...ICON} />
                <span className="min-w-0 flex-1">
                  <span className="block whitespace-nowrap font-cond text-[0.7rem] font-semibold tracking-[0.12em] text-dim">COURSE ACTIVE</span>
                  <span className="block truncate font-display text-[0.95rem] font-semibold">{current?.name ?? (isLoading ? "Chargement…" : "Aucune course")}</span>
                </span>
                {current && <StatusBadge status={current.status} className="hidden sm:inline-flex md:hidden lg:inline-flex" />}
                <ChevronDown className="h-4 w-4 shrink-0 text-mute transition-transform group-data-[state=open]:rotate-180" {...ICON} />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="start" sideOffset={6} className="z-40 w-[min(28rem,calc(100vw-2rem))] animate-rise">
                <div className="chamfer plate-frame">
                  <div className="chamfer max-h-[60dvh] overflow-y-auto overscroll-contain bg-pit p-2">
                    <div className="px-2 pt-1 pb-2 font-cond text-xs font-semibold tracking-[0.1em] text-dim">COURSES EN COURS ({activeRaces.length})</div>
                    {activeRaces.length === 0 && <p className="px-2 pb-2 text-sm text-mute">Aucune course active.</p>}
                    {activeRaces.map((r) => (
                      <button
                        key={r.id}
                        onClick={() => {
                          selectRace(r.id);
                          setSwitcherOpen(false);
                        }}
                        className={cx(
                          "chamfer-sm flex w-full items-center gap-3 px-2.5 py-2 pointer-coarse:py-3.5 text-left transition-colors hover:bg-white/5 active:bg-white/10",
                          r.id === raceId && "bg-flame/10",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{r.name}</span>
                          <span className="block text-xs text-mute tabular-nums">
                            {r.betCount} paris · {formatMoney(r.totalStakes)}
                          </span>
                        </span>
                        <StatusBadge status={r.status} />
                      </button>
                    ))}
                    <div className="mt-2 flex gap-2 border-t border-line px-1 pt-2">
                      <Button size="sm" variant="ghost" icon={<History className="h-4 w-4" {...ICON} />} onClick={() => { setSwitcherOpen(false); setManagerOpen(true); }}>
                        Toutes les courses
                      </Button>
                    </div>
                  </div>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          <div className="ml-auto flex items-center gap-2">
            <a
              href="/"
              target="_blank"
              rel="noopener"
              title="Ouvrir la page publique des cotes"
              className="chamfer-sm hidden h-10 items-center gap-2 px-3 text-sm text-mute transition-colors hover:bg-white/5 hover:text-ink pointer-coarse:h-12 sm:flex"
            >
              <Eye className="h-4 w-4" {...ICON} />
              <span className="hidden xl:inline">Vue publique</span>
            </a>
            <span className="hidden items-center gap-1.5 text-sm text-mute md:flex" title="Compte connecté">
              <UserRound className="h-4 w-4 text-flame" {...ICON} />
              <span className="max-w-[9rem] truncate font-medium text-ink">{user.username}</span>
            </span>
            <Button variant="ghost" icon={<LogOut className="h-4 w-4" {...ICON} />} onClick={logout} title="Se déconnecter" aria-label="Se déconnecter" />
            <Button variant="ghost" icon={<History className="h-4 w-4" {...ICON} />} onClick={() => setManagerOpen(true)} title="Historique des courses (H)">
              <span className="hidden lg:inline">Historique</span>
            </Button>
            <Button icon={<Plus className="h-4 w-4" {...ICON} />} onClick={() => setNewOpen(true)} title="Nouvelle course (N)">
              <span className="hidden sm:inline">Nouvelle course</span>
            </Button>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------- Corps */}
      <main className="mx-auto max-w-[1500px] px-4 pb-16 sm:px-6 md:px-8 xl:px-6">
        {racesError && !races ? (
          <ConnectionError message={racesError.message} />
        ) : !races ? (
          <div className="grid place-items-center py-32"><Spinner className="h-7 w-7" /></div>
        ) : races.length === 0 && tab !== "comptes" ? (
          <div className="mt-10">
            <EmptyState
              icon={<Flag className="h-6 w-6" {...ICON} />}
              title="Aucune course pour l'instant"
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button size="lg" icon={<Plus className="h-4 w-4" {...ICON} />} onClick={() => setNewOpen(true)}>Créer la première course</Button>
                  <Button size="lg" variant="ghost" icon={<KeyRound className="h-4 w-4" {...ICON} />} onClick={() => setParam("tab", "comptes")}>Comptes</Button>
                </div>
              }
            >
              Créez une course, ajoutez ses pilotes, puis ouvrez les paris. Chaque course a sa propre cagnotte et sa propre comptabilité.
            </EmptyState>
          </div>
        ) : (
          <Tabs.Root value={tab} onValueChange={(v) => setParam("tab", v)}>
            <div className="mt-6 flex min-w-0 flex-wrap items-end justify-between gap-4">
              <Tabs.List className="flex max-w-full min-w-0 gap-1 overflow-x-auto" aria-label="Sections">
                {TABS.map((t) => (
                  <Tabs.Trigger
                    key={t.id}
                    value={t.id}
                    className={cx(
                      "chamfer-sm group relative flex shrink-0 items-center gap-2 px-3 py-2.5 font-display sm:px-4 pointer-coarse:px-5 pointer-coarse:py-3.5 text-[0.9rem] font-semibold tracking-[0.12em] uppercase transition-colors",
                      "text-mute hover:text-ink data-[state=active]:bg-flame data-[state=active]:text-black data-[state=active]:shadow-[0_0_24px_-6px_rgb(255_107_0/0.9)]",
                    )}
                  >
                    <t.icon className="h-4 w-4" {...ICON} />
                    {t.label}
                    <kbd className="ml-1 hidden font-cond text-[0.65rem] opacity-50 lg:pointer-fine:inline">{t.key}</kbd>
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
              {current && tab !== "comptabilite" && tab !== "comptes" && (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-mute">
                  <span>{current.scheduledAt ? formatDateTime(current.scheduledAt) : "Date libre"}</span>
                  <span>Commission <b className="font-semibold text-ink">{formatPercentBps(current.commissionBps)}</b></span>
                  <span>Cagnotte <b className="font-display font-semibold text-flame-soft">{formatMoney(detail?.totalPool ?? current.totalStakes)}</b></span>
                </div>
              )}
            </div>
            <div className="mt-2 h-px bg-gradient-to-r from-flame/70 via-line to-transparent" aria-hidden />

            <div className="mt-6">
              {detailError && !detail ? (
                <ConnectionError message={detailError.message} />
              ) : (
                <>
                  <Tabs.Content value="pilotes" className="focus:outline-none">
                    {detail ? <DriversTab detail={detail} onGoToBets={() => setParam("tab", "paris")} /> : <Loading />}
                  </Tabs.Content>
                  <Tabs.Content value="paris" className="focus:outline-none">
                    {detail ? <BetsTab detail={detail} onGoToDrivers={() => setParam("tab", "pilotes")} /> : <Loading />}
                  </Tabs.Content>
                  <Tabs.Content value="comptabilite" className="focus:outline-none">
                    <AccountingTab detail={detail ?? null} onSelectRace={(id) => selectRace(id)} />
                  </Tabs.Content>
                  <Tabs.Content value="comptes" className="focus:outline-none">
                    {tab === "comptes" && <AccountsTab />}
                  </Tabs.Content>
                </>
              )}
            </div>
          </Tabs.Root>
        )}
      </main>

      <footer className="mx-auto max-w-[1500px] px-4 pb-[max(2rem,env(safe-area-inset-bottom))] text-xs text-dim sm:px-6 md:px-8 xl:px-6">
        Outil de comptabilité de paris fictifs en dollars FiveM, non convertibles en argent réel. Espace privé : accès réservé aux comptes créés avec un code d&apos;accès.
      </footer>

      <NewRaceDialog open={newOpen} onOpenChange={setNewOpen} onCreated={(r) => {
          try {
            localStorage.setItem(STORAGE_KEY, r.id);
          } catch {}
          setParams({ course: r.id, tab: "pilotes" });
        }} />
      <RaceManagerDialog
        open={managerOpen}
        onOpenChange={setManagerOpen}
        races={races ?? []}
        activeId={raceId}
        onSelect={selectRace}
        onNew={() => { setManagerOpen(false); setNewOpen(true); }}
      />
    </div>
  );
}

function Loading() {
  return <div className="grid place-items-center py-24"><Spinner className="h-7 w-7" /></div>;
}

function ConnectionError({ message }: { message: string }) {
  return (
    <div className="mx-auto mt-10 max-w-xl chamfer bg-stop/10 px-5 py-4 text-sm text-[#ffb3ba] ring-1 ring-inset ring-stop/40">
      <b className="block font-display text-base text-ink">Données indisponibles</b>
      {message} Nouvelle tentative automatique en cours.
    </div>
  );
}
