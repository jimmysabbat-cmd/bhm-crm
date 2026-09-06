import { redirect } from "next/navigation";
import { requireUserContext, type UserContext } from "@/lib/authz";
import { ParamTabs } from "./ParamTabs";

export default async function ParametrageLayout({ children }: { children: React.ReactNode }) {
  // P12 : ne jamais lire le rôle directement depuis la session - un
  // PLATFORM SUPER ADMIN entré dans un tenant a un role de session qui lui
  // est propre (non pertinent ici) ; seul ctx.effectiveRole (issu de
  // requireUserContext()) reflète correctement son accès ADMIN temporaire
  // au tenant entré (cf. src/lib/authz.ts).
  let ctx: UserContext;
  try {
    ctx = await requireUserContext();
  } catch {
    redirect("/");
  }
  if ((ctx.effectiveRole ?? ctx.role) !== "ADMIN") {
    redirect("/");
  }

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Paramétrage</h1>
        <p className="mt-1 text-sm text-slate-500">Listes, équipe et accès de l&apos;application</p>
      </div>
      <div className="flex gap-8">
        <ParamTabs />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
