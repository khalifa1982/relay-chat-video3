/* ============================================================
   Admin panel (v2.99.76).

   Owner: "why you dont do it at the backend / Or create for me an admin panel
   were i can change it".

   Find a person by number, email or name; change their 6-digit number. That is the
   whole panel, on purpose — see the router's comment. The number change goes
   through the same single writer the self-service path uses, so it propagates to
   everyone who saved the old number and moves none of that person's data.

   The gate here is presentational only. Every procedure re-checks admin status
   server-side from the `users` row, so a client that renders this page anyway gets
   FORBIDDEN on each call rather than access.
   ============================================================ */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ShieldCheck, Search, Loader2, Hash } from "lucide-react";
import { RoleBadge } from "@/app/VerifiedBadge";

function fmtNum(n: string) {
  return /^\d{6}$/.test(n) ? `${n.slice(0, 3)} ${n.slice(3)}` : n;
}

export default function Admin() {
  const amIAdmin = trpc.admin.amIAdmin.useQuery(undefined, { staleTime: 60_000 });
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const utils = trpc.useUtils();
  const found = trpc.admin.findIdentities.useQuery(
    { query: submitted },
    { enabled: amIAdmin.data?.admin === true },
  );
  // Which row is being edited, and what has been typed for it.
  const [editing, setEditing] = useState<number | null>(null);
  const [wanted, setWanted] = useState("");
  const [error, setError] = useState<string | null>(null);
  const setNumber = trpc.admin.setIdentityNumber.useMutation({
    onSuccess: (res) => {
      toast.success(
        res.unchanged
          ? "That was already their number."
          : `Changed ${fmtNum(res.oldNumber)} → ${fmtNum(res.newNumber)}`,
      );
      setEditing(null);
      setWanted("");
      setError(null);
      utils.admin.findIdentities.invalidate().catch(() => {});
    },
    // The server names each refusal; showing its own message means a typo and a
    // collision read differently, which is the point of naming them.
    onError: (e) => setError(e.message || "Couldn't change that number."),
  });

  const digits = wanted.replace(/[\s\-.]/g, "");
  const ok = /^\d{6}$/.test(digits) && !/^(000|111)/.test(digits);

  if (amIAdmin.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (!amIAdmin.data?.admin) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <ShieldCheck className="size-8 text-muted-foreground" />
        <p className="text-sm font-semibold">Administrators only</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          This account doesn't hold the admin role. Nothing on this page is available to it.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-5 text-[color:var(--relay-online,#06d6a0)]" />
        <h1 className="text-lg font-bold">Admin</h1>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(query.trim());
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="6-digit number, email, or name"
            aria-label="Find a person"
            dir="auto"
            className="w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <Button type="submit" size="sm" variant="outline">
          Find
        </Button>
      </form>

      <p className="text-xs text-muted-foreground">
        Changing a number updates everyone who saved it. Messages, calls, contacts and
        statuses all stay with the person — only the number moves, and the old one is never
        reissued to anybody else.
      </p>

      {found.isLoading ? (
        <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (found.data?.rows.length ?? 0) === 0 ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          {submitted ? `Nobody matches “${submitted}”.` : "No identities yet."}
        </div>
      ) : (
        <ul className="space-y-2">
          {found.data?.rows.map((r) => (
            <li key={r.id} className="rounded-2xl border border-border bg-card/60 p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-semibold" dir="auto">
                      {r.displayName || "Unnamed"}
                    </span>
                    <RoleBadge role={r.role} caption={false} size={13} />
                  </div>
                  <div
                    className="mt-0.5 font-mono text-sm text-muted-foreground [unicode-bidi:isolate]"
                    dir="ltr"
                  >
                    {fmtNum(r.number)}
                  </div>
                  {r.email && (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground" dir="ltr">
                      {r.email}
                    </div>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(editing === r.id ? null : r.id);
                    setWanted("");
                    setError(null);
                  }}
                >
                  <Hash className="size-3.5" />
                  {editing === r.id ? "Cancel" : "Change number"}
                </Button>
              </div>
              {editing === r.id && (
                <div className="mt-3 border-t border-border/60 pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      // Text with a numeric keypad: type="number" brings spinners,
                      // accepts "1e5" and drops a leading zero.
                      type="text"
                      inputMode="numeric"
                      dir="ltr"
                      autoComplete="off"
                      maxLength={9}
                      placeholder="777777"
                      value={wanted}
                      onChange={(e) => {
                        setWanted(e.target.value);
                        setError(null);
                      }}
                      aria-label={`New number for ${r.displayName || r.number}`}
                      className="w-36 rounded-lg border border-border bg-background px-3 py-2 text-center font-mono text-lg tracking-[0.12em] outline-none focus:border-primary"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={!ok || setNumber.isPending}
                      onClick={() =>
                        setNumber.mutate({ identityId: r.id, number: digits })
                      }
                    >
                      {setNumber.isPending ? "Changing…" : "Apply"}
                    </Button>
                  </div>
                  {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
                  {!error && wanted.length > 0 && !ok && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Six digits, and it can't start with 000 or 111.
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
