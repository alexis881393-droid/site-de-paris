"use client";

/**
 * Dernier filet de sécurité : si l'application plante (navigateur trop ancien, erreur imprévue),
 * on affiche un message lisible avec la version du navigateur au lieu d'un écran noir.
 * Styles en ligne : cette page doit s'afficher même sans la feuille de style du site.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="fr">
      <body style={{ margin: 0, background: "#08070a", color: "#f5f5f5", fontFamily: "system-ui, sans-serif" }}>
        <ErrorBox error={error} reset={reset} />
      </body>
    </html>
  );
}

export function ErrorBox({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const chrome = /Chrom(?:e|ium)\/(\d+)/.exec(ua)?.[1];
  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "48px 20px" }}>
      <div style={{ fontWeight: 700, letterSpacing: "0.14em", color: "#ff8c00" }}>RACEBET CONTROL</div>
      <h1 style={{ fontSize: 22, margin: "16px 0 8px" }}>Affichage impossible</h1>
      <p style={{ color: "#c9c9cf", lineHeight: 1.5 }}>
        Le site a rencontré une erreur dans ce navigateur. Réessayez ; si le problème continue, transmettez le détail ci-dessous.
      </p>
      <button
        onClick={() => reset()}
        style={{ marginTop: 12, padding: "10px 18px", background: "#ff6b00", color: "#000", border: 0, fontWeight: 700, cursor: "pointer" }}
      >
        Réessayer
      </button>
      <pre
        style={{ marginTop: 20, padding: 12, background: "#141318", border: "1px solid #34343a", color: "#929298", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
      >
        {`Erreur : ${error?.message || "inconnue"}${error?.digest ? `\nCode : ${error.digest}` : ""}\nNavigateur : ${chrome ? `Chromium ${chrome}` : "?"}\n${ua}`}
      </pre>
    </div>
  );
}
