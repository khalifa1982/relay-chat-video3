/* ============================================================
   Admin panel (v2.99.76).

   Owner: "why you dont do it at the backend / Or create for me an admin panel
   were i can change it".

   Find a person by number, email or name; change their 6-digit number, and check
   why a notification did not reach their phone. That is the whole panel, on purpose
   — see the router's comment. The number change goes through the same single writer
   the self-service path uses, so it propagates to everyone who saved the old number
   and moves none of that person's data.

   The NOTIFICATION CHECK was added in v2.99.91 because a native push crosses five
   links and every one of them fails the same way from the phone: nothing happens.
   It reports each link separately, and the test send goes through the REAL sender —
   a parallel test path could pass while production was broken.

   The gate here is presentational only. Every procedure re-checks admin status
   server-side from the `users` row, so a client that renders this page anyway gets
   FORBIDDEN on each call rather than access.
   ============================================================ */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ShieldCheck, Search, Loader2, Hash, BellRing, Check, X } from "lucide-react";
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
  /** Which row's notification panel is open (v2.99.91). */
  const [checking, setChecking] = useState<number | null>(null);
  const [wanted, setWanted] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Which row has its account-type controls open (v2.99.99). */
  const [typing, setTyping] = useState<number | null>(null);
  const [typeError, setTypeError] = useState<string | null>(null);
  const setType = trpc.admin.setAccountType.useMutation({
    onSuccess: () => {
      setTypeError(null);
      setTyping(null);
      utils.admin.findIdentities.invalidate();
    },
    // The server NAMES each refusal, because a guest, a self-demotion and
    // "become a guest" need three different next steps. Surfacing its message
    // verbatim is the whole point of naming them.
    onError: (e) => setTypeError(e.message),
  });
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
                <div className="flex shrink-0 flex-col items-end gap-1.5">
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
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setChecking(checking === r.id ? null : r.id)}
                  >
                    <BellRing className="size-3.5" />
                    {checking === r.id ? "Hide" : "Notifications"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setTyping(typing === r.id ? null : r.id);
                      setTypeError(null);
                    }}
                  >
                    <ShieldCheck className="size-3.5" />
                    {typing === r.id ? "Cancel" : "Account type"}
                  </Button>
                </div>
              </div>
              {checking === r.id && <PushCheck identityId={r.id} />}
              {typing === r.id && (
                <div className="mt-3 border-t border-border/60 pt-3">
                  <p className="text-xs text-muted-foreground">
                    Account type is <span className="font-semibold text-foreground">{r.role}</span>.
                  </p>
                  {r.isGuest ? (
                    /* A guest has no account row at all — that is what being a guest
                       IS — so there is no role to write. Said here rather than offered
                       and then refused, because a control that always fails is worse
                       than one that is absent. */
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Guests have no account behind them, so there's no role to change. They
                      keep their number and everything in it when they register themselves.
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={r.role === "admin" || setType.isPending}
                        onClick={() => setType.mutate({ identityId: r.id, role: "admin" })}
                      >
                        Make admin
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={r.role !== "admin" || setType.isPending}
                        onClick={() => setType.mutate({ identityId: r.id, role: "registered" })}
                      >
                        Remove admin
                      </Button>
                    </div>
                  )}
                  {typeError && <p className="mt-2 text-xs text-destructive">{typeError}</p>}
                </div>
              )}
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

/* ============================================================
   Why a notification did not arrive (v2.99.91).

   Owner: "Can you check the Firebase configuration as still the notification for
   the front mobile apps for Android? It's not showing or it's not active."

   A native push crosses FIVE links and each one fails identically from the phone —
   nothing happens. So this reports them one at a time, worst-first, and finishes
   with a REAL send through the production sender. What it deliberately does NOT do
   is show a token: an FCM registration token with the project key, or an Expo token
   on its own, is enough to push to that handset.
   ============================================================ */
