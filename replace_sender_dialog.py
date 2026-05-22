with open('/home/ubuntu/csv-search-site/client/src/pages/InvoicePage.tsx', 'r') as f:
    content = f.read()

start_marker = 'function SenderSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {'
end_marker = '}\n\nconst EMPTY_FORM'

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

new_func = '''function SenderSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data: settings } = trpc.invoiceSettings.get.useQuery();
  const [form, setForm] = useState({
    senderName: "",
    senderCompany: "",
    senderEmail: "",
    senderPhone: "",
    senderAddress: "",
    senderCity: "",
    senderCountry: "",
  });
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<{ base64: string; mimeType: string; fileName: string } | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const uploadLogoMutation = trpc.invoiceSettings.uploadLogo.useMutation();

  const saveMutation = trpc.invoiceSettings.save.useMutation({
    onSuccess: () => {
      utils.invoiceSettings.get.invalidate();
      toast.success("差出人情報を保存しました");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  // Initialize form from settings when dialog opens
  const [initialized, setInitialized] = useState(false);
  if (open && settings && !initialized) {
    setInitialized(true);
    setForm({
      senderName: settings.senderName ?? "",
      senderCompany: settings.senderCompany ?? "",
      senderEmail: settings.senderEmail ?? "",
      senderPhone: settings.senderPhone ?? "",
      senderAddress: settings.senderAddress ?? "",
      senderCity: settings.senderCity ?? "",
      senderCountry: settings.senderCountry ?? "",
    });
    if (settings.logoUrl) setLogoPreview(settings.logoUrl);
  }
  if (!open && initialized) { setInitialized(false); setLogoFile(null); }

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error("画像サイズは2MB以下にしてください"); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setLogoPreview(dataUrl);
      const base64 = dataUrl.split(",")[1];
      setLogoFile({ base64, mimeType: file.type, fileName: file.name });
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setIsUploadingLogo(true);
    try {
      let logoUrl: string | undefined;
      let logoKey: string | undefined;
      if (logoFile) {
        const result = await uploadLogoMutation.mutateAsync(logoFile);
        logoUrl = result.url;
        logoKey = result.key;
      }
      saveMutation.mutate({ ...form, ...(logoUrl ? { logoUrl, logoKey } : {}) });
    } catch {
      toast.error("ロゴのアップロードに失敗しました");
    } finally {
      setIsUploadingLogo(false);
    }
  };

  const isSaving = saveMutation.isPending || isUploadingLogo;

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
                    onClick={() => { setLogoPreview(null); setLogoFile(null); }}
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
}'''

# Replace the function
new_content = content[:start_idx] + new_func + '\n' + content[end_idx:]

with open('/home/ubuntu/csv-search-site/client/src/pages/InvoicePage.tsx', 'w') as f:
    f.write(new_content)

print("Done! Lines:", new_content.count('\n'))
