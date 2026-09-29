import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Settings, Upload, RefreshCw } from "lucide-react";
import { useSenderSettings } from "./useSenderSettings";

export function SenderSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { form, setForm, logoPreview, logoInputRef, handleLogoChange, handleSave, isSaving, clearLogo } = useSenderSettings(open, onClose);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Settings size={16} /> 差出人情報の設定</DialogTitle>
          <DialogDescription>請求書に表示される差出人（From）のデフォルト情報を設定します。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {/* Logo upload */}
          <div>
            <Label className="text-xs">会社ロゴ（インボイスに表示）</Label>
            <div className="mt-1 flex items-center gap-3">
              <div
                className="w-16 h-16 border-2 border-dashed border-border rounded-lg flex items-center justify-center bg-muted/30 overflow-hidden cursor-pointer hover:border-primary/50 transition-colors flex-shrink-0"
                onClick={() => logoInputRef.current?.click()}
              >
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo preview" className="w-full h-full object-contain" />
                ) : (
                  <span className="text-muted-foreground text-xs text-center px-1">ロゴ</span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => logoInputRef.current?.click()}
                >
                  <Upload size={11} /> 画像を選択
                </Button>
                {logoPreview && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={clearLogo}
                  >
                    削除
                  </Button>
                )}
                <p className="text-[10px] text-muted-foreground">PNG/JPG, 2MB以下</p>
              </div>
            </div>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={handleLogoChange}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">名前</Label>
              <Input value={form.senderName} onChange={e => setForm(f => ({ ...f, senderName: e.target.value }))} placeholder="例: 村上 肥" className="h-8 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-xs">会社名</Label>
              <Input value={form.senderCompany} onChange={e => setForm(f => ({ ...f, senderCompany: e.target.value }))} placeholder="例: Murakami Trading" className="h-8 text-sm mt-1" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">メール</Label>
              <Input value={form.senderEmail} onChange={e => setForm(f => ({ ...f, senderEmail: e.target.value }))} placeholder="example@email.com" className="h-8 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-xs">電話</Label>
              <Input value={form.senderPhone} onChange={e => setForm(f => ({ ...f, senderPhone: e.target.value }))} placeholder="+81 ..." className="h-8 text-sm mt-1" />
            </div>
          </div>
          <div>
            <Label className="text-xs">住所</Label>
            <Input value={form.senderAddress} onChange={e => setForm(f => ({ ...f, senderAddress: e.target.value }))} placeholder="Street, Number" className="h-8 text-sm mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">都市</Label>
              <Input value={form.senderCity} onChange={e => setForm(f => ({ ...f, senderCity: e.target.value }))} placeholder="Tokyo" className="h-8 text-sm mt-1" />
            </div>
            <div>
              <Label className="text-xs">国</Label>
              <Input value={form.senderCountry} onChange={e => setForm(f => ({ ...f, senderCountry: e.target.value }))} placeholder="Japan" className="h-8 text-sm mt-1" />
            </div>
          </div>
          <div>
            <Label className="text-xs">追加情報 <span className="text-muted-foreground font-normal">(税関番号・登録番号など)</span></Label>
            <textarea
              value={form.senderExtraInfo}
              onChange={e => setForm(f => ({ ...f, senderExtraInfo: e.target.value }))}
              placeholder="例: 税関登録番号: EORI-12345&#10;消費税登録番号: JP-67890"
              className="w-full mt-1 text-sm border border-border rounded-md px-3 py-2 bg-background resize-y min-h-[72px]"
            />
            <p className="text-[10px] text-muted-foreground mt-1">請求書の差出人欄（JAPANの下）に表示されます</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>キャンセル</Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <RefreshCw size={12} className="animate-spin mr-1" /> : null}
            保存する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
