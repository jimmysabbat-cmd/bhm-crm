"use client";

import { useActionState } from "react";
import { Zap } from "lucide-react";
import { loginAction } from "./actions";
import { inputClass, labelClass } from "@/components/ui/field";
import { Button } from "@/components/ui/Button";

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, undefined);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950 px-4">
      <form
        action={formAction}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-white/10 bg-white/[0.03] p-8 shadow-2xl backdrop-blur-sm"
      >
        <div className="flex flex-col items-center gap-3 pb-1 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500 shadow-lg shadow-emerald-500/30">
            <Zap className="h-5 w-5 text-white" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">BHM CRM</h1>
            <p className="text-sm text-slate-400">Le Bonheur d&apos;Habiter Mieux</p>
          </div>
        </div>

        {state?.error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {state.error}
          </p>
        )}

        <div className="space-y-1">
          <label htmlFor="email" className={`${labelClass} text-slate-400`}>
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className={`${inputClass} border-white/10 bg-white/5 text-white placeholder:text-slate-500`}
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className={`${labelClass} text-slate-400`}>
            Mot de passe
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className={`${inputClass} border-white/10 bg-white/5 text-white placeholder:text-slate-500`}
          />
        </div>

        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Connexion..." : "Se connecter"}
        </Button>
      </form>
    </div>
  );
}
