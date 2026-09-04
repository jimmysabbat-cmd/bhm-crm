import { checkInvitation } from "@/lib/invitations/service";
import { AcceptInvitationForm } from "../AcceptInvitationForm";

// ============================================================
// Acceptation d'invitation (P12, section 28/55) - page PUBLIQUE (aucune
// session), sécurité 100% portée par le token (aléatoire, usage unique,
// expirant).
// ============================================================

const REASON_LABELS: Record<string, string> = {
  NOT_FOUND: "Ce lien d'invitation n'existe pas.",
  EXPIRED: "Ce lien d'invitation a expiré.",
  USED: "Ce lien d'invitation a déjà été utilisé.",
};

export default async function AcceptInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const check = await checkInvitation(token);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h1 className="text-lg font-semibold text-slate-900">Rejoindre {check.valid ? check.organisationNom : "BHM CRM"}</h1>
        {check.valid ? (
          <>
            <p className="mt-1 text-sm text-slate-500">{check.email} · rôle {check.role}</p>
            <div className="mt-5">
              <AcceptInvitationForm token={token} />
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm text-red-600">{REASON_LABELS[check.reason]}</p>
        )}
      </div>
    </div>
  );
}
