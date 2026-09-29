import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Users, Save, Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import { useClientManager } from "./useClientManager";

export function ClientManagerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { clients, isLoading, editingClient, isCreating, form, setForm, startEdit, handleSave, startCreate, cancelEditing, deleteClient, isSaving } = useClientManager();
  // Keep this component local: moving it outside would change the existing remount behavior.
  const ClientForm = () => (
    <div className="space-y-3 p-4 bg-muted/30 rounded-lg border border-border">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">名前 *</Label>
          <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="例: Luca" className="h-8 text-sm mt-1" />
        </div>
        <div>
          <Label className="text-xs">会社名</Label>
          <Input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} placeholder="例: ABC GmbH" className="h-8 text-sm mt-1" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">メール</Label>
          <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="example@email.com" className="h-8 text-sm mt-1" />
        </div>
        <div>
          <Label className="text-xs">電話</Label>
          <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+49 177 ..." className="h-8 text-sm mt-1" />
        </div>
      </div>
      <div>
        <Label className="text-xs">住所</Label>
        <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Street, Number" className="h-8 text-sm mt-1" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">都市</Label>
          <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="Berlin" className="h-8 text-sm mt-1" />
        </div>
        <div>
          <Label className="text-xs">国</Label>
          <Input value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} placeholder="Germany" className="h-8 text-sm mt-1" />
        </div>
      </div>
      <div>
        <Label className="text-xs">追加情報 <span className="text-muted-foreground font-normal">(税関番号・登録番号など)</span></Label>
        <textarea
          value={form.extraInfo}
          onChange={e => setForm(f => ({ ...f, extraInfo: e.target.value }))}
          placeholder="例: EORI: DE123456789&#10;税関登録番号: ..."
          className="w-full mt-1 text-sm border border-border rounded-md px-3 py-2 bg-background resize-y min-h-[60px]"
        />
        <p className="text-[10px] text-muted-foreground mt-1">請求書の宛先欄（国名の下）に表示されます</p>
      </div>
      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={handleSave} disabled={isSaving} className="h-8">
          {(isSaving) ? <RefreshCw size={12} className="animate-spin mr-1" /> : <Save size={12} className="mr-1" />}
          保存
        </Button>
        <Button size="sm" variant="outline" onClick={cancelEditing} className="h-8">キャンセル</Button>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users size={16} />
            宛先管理
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            請求書の送付先（クライアント）を登録・管理します。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {(isCreating && !editingClient) && <ClientForm />}

          {!isCreating && !editingClient && (
            <Button size="sm" onClick={startCreate} className="h-8">
              <Plus size={12} className="mr-1" /> 新規宛先を追加
            </Button>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw size={16} className="animate-spin text-muted-foreground" />
            </div>
          ) : clients.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">宛先が登録されていません</p>
          ) : (
            <div className="space-y-2">
              {clients.map(c => (
                <div key={c.id}>
                  {editingClient?.id === c.id ? (
                    <ClientForm />
                  ) : (
                    <div className="flex items-start justify-between p-3 bg-background border border-border rounded-lg hover:bg-muted/30 transition-colors">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{c.name}</p>
                        {c.company && <p className="text-xs text-muted-foreground">{c.company}</p>}
                        {(c.address || c.city || c.country) && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {[c.address, c.city, c.country].filter(Boolean).join(", ")}
                          </p>
                        )}
                        {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
                        {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                      </div>
                      <div className="flex gap-1 ml-2 flex-shrink-0">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(c)}>
                          <Pencil size={12} />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteClient(c)}>
                          <Trash2 size={12} />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
