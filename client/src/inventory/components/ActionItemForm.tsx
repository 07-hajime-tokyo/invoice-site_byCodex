import { useEffect, useId, useMemo, useState, type ClipboardEvent } from "react";
import { ImagePlus, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  fileToActionItemAttachment,
  getImageFilesFromClipboard,
  toActionItemAttachmentPayloads,
  type ActionItemAttachmentDraft,
} from "@/inventory/lib/actionItemAttachments";
import { trpc } from "@/lib/trpc";

type ActionItemFormProps = {
  sourceQuestion?: string;
  defaultDetail?: string;
  initialItem?: {
    id: number;
    title: string;
    assignee: string;
    detail: string;
    createdBy?: string | null;
  };
  mode?: "create" | "edit";
  onCreated?: () => void;
  onUpdated?: () => void;
  onCancel?: () => void;
};

const DEFAULT_ASSIGNEES = new Set(["全員", "仕入れ担当", "荷受担当", "出荷担当"]);
const ASSIGNEE_ORDER = ["全員", "仕入れ担当", "荷受担当", "出荷担当"];
const ADD_ASSIGNEE_VALUE = "__add_assignee__";
const ADD_AUTHOR_VALUE = "__add_author__";

export function ActionItemForm({
  sourceQuestion,
  defaultDetail = "",
  initialItem,
  mode = "create",
  onCreated,
  onUpdated,
  onCancel,
}: ActionItemFormProps) {
  const utils = trpc.useUtils();
  const isEditing = mode === "edit";
  const attachmentInputId = useId();
  const { data: options } = trpc.inventory.actionItems.options.useQuery();
  const assignees = options?.assignees ?? [];
  const visibleAssignees = useMemo(() => {
    const merged = new Map<string, (typeof assignees)[number]>();
    for (const item of assignees) {
      if (item.name !== "その他") merged.set(item.name, item);
    }
    if (!merged.has("全員")) {
      merged.set("全員", { id: -1, name: "全員", sortOrder: 0, createdAt: new Date(0), updatedAt: new Date(0) });
    }
    return Array.from(merged.values()).sort((a, b) => {
      const aIndex = ASSIGNEE_ORDER.indexOf(a.name);
      const bIndex = ASSIGNEE_ORDER.indexOf(b.name);
      if (aIndex !== -1 || bIndex !== -1) {
        return (aIndex === -1 ? ASSIGNEE_ORDER.length : aIndex) - (bIndex === -1 ? ASSIGNEE_ORDER.length : bIndex);
      }
      return a.name.localeCompare(b.name, "ja");
    });
  }, [assignees]);
  const titles = options?.titles ?? [];
  const authors = options?.authors ?? [];
  const [title, setTitle] = useState(initialItem?.title ?? "");
  const [assignee, setAssignee] = useState(initialItem?.assignee ?? "");
  const [createdBy, setCreatedBy] = useState(initialItem?.createdBy ?? "");
  const [detail, setDetail] = useState(initialItem?.detail ?? defaultDetail);
  const [newAssignee, setNewAssignee] = useState("");
  const [newAuthor, setNewAuthor] = useState("");
  const [showAssigneeAdd, setShowAssigneeAdd] = useState(false);
  const [showAuthorAdd, setShowAuthorAdd] = useState(false);
  const [saveTitlePreset, setSaveTitlePreset] = useState(false);
  const [attachments, setAttachments] = useState<ActionItemAttachmentDraft[]>([]);
  const [isReadingAttachments, setIsReadingAttachments] = useState(false);
  const selectedAssignee = visibleAssignees.find((item) => item.name === assignee);
  const canDeleteSelectedAssignee = Boolean(selectedAssignee && !DEFAULT_ASSIGNEES.has(selectedAssignee.name));

  useEffect(() => {
    if (!isEditing || !initialItem) return;
    setTitle(initialItem.title);
    setAssignee(initialItem.assignee);
    setCreatedBy(initialItem.createdBy ?? "");
    setDetail(initialItem.detail);
    setSaveTitlePreset(false);
    setShowAssigneeAdd(false);
    setShowAuthorAdd(false);
  }, [initialItem?.id, isEditing]);

  useEffect(() => {
    if (!assignee && visibleAssignees.length > 0) {
      setAssignee(visibleAssignees.find((item) => item.name === "全員")?.name ?? visibleAssignees[0].name);
    }
  }, [assignee, visibleAssignees]);

  useEffect(() => {
    if (!createdBy && authors.length > 0) {
      setCreatedBy(authors.find((item) => item.name === "村上")?.name ?? authors[0].name);
    }
  }, [authors, createdBy]);

  useEffect(() => {
    if (!isEditing) setDetail(defaultDetail);
  }, [defaultDetail, isEditing]);

  const createMutation = trpc.inventory.actionItems.create.useMutation({
    onSuccess: async () => {
      toast.success("やることを登録しました");
      setTitle("");
      setDetail(defaultDetail);
      setAttachments([]);
      setSaveTitlePreset(false);
      setShowAuthorAdd(false);
      await Promise.all([
        utils.inventory.actionItems.list.invalidate(),
        utils.inventory.actionItems.options.invalidate(),
      ]);
      onCreated?.();
    },
    onError: (error) => toast.error(`登録失敗: ${error.message}`),
  });

  const updateMutation = trpc.inventory.actionItems.update.useMutation({
    onSuccess: async () => {
      toast.success("やることを保存しました");
      setSaveTitlePreset(false);
      await Promise.all([
        utils.inventory.actionItems.list.invalidate(),
        utils.inventory.actionItems.options.invalidate(),
      ]);
      onUpdated?.();
    },
    onError: (error) => toast.error(`保存失敗: ${error.message}`),
  });

  const addAssigneeMutation = trpc.inventory.actionItems.addAssignee.useMutation({
    onSuccess: async () => {
      const name = newAssignee.trim();
      setAssignee(name);
      setNewAssignee("");
      setShowAssigneeAdd(false);
      await utils.inventory.actionItems.options.invalidate();
      toast.success("担当者を追加しました");
    },
    onError: (error) => toast.error(`追加失敗: ${error.message}`),
  });

  const addAuthorMutation = trpc.inventory.actionItems.addAuthor.useMutation({
    onSuccess: async () => {
      const name = newAuthor.trim();
      setCreatedBy(name);
      setNewAuthor("");
      setShowAuthorAdd(false);
      await utils.inventory.actionItems.options.invalidate();
      toast.success("記入者を追加しました");
    },
    onError: (error) => toast.error(`追加失敗: ${error.message}`),
  });

  const deleteAssigneeMutation = trpc.inventory.actionItems.deleteAssignee.useMutation({
    onSuccess: async () => {
      toast.success("宛先を削除しました");
      setAssignee(visibleAssignees.find((item) => item.name === "全員")?.name ?? visibleAssignees[0]?.name ?? "");
      await utils.inventory.actionItems.options.invalidate();
    },
    onError: (error) => toast.error(`削除失敗: ${error.message}`),
  });

  const handleAssigneeChange = (value: string) => {
    if (value === ADD_ASSIGNEE_VALUE) {
      setShowAssigneeAdd(true);
      return;
    }
    setAssignee(value);
    setShowAssigneeAdd(false);
  };

  const handleAuthorChange = (value: string) => {
    if (value === ADD_AUTHOR_VALUE) {
      setShowAuthorAdd(true);
      return;
    }
    setCreatedBy(value);
    setShowAuthorAdd(false);
  };

  const handleAttachmentFiles = async (selectedFiles: File[], successMessage?: string) => {
    if (selectedFiles.length === 0) return;
    setIsReadingAttachments(true);
    try {
      const drafts: ActionItemAttachmentDraft[] = [];
      for (const file of selectedFiles) {
        try {
          drafts.push(await fileToActionItemAttachment(file));
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "画像の読み込みに失敗しました");
        }
      }
      if (drafts.length > 0) {
        setAttachments((current) => [...current, ...drafts]);
        toast.success(successMessage ?? `添付を${drafts.length}件追加しました`);
      }
    } finally {
      setIsReadingAttachments(false);
    }
  };

  const handleAttachmentPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (isEditing) return;
    const files = getImageFilesFromClipboard(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    void handleAttachmentFiles(files, `スクショを${files.length}件添付しました`);
  };

  const removeAttachment = (id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  };

  const submit = () => {
    if (!title.trim()) {
      toast.error("タイトルを入力してください");
      return;
    }
    if (!assignee.trim()) {
      toast.error("宛先を選択してください");
      return;
    }
    const resolvedAssignee = assignee.trim();
    if (!resolvedAssignee) {
      toast.error("宛先を選択してください");
      return;
    }
    if (!detail.trim()) {
      toast.error("詳細を入力してください");
      return;
    }
    if (!createdBy.trim()) {
      toast.error("記入者を選択してください");
      return;
    }
    if (isEditing) {
      if (!initialItem) {
        toast.error("編集対象が見つかりません");
        return;
      }
      updateMutation.mutate({
        id: initialItem.id,
        title,
        assignee: resolvedAssignee,
        detail,
        createdBy,
        saveTitlePreset,
      });
      return;
    }
    createMutation.mutate({
      title,
      assignee: resolvedAssignee,
      detail,
      source: "ai-investigation",
      sourceQuestion,
      createdBy,
      saveTitlePreset,
      attachments: toActionItemAttachmentPayloads(attachments),
    });
  };

  return (
    <Card className="rounded-lg">
      <CardHeader className="py-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Save className="h-4 w-4 text-emerald-600" />
          {isEditing ? "やること編集" : "やること登録"}
          <Badge variant="outline" className="ml-auto">担当者宛</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3" onPaste={handleAttachmentPaste}>
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_190px]">
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="タイトル"
              />
              {titles.length > 0 ? (
                <Select value={title || undefined} onValueChange={setTitle}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="候補" />
                  </SelectTrigger>
                  <SelectContent>
                    {titles.map((item) => (
                      <SelectItem key={item.id} value={item.title}>{item.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox checked={saveTitlePreset} onCheckedChange={(checked) => setSaveTitlePreset(checked === true)} />
              <span>タイトル候補に保存</span>
            </label>
          </div>
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">宛先</div>
            <div className="flex gap-2">
              <Select value={assignee || undefined} onValueChange={handleAssigneeChange}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="宛先" />
                </SelectTrigger>
              <SelectContent>
                {visibleAssignees.map((item) => (
                  <SelectItem key={item.id} value={item.name}>{item.name}</SelectItem>
                ))}
                <SelectSeparator />
                <SelectItem value={ADD_ASSIGNEE_VALUE}>
                  <Plus className="h-4 w-4" />
                  宛先を追加
                </SelectItem>
              </SelectContent>
              </Select>
              {canDeleteSelectedAssignee ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0 text-destructive hover:text-destructive"
                  disabled={deleteAssigneeMutation.isPending}
                  onClick={() => selectedAssignee && deleteAssigneeMutation.mutate({ id: selectedAssignee.id })}
                  aria-label="選択中の宛先を削除"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
            {showAssigneeAdd ? (
              <div className="flex gap-2">
                <Input
                  value={newAssignee}
                  onChange={(event) => setNewAssignee(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      if (newAssignee.trim()) addAssigneeMutation.mutate({ name: newAssignee });
                    }
                  }}
                  placeholder="追加する宛先"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={newAssignee.trim().length === 0 || addAssigneeMutation.isPending}
                  onClick={() => addAssigneeMutation.mutate({ name: newAssignee })}
                  aria-label="宛先を追加"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
          </div>
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">記入者</div>
            <Select value={createdBy || undefined} onValueChange={handleAuthorChange}>
              <SelectTrigger>
                <SelectValue placeholder="記入者" />
              </SelectTrigger>
              <SelectContent>
                {authors.map((item) => (
                  <SelectItem key={item.id} value={item.name}>{item.name}</SelectItem>
                ))}
                <SelectSeparator />
                <SelectItem value={ADD_AUTHOR_VALUE}>
                  <Plus className="h-4 w-4" />
                  記入者を追加
                </SelectItem>
              </SelectContent>
            </Select>
            {showAuthorAdd ? (
              <div className="flex gap-2">
                <Input
                  value={newAuthor}
                  onChange={(event) => setNewAuthor(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      if (newAuthor.trim()) addAuthorMutation.mutate({ name: newAuthor });
                    }
                  }}
                  placeholder="追加する記入者"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={newAuthor.trim().length === 0 || addAuthorMutation.isPending}
                  onClick={() => addAuthorMutation.mutate({ name: newAuthor })}
                  aria-label="記入者を追加"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        <Textarea
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
          placeholder={"詳細\nCtrl+Vでスクショ貼り付けできます"}
          className="min-h-[110px]"
        />

        {!isEditing ? (
          <div className="space-y-2 rounded-md border border-dashed border-slate-200 bg-slate-50/50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                id={attachmentInputId}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(event) => {
                  void handleAttachmentFiles(Array.from(event.target.files ?? []));
                  event.currentTarget.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => document.getElementById(attachmentInputId)?.click()}
                disabled={isReadingAttachments}
              >
                <ImagePlus className="h-4 w-4" />
                {isReadingAttachments ? "読み込み中" : "写真を添付"}
              </Button>
              {attachments.length > 0 ? (
                <Badge variant="outline" className="bg-white">
                  添付 {attachments.length}件
                </Badge>
              ) : null}
            </div>
            {attachments.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {attachments.map((attachment) => (
                  <div key={attachment.id} className="relative h-20 w-20 overflow-hidden rounded-md border bg-white">
                    <img src={attachment.previewUrl} alt={attachment.fileName} className="h-full w-full object-cover" />
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon-sm"
                      className="absolute right-1 top-1 h-6 w-6 bg-white/90 text-slate-700 shadow"
                      onClick={() => removeAttachment(attachment.id)}
                      aria-label="添付を外す"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex justify-end">
          {isEditing && onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel} className="mr-2">
              キャンセル
            </Button>
          ) : null}
          <Button type="button" onClick={submit} disabled={createMutation.isPending || updateMutation.isPending || isReadingAttachments}>
            <Save className="h-4 w-4 mr-2" />
            {isEditing ? "保存" : "登録"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
