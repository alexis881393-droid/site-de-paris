/**
 * Logo typographique provisoire. Pour le remplacer : modifier ce seul composant
 * (ou y insérer une balise <img src="/logo.svg" />) et public/icon.svg.
 */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3 select-none" aria-label="RACEBET CONTROL">
      <svg viewBox="0 0 40 40" className="h-9 w-9 shrink-0" aria-hidden>
        <path d="M4 4h25l7 7v25H11l-7-7z" fill="#101012" stroke="#FF6B00" strokeWidth="1.6" />
        <path d="M12 29V11h9.5a5 5 0 0 1 0 10H17l9 8" fill="none" stroke="#FF8C00" strokeWidth="3.2" strokeLinejoin="bevel" />
        <path d="M27 6h7v7" fill="none" stroke="#FFB15C" strokeWidth="1" opacity="0.7" />
      </svg>
      {!compact && (
        <div className="leading-none">
          <div className="font-display text-[1.05rem] font-bold tracking-[0.14em] text-ink">
            RACEBET<span className="text-flame">/</span>
          </div>
          <div className="mt-1 font-cond text-[0.7rem] font-semibold tracking-[0.42em] text-flame-soft/80">CONTROL</div>
        </div>
      )}
    </div>
  );
}
