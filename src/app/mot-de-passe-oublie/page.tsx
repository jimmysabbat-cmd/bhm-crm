import { requestPasswordResetAction } from "./actions";

export default function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h1 className="text-lg font-semibold text-slate-900">Mot de passe oublié</h1>
        <ForgotPasswordBody searchParams={searchParams} />
      </div>
    </div>
  );
}

async function ForgotPasswordBody({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams;
  if (sent === "1") {
    return (
      <p className="mt-3 text-sm text-slate-600">
        Si un compte existe avec cet email, une demande de réinitialisation a été enregistrée. Contactez votre
        administrateur pour obtenir un nouveau lien de connexion.
      </p>
    );
  }
  return (
    <form
      action={async (formData: FormData) => {
        "use server";
        await requestPasswordResetAction(formData);
        const { redirect } = await import("next/navigation");
        redirect("/mot-de-passe-oublie?sent=1");
      }}
      className="mt-4 space-y-4"
    >
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-500">Email</label>
        <input name="email" type="email" required className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
      </div>
      <button type="submit" className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">
        Envoyer
      </button>
    </form>
  );
}
