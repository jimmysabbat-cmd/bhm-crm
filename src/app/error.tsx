"use client";

// P12 (section 35) - en production, Next.js redacte déjà automatiquement
// le message/stack des erreurs serveur non gérées (Server Components/
// Server Actions) et fournit un `digest` opaque à la place - cette page
// affiche exactement ce digest comme référence, jamais la stack réelle.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="max-w-sm text-center">
        <p className="text-lg font-semibold text-slate-900">Une erreur est survenue</p>
        <p className="mt-2 text-sm text-slate-500">
          {error.digest ? `Référence ${error.digest}` : "Merci de réessayer, ou de contacter votre administrateur si le problème persiste."}
        </p>
      </div>
    </div>
  );
}
