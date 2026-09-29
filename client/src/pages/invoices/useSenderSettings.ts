import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export function useSenderSettings(open: boolean, onClose: () => void) {
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
    senderExtraInfo: "",
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
      senderExtraInfo: (settings as { senderExtraInfo?: string | null }).senderExtraInfo ?? "",
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

  const clearLogo = () => { setLogoPreview(null); setLogoFile(null); };
  return { form, setForm, logoPreview, logoInputRef, handleLogoChange, handleSave, isSaving, clearLogo };
}
