import { NextResponse, type NextRequest } from "next/server";

/**
 * Anti-CSRF : le cookie de session est en SameSite=None (le site doit s'ouvrir partout,
 * y compris intégré dans un script FiveM). Toute requête API qui modifie des données doit
 * donc porter l'en-tête X-Racebet, que seul le site lui-même envoie : un autre site ne peut
 * pas l'ajouter sans autorisation CORS (jamais accordée).
 */
export function proxy(req: NextRequest) {
  const m = req.method;
  if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS" && req.headers.get("x-racebet") !== "1") {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "Requête refusée (origine non vérifiée)." } }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
