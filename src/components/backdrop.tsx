/**
 * Décor fixe néon : piste en perspective qui défile, traînées de phares, balayage et grain.
 * Purement décoratif (aria-hidden, aucun événement). `intensity` règle la visibilité de la piste.
 */
export function Backdrop({ intensity = "low" }: { intensity?: "low" | "high" }) {
  return (
    <>
      <div className="backdrop" aria-hidden style={{ ["--road-opacity" as string]: intensity === "high" ? 0.75 : 0.32 }}>
        <div className="road"><div className="road-grid" /></div>
        <span className="streak" />
        <span className="streak" />
        <span className="streak" />
        <span className="streak" />
      </div>
      <div className="scanlines" aria-hidden />
    </>
  );
}
