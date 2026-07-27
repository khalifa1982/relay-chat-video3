import { useEffect, useState } from "react";
import { Plus, X, Check, ExternalLink, Plane, Coffee, Circle, Mail, Smartphone, Twitter, Globe, Ghost, MessageCircle, Link as LinkIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SOCIAL_PLATFORMS,
  MAX_MOBILES,
  MAX_SOCIALS,
  type SocialLink,
  type SocialPlatform,
} from "@shared/profileFields";
import { ProfileStatusPicker } from "@/app/ProfileStatusPicker";

/** The subset of the whoami identity the hub sections read. */
export interface HubMe {
  email?: string | null;
  bio?: string | null;
  statusOverride?: "" | "away" | "travel" | null;
  /** The profile LABEL (v2.101.1) — separate from the presence override above. */
  profileStatus?: string | null;
  statusNote?: string | null;
  mobiles?: string[] | null;
  socials?: SocialLink[] | null;
  isGuest: boolean;
}

function useProfileSave(onSaved: () => void, onError?: (msg: string) => void) {
  return trpc.identity.updateProfile.useMutation({
    onSuccess: onSaved,
    // Without this, a failed save (network blip, validation rejection) left the
    // form looking exactly like a successful one — no error ever reached the
    // user, and the local state had already been optimistically updated.
    onError: (err) => onError?.(err.message || "Couldn't save — try again."),
  });
}

function SaveError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

