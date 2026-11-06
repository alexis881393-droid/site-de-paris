"use client";

import { ErrorBox } from "./global-error";

/** Erreur dans une page : message lisible au lieu d'un écran vide. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorBox error={error} reset={reset} />;
}
