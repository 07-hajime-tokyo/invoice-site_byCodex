import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

type ActionItemFormProps = {
  sourceQuestion?: string;
  defaultDetail?: string;
  onCreated?: () => void;
};

const DEFAULT_ASSIGNEES = new Set(["仕入れ担当", "荷受担当", "出荷担当", "その他"]);
const ADD_ASSIGNEE_VALUE = "__add_assignee__";

export function ActionItemForm({ sourceQuestion, defaultDetail = "", onCreated }: ActionItemFormProps) {
  const utils = trpc.useUtils();
  const { data: options } = trpc.inventory.actionItems.options.useQuery();
  const assignees = options?.assignees ?? [];
  const titles = options?.titles ?? [];
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [customAssignee, setCustomAssignee] = useState("");
  const [detail, setDetail] = useState(defaultDetail);
  const [newAssignee, setNewAssignee] = useState("");
  const [showAssigneeAdd, setShowAssigneeAdd] = useState(false);
  const [saveTitlePreset, setSaveTitlePreset] = useState(false);
  const selectedAssignee = assignees.find((item) => item.name === assignee);
  const canDeleteSelectedAssignee = Boolean(selectedAssignee && !DEFAULT_ASSIGNEES.has(selectedAssignee.name));

  useEffect(() => {
    if (!assignee && assignees.length > 0) {
      setAssignee(assignees.find((item) => item.name === "出荷担当")?.name ?? assignees[0].name);
    }
  }, [assignee, assignees]);

  useEffect(() => {
    setDetail(defaultDetail);
  }, [defaultDetail]);

  useEffect(() => {
    if (assignee !== "その他") {
      setCustomAssignee("");
    }
  }, [assignee]);

  const createMutation = trpc.inventory.actionItems.create.useMutation({
    onSuccess: async () => {
      toast.success("やることを登録しました");
      setTitle("");
      setCustomAssignee("");
      setDetail(defaultDetail);
      setSaveTitlePreset(false);
      await Promise.all([
        utils.inventory.actionItems.list.invalidate(),
        utils.inventory.actionItems.options.invalidate(),
      ]);
      onCreated?.();
    },
    onError: (error) => toast.error(`登録失敗: ${error.message}`),
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

  const deleteAssigneeMutation = trpc.inventory.actionItems.deleteAssignee.useMutation({
    onSuccess: async () => {
      toast.success("宛先を削除しました");
      setAssignee(assignees.find((item) => item.name === "出荷担当")?.name ?? assignees[0]?.name ?? "");
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

  const submit = () => {
    if (!title.trim()) {
      toast.error("タイトルを入力してください");
      return;
    }
    if (!assignee.trim()) {
      toast.error("宛先を選択してください");
      return;
    }
    const resolvedAssignee = assignee === "その他" ? customAssignee.trim() : assignee.trim();
    if (!resolvedAssignee) {
      toast.error("その他の宛先を入力してください");
      return;
    }
    if (!detail.trim()) {
      toast.error("詳細を入力してください");
      return;
    }
    createMutation.mutate({
      title,
      assignee: resolvedAssignee,
      detail,
      source: "ai-investigation",
      sourceQuestion,
      saveTitlePreset,
    });
  };

  return (
    <Card className="rounded-lg">
      <CardHeader className="py-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Save className="h-4 w-4 text-emerald-600" />
          やること登録
          <Badge variant="outline" className="ml-auto">担当者宛</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
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
            <div className="flex gap-2">
              <Select value={assignee || undefined} onValueChange={handleAssigneeChange}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="宛先" />
                </SelectTrigger>
              <SelectContent>
                {assignees.map((item) => (
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
            {assignee === "その他" ? (
              <Input
                value={customAssignee}
                onChange={(event) => setCustomAssignee(event.target.value)}
                placeholder="その他の宛先"
              />
            ) : null}
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
        </div>

        <Textarea
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
          placeholder="詳細"
          className="min-h-[110px]"
        />

        <div className="flex justify-end">
          <Button type="button" onClick={submit} disabled={createMutation.isPending}>
            <Save className="h-4 w-4 mr-2" />
            登録
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