function SavedTick({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-[color:var(--relay-online,#06d6a0)]">
      <Check className="size-3.5" /> Saved
    </span>
  );
}

/* ── Email + mobile numbers ─────────────────────────────────────────────── */
export function ContactInfoSection({ me, onSaved }: { me: HubMe; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const save = useProfileSave(onSaved, setError);
  const [mobiles, setMobiles] = useState<string[]>(() => me.mobiles ?? []);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => { setMobiles(me.mobiles ?? []); }, [me.mobiles]);

  const persist = (next: string[]) => {
    setMobiles(next);
    setError(null);
    save.mutate({ mobiles: next }, { onSuccess: () => { setSaved(true); window.setTimeout(() => setSaved(false), 1500); } });
  };
  const add = () => {
    const v = draft.trim();
    if (!v || mobiles.length >= MAX_MOBILES) return;
    setDraft("");
    persist([...mobiles, v]);
  };

  return (
    <section className="space-y-3">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
        Contact info <SavedTick show={saved} />
      </Label>

      {/* Email (read-only; validated at registration).
          v2.99.93 — the owner's mockup labelled these rows with ICONS rather than
          words. The icon is `aria-hidden` and the word stays: an icon alone is a
          guessing game for anybody who has not seen the mockup, and it gives a
          screen reader nothing. */}
      <div className="rounded-2xl glass-surface-sm p-4 space-y-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Mail className="size-3.5 shrink-0" aria-hidden="true" />
          Email
        </div>
        {me.email ? (
          <div className="font-medium break-all">{me.email}</div>
        ) : (
          <div className="text-sm text-muted-foreground">
            {me.isGuest ? "Sign in to add a verified email." : "No email on file."}
          </div>
        )}
      </div>

      {/* Mobile numbers */}
      <div className="rounded-2xl glass-surface-sm p-4 space-y-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Smartphone className="size-3.5 shrink-0" aria-hidden="true" />
          Mobile numbers (optional)
        </div>
        {mobiles.length > 0 && (
          <ul className="space-y-2">
            {mobiles.map((m, i) => (
              <li key={m} className="flex items-center gap-2">
                <span className="flex-1 font-mono text-sm">{m}</span>
                <button
                  type="button"
                  aria-label="Remove number"
                  onClick={() => persist(mobiles.filter((_, j) => j !== i))}
                  className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {mobiles.length < MAX_MOBILES && (
          <div className="flex gap-2">
            <Input
              value={draft}
              inputMode="tel"
              placeholder="+1 555 123 4567"
              maxLength={32}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
            />
            <Button type="button" variant="secondary" onClick={add} disabled={!draft.trim()}>
              <Plus className="size-4" />
            </Button>
          </div>
        )}
        <SaveError message={error} />
      </div>
    </section>
  );
}

/* ── Social / external links ────────────────────────────────────────────── */
export function SocialLinksSection({ me, onSaved }: { me: HubMe; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const save = useProfileSave(onSaved, setError);
  const [links, setLinks] = useState<SocialLink[]>(() => me.socials ?? []);
  const [platform, setPlatform] = useState<SocialPlatform>("x");
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => { setLinks(me.socials ?? []); }, [me.socials]);

  const persist = (next: SocialLink[]) => {
    setLinks(next);
    setError(null);
    save.mutate({ socials: next }, { onSuccess: () => { setSaved(true); window.setTimeout(() => setSaved(false), 1500); } });
  };
  const add = () => {
    const v = value.trim();
    if (!v || links.length >= MAX_SOCIALS) return;
    setValue("");
    persist([...links, { platform, value: v }]);
  };

  const def = (k: string) => SOCIAL_PLATFORMS.find((p) => p.key === k);

  return (
    <section className="space-y-3">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
        Links &amp; social <SavedTick show={saved} />
      </Label>
      <div className="rounded-2xl glass-surface-sm p-4 space-y-3">
        {links.length > 0 && (
          <ul className="space-y-2">
            {links.map((l, i) => {
              const d = def(l.platform);
              const href = d?.href(l.value) ?? null;
              return (
                <li key={`${l.platform}-${l.value}`} className="flex items-center gap-2">
                  {/* v2.99.93 — a per-platform ICON beside the label, per the owner's
                      mockup. The label STAYS: four platforms is exactly the range
                      where icon-only becomes a guess, and it is what a screen reader
                      reads. The icon is decorative and marked so. */}
                  <span className="flex w-24 shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <SocialIcon platform={l.platform} />
                    <span className="truncate">{d?.label ?? l.platform}</span>
                  </span>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 truncate text-sm text-primary hover:underline inline-flex items-center gap-1"
                    >
                      {l.value} <ExternalLink className="size-3 shrink-0" />
                    </a>
                  ) : (
                    <span className="flex-1 truncate text-sm">{l.value}</span>
                  )}
                  <button
                    type="button"
                    aria-label="Remove link"
                    onClick={() => persist(links.filter((_, j) => j !== i))}
                    className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                  >
                    <X className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {links.length < MAX_SOCIALS && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as SocialPlatform)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm sm:w-36"
            >
              {SOCIAL_PLATFORMS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
            <Input
              value={value}
              placeholder={def(platform)?.placeholder}
              maxLength={200}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
              className="flex-1"
            />
            <Button type="button" variant="secondary" onClick={add} disabled={!value.trim()}>
              <Plus className="size-4" /> Add
            </Button>
          </div>
        )}
        <SaveError message={error} />
        <p className="text-xs text-muted-foreground">
          Add your X, website, Snapchat, or WhatsApp so contacts can reach you elsewhere.
        </p>
      </div>
    </section>
  );
}

/* ── Bio ────────────────────────────────────────────────────────────────── */
export function BioSection({ me, onSaved }: { me: HubMe; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const save = useProfileSave(onSaved, setError);
  const [bio, setBio] = useState(() => me.bio ?? "");
  const [saved, setSaved] = useState(false);
  useEffect(() => { setBio(me.bio ?? ""); }, [me.bio]);
  const dirty = bio.trim() !== (me.bio ?? "").trim();
  return (
    <section className="space-y-3">
      <Label htmlFor="bio" className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
        About <SavedTick show={saved} />
      </Label>
      <textarea
        id="bio"
        value={bio}
        maxLength={500}
        rows={3}
        placeholder="A short line about you…"
        onChange={(e) => setBio(e.target.value)}
        className="w-full resize-none rounded-xl border border-input bg-background p-3 text-sm outline-none focus:border-primary"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{bio.length}/500</span>
        <Button
          type="button"
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() => {
            setError(null);
            save.mutate({ bio: bio.trim() }, { onSuccess: () => { setSaved(true); window.setTimeout(() => setSaved(false), 1500); } });
          }}
        >
          Save
        </Button>
      </div>
      <SaveError message={error} />
    </section>
  );
}

/* ── Status (online auto / away / travelling) ───────────────────────────── */
/**
 * The profile STATUS picker (v2.101.1).
 *
 * Owner: *"you are in work, vacation, travel, free, and you can put some notes on
 * it… and everyone has emoji and color."*
 *
 * The old control offered Auto / Away / Travelling — the three values of the PRESENCE
 * override. Those three are not gone, they are DERIVED: picking a label computes the
 * availability it implies (`overrideForStatus`, in one place server-side), so the LED
 * keeps working with its four-colour vocabulary intact while the label carries the
 * detail. "Away" is no longer directly selectable because "Busy" is the same
 * availability with a word people actually use.
 *
 * COLOUR IS REINFORCEMENT, NOT THE CARRIER: the emoji names the status and the label
 * is in the ordinary foreground colour, with the hue on a tint and a border. Nothing
 * here depends on telling sky from violet, which is also why these five hues need no
 * AA measurement of their own (unlike the `--relay-*-text` tokens, which do carry
 * small coloured text — v2.99.94).
 */
export function StatusSection({ me, onSaved }: { me: HubMe; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const save = useProfileSave(onSaved, setError);
  return (
    <section className="space-y-3">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">Status</Label>
      <ProfileStatusPicker
        value={me.profileStatus}
        note={me.statusNote}
        pending={save.isPending}
        onPick={(k) => {
          setError(null);
          save.mutate({ profileStatus: k ?? "" });
        }}
        onSaveNote={(next) => {
          setError(null);
          save.mutate({ statusNote: next });
        }}
      />
      <SaveError message={error} />
    </section>
  );
}

/**
 * The icon for one social platform (v2.99.93).
 *
 * Kept as its own component with an exhaustive switch, so adding a fifth platform to
 * `SOCIAL_PLATFORMS` and forgetting the icon degrades to a neutral link glyph rather
 * than rendering nothing. `aria-hidden` throughout: the label beside it already says
 * which platform this is, and announcing "image" twice per row is noise.
 */
function SocialIcon({ platform }: { platform: string }) {
  const cls = "size-3.5 shrink-0";
  switch (platform) {
    case "x":
      return <Twitter className={cls} aria-hidden="true" />;
    case "website":
      return <Globe className={cls} aria-hidden="true" />;
    case "snapchat":
      return <Ghost className={cls} aria-hidden="true" />;
    case "whatsapp":
      return <MessageCircle className={cls} aria-hidden="true" />;
    default:
      return <LinkIcon className={cls} aria-hidden="true" />;
  }
}
