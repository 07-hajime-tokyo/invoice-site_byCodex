import { useEffect, useState } from "react";
import { Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

type ActionItemFormProps = {
  sourceQuestion?: string;
  defaultDetail?: string;
  onCreated?: () => void;
};

export function ActionItemForm({ sourceQuestion, defaultDetail = "", onCreated }: ActionItemFormProps) {
  const utils = trpc.useUtils();
  const { data: options } = trpc.inventory.actionItems.options.useQuery();
  const assignees = options?.assignees ?? [];
  const titles = options?.titles ?? [];
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [detail, setDetail] = useState(defaultDetail);
  const [newAssignee, setNewAssignee] = useState("");
  const [saveTitlePreset, setSaveTitlePreset] = useState(false);

  useEffect(() => {
    if (!assignee && assignees.length > 0) {
      setAssignee(assignees.find((item) => item.name === "出荷担当")?.name ?? assignees[0].name);
    }
  }, [assignee, assignees]);

  useEffect(() => {
    setDetail(defaultDetail);
  }, [defaultDetail]);

  const createMutation = trpc.inventory.actionItems.create.useMutation({
    onSuccess: async () => {
      toast.success("やることを登録しました");
      setTitle("");
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
      await utils.inventory.actionItems.options.invalidate();
      toast.success("担当者を追加しました");
    },
    onError: (error) => toast.error(`追加失敗: ${error.message}`),
  });

  const submit = () => {
    if (!title.trim()) {
      toast.error("タイトルを入力してください");
      return;
    }
    if (!assignee.trim()) {
      toast.error("宛先を選択してください");
      return;
    }
    if (!detail.trim()) {
      toast.error("詳細を入力してください");
      return;
    }
    createMutation.mutate({
      title,
      assignee,
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
          <Select value={assignee || undefined} onValueChange={setAssignee}>
            <SelectTrigger>
              <SelectValue placeholder="宛先" />
            </SelectTrigger>
            <SelectContent>
              {assignees.map((item) => (
                <SelectItem key={item.id} value={item.name}>{item.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2">
          <Input
            value={newAssignee}
            onChange={(event) => setNewAssignee(event.target.value)}
            placeholder="宛先を追加"
            className="max-w-xs"
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
