"use client";

import useSWR, { mutate as globalMutate } from "swr";
import type { GlobalAccountingDTO, RaceCardDTO, RaceDetailDTO } from "./dto";

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
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...rest.headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Connexion au serveur impossible. Vérifiez votre réseau puis réessayez.", "NETWORK", 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (body as { error?: { message?: string; code?: string } } | null)?.error;
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

export function useAccounting(params: URLSearchParams) {
  const qs = params.toString();
  return useSWR<GlobalAccountingDTO>(`/api/accounting${qs ? `?${qs}` : ""}`, fetcher, { ...LIVE, refreshInterval: 8000 });
}

/** Rafraîchit toutes les données après une action. */
export function refreshAll() {
  return globalMutate((key) => typeof key === "string" && key.startsWith("/api/"));
}