function Row({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <li className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className={
          "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full " +
          (ok ? "bg-emerald-500/20 text-emerald-500" : "bg-destructive/20 text-destructive")
        }
      >
        {ok ? <Check className="size-3" strokeWidth={3} /> : <X className="size-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="font-medium">{label}</span>
        {detail && <span className="block text-muted-foreground">{detail}</span>}
      </span>
    </li>
  );
}

function PushCheck({ identityId }: { identityId: number }) {
  const q = trpc.admin.pushDiagnostics.useQuery({ identityId }, { staleTime: 5_000 });
  const test = trpc.admin.sendTestPush.useMutation({
    onSuccess: (r) =>
      r.delivered > 0
        ? toast.success(`Sent to ${r.delivered} device${r.delivered === 1 ? "" : "s"}.`)
        : // Zero is the informative case: the send path ran and nothing was
          // reachable, which is different from the request failing.
          toast.error("Nothing was reachable — no device accepted it."),
    onError: (e) => toast.error(e.message || "Couldn't send the test."),
  });

  if (q.isLoading) {
    return (
      <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Checking…
      </div>
    );
  }
  if (!q.data) {
    return (
      <p className="mt-3 border-t border-border/60 pt-3 text-xs text-destructive">
        Couldn't read the notification state.
      </p>
    );
  }
  const d = q.data;
  const native = d.devices.filter((x) => x.kind === "fcm" || x.kind === "expo");
  /* A row whose STORED kind and SHAPE-DERIVED kind disagree is unroutable: the
     sender picks the transport by the stored kind, so an Expo token filed as `fcm`
     goes to FCM and is dropped with no error anywhere. This is the one failure that
     is completely invisible without printing both. */
  const mismatched = d.devices.filter((x) => x.derived !== "unknown" && x.derived !== x.kind);

  return (
    <div className="mt-3 space-y-3 border-t border-border/60 pt-3 text-xs">
      <ul className="space-y-1.5">
        <Row
          ok={native.length > 0}
          label={
            native.length > 0
              ? `${native.length} phone app device${native.length === 1 ? "" : "s"} registered`
              : "No phone-app device registered"
          }
          detail={
            native.length > 0
              ? native.map((x) => `${x.kind} · ${x.prefix}… (${x.length} chars)`).join("  ·  ")
              : "The app has never handed us a push token. Nothing the server does can fix this — the shell must post {type:\"SET_PUSH_TOKEN\", token} into the page."
          }
        />
        <Row
          ok={mismatched.length === 0}
          label={mismatched.length === 0 ? "Every token is routable" : `${mismatched.length} token filed under the wrong transport`}
          detail={
            mismatched.length === 0
              ? undefined
              : mismatched.map((x) => `stored ${x.kind}, looks like ${x.derived}`).join("; ")
          }
        />
        <Row
          ok={d.pushEnabled}
          label={d.pushEnabled ? "Their push switch is on" : "THEY turned push notifications off"}
          detail={d.pushEnabled ? undefined : "Profile → Notifications on their device."}
        />
        <Row
          ok={d.transports.fcm}
          label={d.transports.fcm ? "Firebase is configured on the server" : "Firebase is NOT configured on the server"}
          detail={
            d.transports.fcm
              ? "FIREBASE_SERVICE_ACCOUNT_JSON is present and parses."
              : "Only needed for RAW device tokens. Expo tokens go through Expo and need nothing here."
          }
        />
        <Row ok={d.transports.expo} label="Expo delivery is available" detail={d.transports.expoAccessToken ? "EXPO_ACCESS_TOKEN set." : "No access token — fine unless the Expo account enforces one."} />
        <Row ok={d.transports.webpush} label={d.transports.webpush ? "Browser push is configured" : "Browser push is NOT configured"} />
        {/* The most likely reading of "it's not showing": testing by CALLING. */}
        <Row
          ok={false}
          label="A CALL does not push at all"
          detail={`Removed in v2.99.11 at your request, so a closed app never rings. What does push: ${d.sendsFor.join(", ")}.`}
        />
      </ul>
      <Button
        type="button"
        size="sm"
        disabled={test.isPending}
        onClick={() => test.mutate({ identityId })}
      >
        <BellRing className="size-3.5" />
        {test.isPending ? "Sending…" : "Send a test notification"}
      </Button>
    </div>
  );
}
