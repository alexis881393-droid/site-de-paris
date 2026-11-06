"use client";

import useSWR, { mutate as globalMutate } from "swr";
import type { AccountsOverviewDTO, GlobalAccountingDTO, PublicOddsDTO, KnownDriverDTO, RaceCardDTO, RaceDetailDTO } from "./dto";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      // X-Racebet : preuve que la requête vient du site (contrôle anti-CSRF dans src/proxy.ts).
      headers: { "X-Racebet": "1", ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...rest.headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Connexion au serveur impossible. Vérifiez votre réseau puis réessayez.", "NETWORK", 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (body as { error?: { message?: string; code?: string } } | null)?.error;
    // Session expirée dans l'espace privé : retour à l'écran de connexion.
    if (res.status === 401 && !url.startsWith("/api/auth/") && typeof window !== "undefined") window.location.assign("/admin");
    throw new ApiError(e?.message ?? `Erreur ${res.status}`, e?.code ?? "HTTP", res.status);
  }
  return body as T;
}

const fetcher = <T,>(url: string) => api<T>(url);

/** Actualisation automatique : toutes les 4 s (plusieurs opérateurs simultanés). */
const LIVE = { refreshInterval: 4000, revalidateOnFocus: true, keepPreviousData: true } as const;

export function useRaces() {
  return useSWR<RaceCardDTO[]>("/api/races", fetcher, LIVE);
}

export function useRace(id: string | null) {
  return useSWR<RaceDetailDTO>(id ? `/api/races/${id}` : null, fetcher, LIVE);
}

export function useKnownDrivers(enabled: boolean) {
  return useSWR<KnownDriverDTO[]>(enabled ? "/api/drivers" : null, fetcher, { revalidateOnFocus: true });
}

export function useAccounting(params: URLSearchParams) {
  const qs = params.toString();
  return useSWR<GlobalAccountingDTO>(`/api/accounting${qs ? `?${qs}` : ""}`, fetcher, { ...LIVE, refreshInterval: 8000 });
}

export function useAccounts() {
  return useSWR<AccountsOverviewDTO>("/api/admin/accounts", fetcher, { refreshInterval: 15000, revalidateOnFocus: true });
}

/** Vue publique : cotes en direct, actualisées toutes les 5 s. */
export function usePublicOdds(course: string | null) {
  return useSWR<PublicOddsDTO>(`/api/public/odds${course ? `?course=${encodeURIComponent(course)}` : ""}`, fetcher, {
    refreshInterval: 5000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });
}

/** Rafraîchit toutes les données après une action. */
export function refreshAll() {
  return globalMutate((key) => typeof key === "string" && key.startsWith("/api/"));
}
