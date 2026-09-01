import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ParamTabs } from "./ParamTabs";

export default async function ParametrageLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if ((session?.user as { role?: string } | undefined)?.role !== "ADMIN") {
    redirect("/");
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-8 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Paramétrage</h1>
        <p className="mt-1 text-sm text-slate-500">Listes, équipe et accès de l&apos;application</p>
      </div>
      <ParamTabs />
      {children}
    </div>
  );
}
