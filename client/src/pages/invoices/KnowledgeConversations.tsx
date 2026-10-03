import { Button } from "@/components/ui/button";
import { Plus, MessageSquare, Trash2 } from "lucide-react";

export type KnowledgeConversation = { id: number; title: string };

export function KnowledgeConversations({
  conversations,
  activeConversationId,
  isCreating,
  onCreate,
  onSelect,
  onDelete,
}: {
  conversations: KnowledgeConversation[];
  activeConversationId: number | null;
  isCreating: boolean;
  onCreate: () => void;
  onSelect: (id: number) => void;
  onDelete: (input: { id: number }) => void;
}) {
  return (
    <div className="w-52 flex-shrink-0 border-r border-border flex flex-col bg-muted/20">
      <div className="p-2 border-b border-border">
        <Button
          size="sm"
          className="w-full bg-[#075E54] hover:bg-[#075E54]/90 text-white gap-1.5 text-xs h-8"
          onClick={() => onCreate()}
          disabled={isCreating}
        >
          <Plus size={13} />
          新規チャット
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
        {conversations.length === 0 && (
          <p className="text-[10px] text-muted-foreground text-center py-4">
            会話がありません
          </p>
        )}
        {conversations.map(conv => (
          <div
            key={conv.id}
            className={`group flex items-center gap-1 rounded px-2 py-1.5 cursor-pointer transition-colors ${
              activeConversationId === conv.id
                ? "bg-[#075E54]/10 border border-[#075E54]/20"
                : "hover:bg-muted/60"
            }`}
            onClick={() => {
              onSelect(conv.id);
            }}
          >
            <MessageSquare
              size={11}
              className="flex-shrink-0 text-muted-foreground"
            />
            <span className="text-[11px] flex-1 truncate leading-tight">
              {conv.title}
            </span>
            <button
              className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              onClick={e => {
                e.stopPropagation();
                if (confirm(`「${conv.title}」を削除しますか？`)) {
                  onDelete({ id: conv.id });
                }
              }}
            >
              <Trash2
                size={10}
                className="text-muted-foreground hover:text-destructive"
              />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
