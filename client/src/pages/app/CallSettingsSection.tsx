/**
 * Call Settings — the profile home for "send my calls to voicemail" (v2.107.48).
 * ────────────────────────────────────────────────────────────────────────────
 * Owner: "in the user profile ... he will find call settings. He can set that
 * direct all calls to the voice, OR direct calls to the voice for selected
 * users — when he clicks a look, the tool shows him his contacts and he can
 * select some."
 *
 * Two controls, both opt-in and OFF by default:
 *   1. A master switch — "Send all calls to voicemail".
 *   2. A per-contact picker — the same `callsToVoicemail` flag the contact
 *      three-dots menu toggles, surfaced here as a multi-select list so the user
 *      can pick several at once. Master ON supersedes the per-contact set
 *      (everyone goes to voicemail), so the picker is shown disabled/dimmed then
 *      with a note, rather than hidden — the selections are preserved for when
 *      the master switch is turned back off.
 *
 * Writes go through the existing endpoints (identity.updateProfile for the
 * master flag, contacts.update for each contact) — the server refreshes the
 * ring-time routing cache across boxes on each. Nothing here touches the ring
 * path; it only edits stored preferences.
 */
import { useState } from "react";
import { Voicemail, Search, CheckCircle2, Circle, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useT } from "@/app/i18n";
import { toast } from "sonner";

export function CallSettingsSection() {
  const t = useT();
  const utils = trpc.useUtils();
  const me = trpc.identity.whoami.useQuery();
  const contactsQ = trpc.contacts.list.useQuery(undefined, { staleTime: 15_000 });
  const [query, setQuery] = useState("");

  const allOn = me.data?.allCallsToVoicemail === true;

  const setMaster = trpc.identity.updateProfile.useMutation({
    onMutate: async ({ allCallsToVoicemail }) => {
      const prev = utils.identity.whoami.getData();
      utils.identity.whoami.setData(undefined, (d) =>
        d ? { ...d, allCallsToVoicemail: allCallsToVoicemail === true } : d,
      );
      return { prev };
    },
    onError: (_e, _v, cxt) => {
      if (cxt?.prev !== undefined) utils.identity.whoami.setData(undefined, cxt.prev);
      toast.error(t("callSettings.saveFailed"));
    },
    onSuccess: (_d, v) => {
      toast.success(v.allCallsToVoicemail ? t("callSettings.allOnToast") : t("callSettings.allOffToast"));
    },
  });

  const setContact = trpc.contacts.upsert.useMutation({
    onMutate: async (vars) => {
      await utils.contacts.list.cancel();
      const prev = utils.contacts.list.getData();
      utils.contacts.list.setData(undefined, (list) =>
        list?.map((c) =>
          c.number === vars.number ? { ...c, callsToVoicemail: vars.callsToVoicemail === true } : c,
        ),
      );
      return { prev };
    },
    onError: (_e: unknown, _v: unknown, cxt?: { prev?: ReturnType<typeof utils.contacts.list.getData> }) => {
      if (cxt?.prev !== undefined) utils.contacts.list.setData(undefined, cxt.prev);
      toast.error(t("callSettings.saveFailed"));
    },
    onSettled: () => {
      void utils.contacts.list.invalidate();
    },
  });

  if (!me.data) return null;

  const rows = (contactsQ.data ?? []).filter((c) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      (c.displayName ?? "").toLowerCase().includes(q) || c.number.includes(query.trim())
    );
  });
  const selectedCount = (contactsQ.data ?? []).filter((c) => c.callsToVoicemail).length;

  return (
    <div className="space-y-5">
      {/* Feature header */}
      <div className="flex flex-col items-center gap-1 text-center">
        <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Voicemail className="size-6" aria-hidden="true" />
        </div>
        <h2 className="text-base font-semibold">
          {t("callSettings.title")} <span aria-hidden="true">📮</span>
        </h2>
        <p className="max-w-xs text-xs text-muted-foreground">{t("callSettings.lede")}</p>
      </div>

      {/* Master switch */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card/40 p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t("callSettings.allTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("callSettings.allDesc")}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={allOn}
          aria-label={t("callSettings.allTitle")}
          disabled={setMaster.isPending}
          onClick={() => setMaster.mutate({ allCallsToVoicemail: !allOn })}
          className={
            "relative h-7 w-12 shrink-0 rounded-full transition-colors " +
            (allOn ? "bg-primary" : "bg-muted-foreground/30")
          }
        >
          <span
            className={
              "absolute top-0.5 grid size-6 place-items-center rounded-full bg-white shadow transition-all " +
              (allOn ? "start-[1.375rem]" : "start-0.5")
            }
          >
            {setMaster.isPending ? <Loader2 className="size-3 animate-spin text-primary" /> : null}
          </span>
        </button>
      </div>

      {/* Per-contact picker */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{t("callSettings.selectedTitle")}</p>
          {selectedCount > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              {selectedCount}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {allOn ? t("callSettings.selectedSupersededDesc") : t("callSettings.selectedDesc")}
        </p>

        <div className={"relative " + (allOn ? "pointer-events-none opacity-50" : "")}>
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("callSettings.searchContacts")}
            aria-label={t("callSettings.searchContacts")}
            className="w-full rounded-xl border border-border/60 bg-background py-2 ps-9 pe-3 text-sm outline-none focus:border-primary"
          />
        </div>

        <ul className={"max-h-72 space-y-1 overflow-y-auto " + (allOn ? "pointer-events-none opacity-50" : "")}>
          {contactsQ.isLoading ? (
            <li className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
            </li>
          ) : rows.length === 0 ? (
            <li className="py-6 text-center text-xs text-muted-foreground">
              {t("callSettings.noContacts")}
            </li>
          ) : (
            rows.map((c) => {
              const on = c.callsToVoicemail === true;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    disabled={setContact.isPending}
                    onClick={() =>
                      setContact.mutate({ number: c.number, callsToVoicemail: !on })
                    }
                    className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-start hover:bg-muted/60"
                  >
                    {on ? (
                      <CheckCircle2 className="size-5 shrink-0 text-primary" />
                    ) : (
                      <Circle className="size-5 shrink-0 text-muted-foreground/50" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {c.displayName || c.number}
                      </span>
                      {c.displayName && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {c.number}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
