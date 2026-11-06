"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowLeft, KeyRound, LogIn, UserPlus } from "lucide-react";
import { api } from "@/lib/api-client";
import { Logo } from "./logo";
import { Button, Field, ICON, Input, Plate, cx } from "./ui";

type Mode = "login" | "register";

/** Écran d'entrée de l'espace privé : connexion, ou création de compte avec un code d'accès. */
export function AuthScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = mode === "register" && confirm.length > 0 && confirm !== password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === "register" && password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(mode === "login" ? "/api/auth/login" : "/api/auth/register", {
        method: "POST",
        json: mode === "login" ? { username, password } : { code, username, password },
      });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const switchTo = (m: Mode) => {
    setMode(m);
    setError(null);
    setPassword("");
    setConfirm("");
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12">
      <div className="flex items-center justify-between">
        <Logo />
        <a href="/" className="flex items-center gap-1.5 text-sm text-mute transition-colors hover:text-ink">
          <ArrowLeft className="h-4 w-4" {...ICON} />
          Cotes publiques
        </a>
      </div>

      <Plate glow className="mt-8">
        <div className="grid grid-cols-2 border-b border-line">
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchTo(m)}
              className={cx(
                "flex items-center justify-center gap-2 py-3.5 pointer-coarse:py-4 font-display text-[0.85rem] font-semibold tracking-[0.1em] uppercase transition-colors",
                mode === m ? "bg-flame/10 text-flame-soft shadow-[inset_0_-2px_0_var(--color-flame)]" : "text-mute hover:text-ink",
              )}
            >
              {m === "login" ? <LogIn className="h-4 w-4" {...ICON} /> : <UserPlus className="h-4 w-4" {...ICON} />}
              {m === "login" ? "Connexion" : "Créer un compte"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-4 p-5 sm:p-6">
          <p className="text-sm text-mute">
            {mode === "login"
              ? "Espace privé réservé aux organisateurs."
              : "Saisissez le code d'accès reçu d'un administrateur, puis choisissez votre pseudo et votre mot de passe. Chaque code ne sert qu'une fois."}
          </p>

          {mode === "register" && (
            <Field label="Code d'accès" htmlFor="auth-code" required>
              <Input
                id="auth-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="RB-XXXX-XXXX-XXXX"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={40}
                className="font-display tracking-[0.12em]"
                required
              />
            </Field>
          )}

          <Field label="Pseudo" htmlFor="auth-user" required hint={mode === "register" ? "3 à 24 caractères : lettres, chiffres, _ . -" : undefined}>
            <Input
              id="auth-user"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={24}
              required
            />
          </Field>

          <Field label="Mot de passe" htmlFor="auth-pass" required hint={mode === "register" ? "8 caractères minimum" : undefined}>
            <Input
              id="auth-pass"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              maxLength={128}
              required
            />
          </Field>

          {mode === "register" && (
            <Field label="Confirmer le mot de passe" htmlFor="auth-pass2" required error={mismatch ? "Différent du mot de passe" : null}>
              <Input
                id="auth-pass2"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                maxLength={128}
                required
              />
            </Field>
          )}

          {error && (
            <p role="alert" className="chamfer-sm bg-stop/10 px-3 py-2.5 text-sm text-[#ffb3ba] ring-1 ring-inset ring-stop/40">
              {error}
            </p>
          )}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={busy}
            disabled={mismatch}
            icon={mode === "login" ? <KeyRound className="h-4 w-4" {...ICON} /> : <UserPlus className="h-4 w-4" {...ICON} />}
          >
            {mode === "login" ? "Se connecter" : "Créer mon compte"}
          </Button>
        </form>
      </Plate>
    </main>
  );
}
