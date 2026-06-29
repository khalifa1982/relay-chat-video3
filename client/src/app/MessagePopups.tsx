import { useState } from "react";
import { useLocation } from "wouter";
import { X, Minus, MessageSquare, Send } from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  useMessagePopups,
  dismissMessagePopup,
  type MessagePopup,
} from "./messagePopups";

/**
 * Non-intrusive incoming-message popups. When a message arrives while the user
 * is in a call or on another screen, a small card appears (bottom-right) with
 * the sender, the message content, and an inline reply box. Each card can be
 * minimized to a chip or closed. Mounted once at the app root.
 */
export function MessagePopups() {
  const popups = useMessagePopups();
  if (popups.length === 0) return null;
  return (
    <div className="fixed z-[80] bottom-24 right-3 md:bottom-4 flex flex-col gap-2 w-[min(92vw,340px)] pointer-events-none">
      {popups.map((p) => (
        <div key={p.id} className="pointer-events-auto">
          <PopupCard popup={p} />
        </div>
      ))}
    </div>
  );
}

function previewOf(kind: string, body: string | null): string {
  if (body && body.trim()) return body;
  switch (kind) {
    case "image": return "📷 Photo";
    case "video": return "🎬 Video";
    case "audio": return "🎤 Voice message";
    case "file": return "📎 File";
    default: return "New message";
  }
}

function PopupCard({ popup }: { popup: MessagePopup }) {
  const [, navigate] = useLocation();
  const [minimized, setMinimized] = useState(false);
  const [reply, setReply] = useState("");
  const utils = trpc.useUtils();
  const threads = trpc.messages.threads.useQuery(undefined, { staleTime: 10_000 });
  const list = trpc.messages.list.useQuery(
    { conversationId: popup.conversationId, limit: 5 },
    { refetchInterval: 8_000 }
  );
  const send = trpc.messages.send.useMutation({
    onSuccess: () => {
      setReply("");
      utils.messages.list.invalidate({ conversationId: popup.conversationId }).catch(() => {});
      utils.messages.threads.invalidate().catch(() => {});
    },
  });

  const thread = (threads.data ?? []).find((t) => t.conversationId === popup.conversationId);
  const name = thread?.title || thread?.peerDisplayName || thread?.peerNumber || "New message";
  const peerNumber = thread?.peerNumber ?? "";
  const msgs = list.data ?? [];
  const last =
    [...msgs].reverse().find((m) => m.senderIdentityId === popup.from) ?? msgs[msgs.length - 1];
  const preview = last ? previewOf(last.kind, last.body) : "New message";
  const when = last?.createdAt
    ? new Date(last.createdAt as string | Date).toLocaleString([], {
        hour: "numeric",
        minute: "2-digit",
        month: "short",
        day: "numeric",
      })
    : "";

  const open = () => {
    navigate(`/app/messages?c=${popup.conversationId}`);
    dismissMessagePopup(popup.conversationId);
  };
  const doReply = () => {
    const b = reply.trim();
    if (!b) return;
    send.mutate({ conversationId: popup.conversationId, body: b });
  };

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="ml-auto flex items-center gap-2 rounded-full bg-primary px-3 py-2 text-primary-foreground shadow-lg active:scale-95 transition"
      >
        <MessageSquare className="size-4" />
        <span className="max-w-[160px] truncate text-sm font-medium">{name}</span>
      </button>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
        <MessageSquare className="size-4 shrink-0 text-primary" />
        <button
          type="button"
          onClick={open}
          className="flex-1 min-w-0 text-left"
        >
          <span className="block truncate text-sm font-semibold hover:underline">{name}</span>
          {(peerNumber || when) && (
            <span className="block truncate text-[11px] text-muted-foreground">
              {peerNumber && <span className="font-mono">{peerNumber.replace(/(\d{3})(\d{3})/, "$1 $2")}</span>}
              {peerNumber && when ? " · " : ""}
              {when}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setMinimized(true)}
          aria-label="Minimize"
          className="rounded p-1 hover:bg-muted self-start"
        >
          <Minus className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => dismissMessagePopup(popup.conversationId)}
          aria-label="Close"
          className="rounded p-1 hover:bg-muted"
        >
          <X className="size-4" />
        </button>
      </div>
      <button
        type="button"
        onClick={open}
        className="block w-full px-3 py-2.5 text-left text-sm hover:bg-muted/30"
      >
        <span className="line-clamp-2 break-words">{preview}</span>
      </button>
      <div className="flex items-center gap-1.5 border-t border-border/60 p-2">
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doReply()}
          placeholder="Reply…"
          className="flex-1 rounded-full bg-muted/50 px-3 py-1.5 text-sm outline-none"
        />
        <button
          type="button"
          onClick={doReply}
          disabled={!reply.trim() || send.isPending}
          aria-label="Send reply"
          className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
        >
          <Send className="size-4" />
        </button>
      </div>
    </div>
  );
}
