import { GripVertical, Plus } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmit";
import { inputClass } from "@/components/ui/field";
import { reorder } from "./actions";

type Item = { id: string; value: string; actif: boolean };
type ReorderModel = Parameters<typeof reorder>[0];

export function ParamList({
  description,
  items,
  fieldName,
  placeholder,
  reorderModel,
  createAction,
  updateAction,
  toggleAction,
  deleteAction,
}: {
  description: string;
  items: Item[];
  fieldName: "label" | "nom";
  placeholder: string;
  reorderModel: ReorderModel;
  createAction: (formData: FormData) => Promise<void>;
  updateAction: (id: string, formData: FormData) => Promise<void>;
  toggleAction: (id: string, actif: boolean) => Promise<void>;
  deleteAction: (id: string) => Promise<void>;
}) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">{description}</p>

      <Card className="overflow-hidden">
        {items.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-slate-400">Aucun élément pour l&apos;instant.</p>
        )}
        {items.map((item, i) => (
          <div
            key={item.id}
            className={`flex items-center gap-3 border-b border-slate-100 px-4 py-2.5 last:border-0 ${
              !item.actif ? "opacity-40" : ""
            }`}
          >
            <GripVertical className="h-4 w-4 shrink-0 text-slate-300" />
            <div className="flex shrink-0 flex-col">
              <form action={async () => { "use server"; await reorder(reorderModel, item.id, "up"); }}>
                <button
                  type="submit"
                  disabled={i === 0}
                  className="block text-slate-400 hover:text-emerald-600 disabled:opacity-20"
                >
                  ▲
                </button>
              </form>
              <form action={async () => { "use server"; await reorder(reorderModel, item.id, "down"); }}>
                <button
                  type="submit"
                  disabled={i === items.length - 1}
                  className="block text-slate-400 hover:text-emerald-600 disabled:opacity-20"
                >
                  ▼
                </button>
              </form>
            </div>
            <form action={updateAction.bind(null, item.id)} className="flex flex-1 gap-2">
              <input name={fieldName} defaultValue={item.value} className={inputClass} />
              <Button type="submit" variant="secondary" className="shrink-0">
                Enregistrer
              </Button>
            </form>
            <form action={async () => { "use server"; await toggleAction(item.id, !item.actif); }}>
              <button type="submit" className="whitespace-nowrap text-xs font-medium text-slate-400 hover:text-emerald-600">
                {item.actif ? "Archiver" : "Réactiver"}
              </button>
            </form>
            <form action={async () => { "use server"; await deleteAction(item.id); }}>
              <ConfirmSubmitButton
                label="Supprimer"
                confirmMessage="Supprimer définitivement cet élément ? S'il est encore utilisé par un ou plusieurs dossiers, il sera archivé à la place (impossible de casser un dossier existant)."
                className="whitespace-nowrap text-xs font-medium text-slate-400 hover:text-red-600"
              />
            </form>
          </div>
        ))}
      </Card>

      <form action={createAction} className="flex gap-2">
        <input name={fieldName} placeholder={placeholder} required className={inputClass} />
        <Button type="submit" className="shrink-0">
          <Plus className="h-4 w-4" />
          Ajouter
        </Button>
      </form>
    </div>
  );
}
