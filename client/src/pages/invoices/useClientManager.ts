import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { createEmptyClientForm } from "./clientForm";

export function useClientManager() {
  const utils = trpc.useUtils();
  const { data: clients = [], isLoading } = trpc.invoiceClients.list.useQuery();
  const [editingClient, setEditingClient] = useState<typeof clients[0] | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState(createEmptyClientForm());

  const createMutation = trpc.invoiceClients.create.useMutation({
    onSuccess: () => {
      utils.invoiceClients.list.invalidate();
      setIsCreating(false);
      setForm(createEmptyClientForm());
      toast.success("宛先を登録しました");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.invoiceClients.update.useMutation({
    onSuccess: () => {
      utils.invoiceClients.list.invalidate();
      setEditingClient(null);
      toast.success("宛先を更新しました");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.invoiceClients.delete.useMutation({
    onSuccess: () => {
      utils.invoiceClients.list.invalidate();
      toast.success("宛先を削除しました");
    },
    onError: (e) => toast.error(e.message),
  });

  const startEdit = (c: typeof clients[0]) => {
    setEditingClient(c);
    setForm({
      name: c.name,
      company: c.company ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      address: c.address ?? "",
      city: c.city ?? "",
      country: c.country ?? "",
      notes: c.notes ?? "",
      extraInfo: (c as { extraInfo?: string | null }).extraInfo ?? "",
    });
  };

  const handleSave = () => {
    if (!form.name.trim()) { toast.error("名前は必須です"); return; }
    if (editingClient) {
      updateMutation.mutate({ id: editingClient.id, ...form });
    } else {
      createMutation.mutate(form);
    }
  };

  const startCreate = () => { setIsCreating(true); setForm(createEmptyClientForm()); };
  const cancelEditing = () => { setIsCreating(false); setEditingClient(null); };
  const deleteClient = (c: typeof clients[0]) => {
    if (confirm(`「${c.name}」を削除しますか？`)) deleteMutation.mutate({ id: c.id });
  };
  const isSaving = createMutation.isPending || updateMutation.isPending;
  return { clients, isLoading, editingClient, isCreating, form, setForm, startEdit, handleSave, startCreate, cancelEditing, deleteClient, isSaving };
}
