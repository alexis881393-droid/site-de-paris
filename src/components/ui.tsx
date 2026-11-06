"use client";

import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { Loader2, X } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import type { RaceStatus } from "@/lib/constants";
import { RACE_STATUS_LABEL, RACE_STATUS_TONE, PAYMENT_LABEL, type PaymentState, type StatusTone } from "@/lib/status";

export const cx = clsx;
export const ICON = { strokeWidth: 1.6 } as const;

// ---------------------------------------------------------------------------
// Boutons
// ---------------------------------------------------------------------------

type Variant = "primary" | "ghost" | "outline" | "danger" | "success";
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
};

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-flame text-black hover:bg-flame-hot shadow-[0_0_0_1px_rgb(255_140_0/0.6),0_0_22px_-4px_rgb(255_107_0/0.65)] hover:shadow-[0_0_0_1px_rgb(255_177_92/0.9),0_0_30px_-2px_rgb(255_107_0/0.8)]",
  outline: "bg-transparent text-flame-soft ring-1 ring-inset ring-flame/50 hover:bg-flame/10 hover:ring-flame",
  ghost: "bg-transparent text-mute hover:text-ink hover:bg-white/5",
  danger: "bg-stop/10 text-[#ff8a95] ring-1 ring-inset ring-stop/50 hover:bg-stop/20 hover:ring-stop",
  success: "bg-go/10 text-go ring-1 ring-inset ring-go/45 hover:bg-go/20 hover:ring-go",
};
const SIZES = {
  sm: "h-8 px-3 text-[0.8rem] gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-[0.95rem] gap-2.5",
};

export function buttonClasses(variant: Variant = "primary", size: "sm" | "md" | "lg" = "md", className?: string) {
  return cx(
    "chamfer-sm inline-flex shrink-0 select-none items-center justify-center font-cond font-semibold tracking-[0.06em] whitespace-nowrap",
    "transition-[background-color,box-shadow,color,transform] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97]",
    "disabled:pointer-events-none disabled:opacity-40",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={buttonClasses(variant, size, className)}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" {...ICON} /> : icon}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------------------
// Plaques (cartes)
// ---------------------------------------------------------------------------

export function Plate({
  children,
  className,
  coreClassName,
  glow = false,
}: {
  children: ReactNode;
  className?: string;
  coreClassName?: string;
  glow?: boolean;
}) {
  return (
    <div className={cx("chamfer", glow ? "plate-frame" : "plate-frame-quiet", className)}>
      <div className={cx("chamfer plate-core h-full", coreClassName)}>{children}</div>
    </div>
  );
}

export function SectionTitle({ children, aside, sub }: { children: ReactNode; aside?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2.5 font-display text-lg font-semibold tracking-wide text-ink">
          <span className="h-4 w-1 bg-flame shadow-[0_0_10px_rgb(255_107_0/0.8)]" aria-hidden />
          {children}
        </h2>
        {sub && <p className="mt-1 pl-3.5 text-sm text-mute">{sub}</p>}
      </div>
      {aside && <div className="flex flex-wrap items-center gap-2">{aside}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Statuts
// ---------------------------------------------------------------------------

const TONES: Record<StatusTone, string> = {
  neutral: "text-[#c9c9cf] bg-white/[0.06] ring-white/15",
  live: "text-flame-soft bg-flame/12 ring-flame/60",
  locked: "text-caution bg-caution/10 ring-caution/40",
  result: "text-[#ffcf99] bg-flame-hot/10 ring-flame-hot/45",
  done: "text-go bg-go/10 ring-go/40",
  danger: "text-[#ff8a95] bg-stop/10 ring-stop/45",
  muted: "text-mute bg-white/[0.04] ring-white/10",
};

export function Tag({ tone, children, dot, className }: { tone: StatusTone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span
      className={cx(
        "chamfer-sm inline-flex items-center gap-1.5 px-2 py-0.5 font-cond text-[0.74rem] font-semibold tracking-[0.08em] uppercase ring-1 ring-inset whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {dot && <span className={cx("h-1.5 w-1.5 rounded-full bg-current", tone === "live" && "animate-pulse-dot")} aria-hidden />}
      {children}
    </span>
  );
}

export function StatusBadge({ status, className }: { status: RaceStatus; className?: string }) {
  return (
    <Tag tone={RACE_STATUS_TONE[status]} dot className={className}>
      {RACE_STATUS_LABEL[status]}
    </Tag>
  );
}

const PAYMENT_TONE: Record<PaymentState, StatusTone> = {
  none: "muted",
  loser: "muted",
  to_pay: "live",
  paid: "done",
  to_refund: "locked",
  refunded: "done",
};
export function PaymentBadge({ state }: { state: PaymentState }) {
  return <Tag tone={PAYMENT_TONE[state]}>{PAYMENT_LABEL[state]}</Tag>;
}

// ---------------------------------------------------------------------------
// Formulaires
// ---------------------------------------------------------------------------

const fieldBase =
  "w-full bg-void/80 px-3 text-sm text-ink placeholder:text-dim ring-1 ring-inset ring-line-strong transition-[box-shadow,background-color] duration-200 focus:outline-none focus:ring-flame focus:bg-black focus:shadow-[0_0_0_3px_rgb(255_107_0/0.15)] disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(fieldBase, "chamfer-sm h-10", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cx(fieldBase, "chamfer-sm h-10 appearance-none bg-[length:12px] bg-[right_0.75rem_center] bg-no-repeat pr-8", className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2 4l4 4 4-4' fill='none' stroke='%23FF8C00' stroke-width='1.5'/%3E%3C/svg%3E\")" }} {...rest}>
      {children}
    </select>
  );
});

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(fieldBase, "chamfer-sm min-h-20 py-2", props.className)} />;
}

