import type { Dispatch, SetStateAction, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Send } from "lucide-react";

export type KnowledgeChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export function KnowledgeChat({
  activeConversationId,
  knowledgeCount,
  chatHistory,
  chatPending,
  chatBottomRef,
  chatInput,
  setChatInput,
  handleSendChat,
}: {
  activeConversationId: number | null;
  knowledgeCount: number;
  chatHistory: KnowledgeChatMessage[];
  chatPending: boolean;
  chatBottomRef: RefObject<HTMLDivElement | null>;
  chatInput: string;
  setChatInput: Dispatch<SetStateAction<string>>;
  handleSendChat: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col min-w-0">
      {activeConversationId === null ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-6">
          <MessageSquare size={36} className="mb-3 opacity-20" />
          <p className="text-sm font-medium">会話を選択してください</p>
          <p className="text-xs mt-1">
            左のリストから選択、または「新規チャット」で新しい会話を開始
          </p>
          {knowledgeCount === 0 && (
            <p className="text-xs mt-3 text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
              ⚠️
              まだ知識ベースが空です。「アップロード・管理」タブからファイルをアップロードしてください。
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {chatHistory.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm font-medium">AIに質問してみましょう</p>
                <div className="mt-3 space-y-2">
                  {[
                    "Vita2000の価格について最近ルカさんとどんな会話をしましたか？",
                    "未払いのインボイスはありますか？",
                    "最近の注文内容を教えてください",
                  ].map((s, i) => (
                    <button
                      key={i}
                      className="block w-full text-left text-xs bg-muted/40 hover:bg-muted/70 rounded-lg px-3 py-2 transition-colors"
                      onClick={() => setChatInput(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {chatHistory.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs ${
                    msg.role === "user"
                      ? "bg-[#075E54] text-white rounded-tr-sm"
                      : "bg-muted text-foreground rounded-tl-sm"
                  }`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">
                    {msg.content}
                  </p>
                </div>
              </div>
            ))}
            {chatPending && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-tl-sm px-3 py-2">
                  <div className="flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>
          {/* Input */}
          <div className="border-t border-border p-3 flex-shrink-0">
            <div className="flex gap-2">
              <Textarea
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendChat();
                  }
                }}
                placeholder="質問を入力... (Enter で送信、Shift+Enter で改行)"
                className="resize-none text-sm min-h-[52px] max-h-[100px]"
                rows={2}
              />
              <Button
                className="bg-[#075E54] hover:bg-[#075E54]/90 text-white px-3 self-end"
                size="sm"
                onClick={handleSendChat}
                disabled={!chatInput.trim() || chatPending}
              >
                <Send size={14} />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
