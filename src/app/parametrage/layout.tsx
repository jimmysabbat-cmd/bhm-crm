import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ParamTabs } from "./ParamTabs";

export default async function ParametrageLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if ((session?.user as { role?: string } | undefined)?.role !== "ADMIN") {
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
