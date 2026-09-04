import { checkResetToken } from "@/lib/invitations/service";
import { ResetPasswordForm } from "../ResetPasswordForm";

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = await checkResetToken(token);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h1 className="text-lg font-semibold text-slate-900">Réinitialiser le mot de passe</h1>
        {valid ? <ResetPasswordForm token={token} /> : <p className="mt-3 text-sm text-red-600">Lien invalide, déjà utilisé ou expiré.</p>}
      </div>
    </div>
  );
}