export function Field({ label, hint, error, children, htmlFor, required }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block font-cond text-[0.82rem] font-semibold tracking-[0.05em] text-mute">
        {label}
        {required && <span className="ml-1 text-flame">*</span>}
      </label>
      {children}
      {error ? <p className="text-xs text-[#ff8a95]">{error}</p> : hint ? <p className="text-xs text-dim">{hint}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fenêtres modales (voile translucide, jamais un écran noir opaque)
// ---------------------------------------------------------------------------

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  tone = "default",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  tone?: "default" | "danger";
}) {
  const widths = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-5xl" };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[3px] data-[state=open]:animate-[rise_160ms_ease-out]" />
        <Dialog.Content
          className={cx(
            "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 focus:outline-none",
            widths[size],
          )}
        >
          <div className={cx("chamfer animate-rise", tone === "danger" ? "bg-gradient-to-br from-stop/70 via-white/10 to-stop/40 p-px" : "plate-frame")}>
            <div className="chamfer flex max-h-[min(88dvh,820px)] flex-col bg-pit/[0.97]">
              <div className="flex items-start justify-between gap-4 border-b border-line px-5 pt-5 pb-4">
                <div>
                  <Dialog.Title className="font-display text-lg font-semibold tracking-wide">{title}</Dialog.Title>
                  {description && <Dialog.Description className="mt-1 text-sm text-mute">{description}</Dialog.Description>}
                </div>
                <Dialog.Close className="chamfer-sm -mr-1 p-1.5 text-mute transition-colors hover:bg-white/5 hover:text-ink" aria-label="Fermer">
                  <X className="h-5 w-5" {...ICON} />
                </Dialog.Close>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
              {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Ligne récapitulative "libellé / valeur" des fenêtres de confirmation. */
export function SummaryRow({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/5 py-2 last:border-0">
      <dt className="text-sm text-mute">{label}</dt>
      <dd className={cx("text-right tabular-nums", strong ? "font-display text-lg font-semibold text-flame-soft" : "font-medium text-ink")}>{value}</dd>
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="chamfer-sm mb-4 grid h-14 w-14 place-items-center bg-flame/10 text-flame ring-1 ring-inset ring-flame/30">{icon}</div>
      <h3 className="font-display text-base font-semibold">{title}</h3>
      {children && <p className="mt-1.5 max-w-md text-sm text-mute">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, accent = false, className }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean; className?: string }) {
  return (
    <div className={cx("min-w-0", className)}>
      <div className="font-cond text-[0.8rem] font-semibold tracking-[0.05em] text-mute">{label}</div>
      <div className={cx("mt-1 truncate font-display text-2xl font-semibold tabular-nums", accent ? "text-flame text-glow" : "text-ink")}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-dim">{hint}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("h-5 w-5 animate-spin text-flame", className)} {...ICON} />;
}
