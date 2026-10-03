import { Trash2 } from "lucide-react";
export type KnowledgeHistoryItem = {
  id: number;
  sourceType: string;
  sourceLabel?: string | null;
  createdAt: string | number | Date;
};

export function KnowledgeHistory({
  knowledgeList,
  onDelete,
}: {
  knowledgeList: KnowledgeHistoryItem[];
  onDelete: (input: { id: number }) => void;
}) {
  return (
    <div>
      <p className="text-xs font-semibold mb-2">
        学習済みデータ ({knowledgeList.length}件)
      </p>
      {knowledgeList.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground">
          <p className="text-xs">
            まだデータがありません。上からファイルをアップロードしてください。
          </p>
        </div>
      ) : (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {knowledgeList.map(item => (
            <div
              key={item.id}
              className="flex items-center gap-2 bg-muted/30 rounded px-2 py-1.5"
            >
              <span
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                  item.sourceType === "chat_text"
                    ? "bg-green-100 text-green-700"
                    : item.sourceType === "screenshot"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-red-100 text-red-700"
                }`}
              >
                {item.sourceType === "chat_text"
                  ? "テキスト"
                  : item.sourceType === "screenshot"
                    ? "スクショ"
                    : "PDF"}
              </span>
              <span className="text-xs flex-1 truncate">
                {item.sourceLabel ?? "不明"}
              </span>
              <span className="text-[10px] text-muted-foreground flex-shrink-0">
                {new Date(item.createdAt).toLocaleDateString("ja-JP")}
              </span>
              <button
                onClick={() => {
                  if (confirm(`「${item.sourceLabel}」を削除しますか？`))
                    onDelete({ id: item.id });
                }}
              >
                <Trash2
                  size={12}
                  className="text-muted-foreground hover:text-destructive"
                />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
