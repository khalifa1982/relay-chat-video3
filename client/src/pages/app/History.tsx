import { useMemo } from "react";
import {
  Clock,
  Phone,
  Users,
  PhoneMissed,
  PhoneOutgoing,
  PhoneIncoming,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { formatDuration, formatWhen } from "@/lib/formatCall";
import { useIdentity } from "@/app/useIdentity";
import { useRelayEngine } from "@/app/RelayEngine";

type ConfRow = {
  id: number;
  roomId: string;
  dialedNumber: string | null;
  partyCount: number;
  startedAt: string | Date;
  endedAt: string | Date;
  durationSec: number;
  participants: Array<{ number: string; name: string; isSelf: boolean }>;
};

type CallRow = {
  id: number;
  direction: "in" | "out";
  status: string;
  startedAt: string | Date;
  other: { number: string; displayName: string } | null;
};

type Item =
  | { kind: "conf"; key: string; at: number; conf: ConfRow }
  | { kind: "missed"; key: string; at: number; call: CallRow };

export default function HistoryPage() {
  const { me } = useIdentity();
  const engine = useRelayEngine();

  // Answered calls (2..10 parties) with full roster + duration.
  const conferences = trpc.calls.conferenceHistory.useQuery(undefined, {
    enabled: !!me,
    refetchInterval: 30_000,
  });
  // 1:1 history — we only surface the MISSED/DECLINED rows here (answered calls
  // already come through `conferenceHistory`, so this avoids double-listing).
  const oneToOne = trpc.calls.history.useQuery(undefined, {
    enabled: !!me,
    refetchInterval: 30_000,
  });

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const c of (conferences.data ?? []) as ConfRow[]) {
      out.push({
        kind: "conf",
        key: "conf-" + c.id,
        at: new Date(c.startedAt).getTime(),
        conf: c,
      });
    }
    for (const c of (oneToOne.data ?? []) as CallRow[]) {
      if (c.status !== "missed" && c.status !== "declined") continue;
      out.push({
        kind: "missed",
        key: "miss-" + c.id,
        at: new Date(c.startedAt).getTime(),
        call: c,
      });
    }
    out.sort((a, b) => b.at - a.at);
    return out;
  }, [conferences.data, oneToOne.data]);

  const loading = conferences.isLoading || oneToOne.isLoading;
  const redial = (num: string) => {
    if (num) engine.dial(num);
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-4 pb-24 pt-4 md:pb-6">
      <header className="mb-4 flex items-center gap-2">
        <Clock className="size-5 text-primary" />
        <h1 className="text-lg font-semibold tracking-tight">Call history</h1>
      </header>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/60 shadow-xl shadow-black/10 backdrop-blur-xl backdrop-saturate-150">
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : items.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No calls yet. Your conference and call history will appear here —
              who you dialed, how many people joined, their names and numbers,
              and how long the call lasted.
            </div>
          ) : (
            <ul>
              {items.map((it) =>
                it.kind === "conf" ? (
                  <ConferenceItem key={it.key} conf={it.conf} onRedial={redial} />
                ) : (
                  <MissedItem key={it.key} call={it.call} onRedial={redial} />
                )
              )}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function ConferenceItem({
  conf,
  onRedial,
}: {
  conf: ConfRow;
  onRedial: (num: string) => void;
}) {
  const others = conf.participants.filter((p) => !p.isSelf);
  const isGroup = conf.partyCount > 2;
  const Icon = isGroup ? Users : Phone;
  // Title = the other people on the call (or the dialed number as a fallback).
  const title =
    others.length > 0
      ? others.map((p) => p.name).join(", ")
      : conf.dialedNumber
        ? `Call to ${conf.dialedNumber}`
        : "Call";
  // Best number to call back: the dialed number, else the first other party.
  const callBack = conf.dialedNumber || others[0]?.number || "";

  return (
    <li className="border-b border-border/60 px-4 py-3 last:border-b-0 hover:bg-muted/30">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">
            {isGroup ? (
              <>
                <Users className="mr-1 inline size-3 align-[-1px]" />
                {conf.partyCount} people ·{" "}
              </>
            ) : null}
            {formatDuration(conf.durationSec)} · {formatWhen(conf.startedAt)}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={!callBack}
          aria-label="Call back"
          onClick={() => onRedial(callBack)}
        >
          <Phone className="size-4" />
        </Button>
      </div>

      {/* Roster: every participant's name + PIN. */}
      <div className="mt-2 flex flex-wrap gap-1.5 pl-12">
        {conf.participants.map((p, i) => (
          <span
            key={p.number + "-" + i}
            className={
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] " +
              (p.isSelf
                ? "bg-primary/15 text-primary"
                : "bg-muted/60 text-muted-foreground")
            }
            title={p.number}
          >
            <span className="max-w-[10rem] truncate font-medium">
              {p.isSelf ? "You" : p.name}
            </span>
            {p.number ? <span className="font-mono opacity-70">{p.number}</span> : null}
          </span>
        ))}
      </div>
    </li>
  );
}

function MissedItem({
  call,
  onRedial,
}: {
  call: CallRow;
  onRedial: (num: string) => void;
}) {
  const Icon =
    call.status === "missed"
      ? call.direction === "in"
        ? PhoneMissed
        : PhoneOutgoing
      : call.direction === "in"
        ? PhoneIncoming
        : PhoneOutgoing;
  const peerNum = call.other?.number ?? "";
  const peerName = call.other?.displayName ?? peerNum ?? "Unknown";
  const label = call.status === "declined" ? "Declined" : "Missed";

  return (
    <li className="border-b border-border/60 px-4 py-3 last:border-b-0 hover:bg-muted/30">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-destructive/10 text-destructive">
          <Icon className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{peerName}</div>
          <div className="text-xs text-muted-foreground">
            <span className="text-destructive">{label}</span>
            {peerNum ? <span className="font-mono"> · {peerNum}</span> : null} ·{" "}
            {formatWhen(call.startedAt)}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={!peerNum}
          aria-label="Call back"
          onClick={() => onRedial(peerNum)}
        >
          <Phone className="size-4" />
        </Button>
      </div>
    </li>
  );
}
