/**
 * Your own RELAY number: the QR plate, the share sheet, and the board's "MY NUMBER" card.
 *
 * EXTRACTED FROM Profile.tsx (v2.106.3), not copied. The design handoff's Dialer frame
 * (1a) asks for a "MY NUMBER" glass card carrying copy / QR / share, and Profile already
 * had all three inside a bottom sheet — so a second implementation would have been two
 * QR renderers, two invite-link formats and two share fallbacks that drift apart one edit
 * at a time. There is one of each, here, and both surfaces mount it.
 *
 * The QR encodes the app's own `/i/<number>` invite link, which is the same link the
 * share button copies — a QR that resolved to something else would be a second meaning
 * for "share my number".
 */
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Copy, QrCode, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer";
import { trpc } from "@/lib/trpc";
import { CountryFlag } from "./CountryFlag";
import { shareInviteMessage, type Translate } from "./inviteMessage";
import { useT } from "./i18n";

/** The app-wide invite link for a number. One format, so the QR and the share text agree. */
export function inviteUrlFor(number: string): string {
  return typeof window !== "undefined"
    ? `${window.location.origin}/i/${number}`
    : `/i/${number}`;
}

/** NNN NNN, the grouping every RELAY surface shows a number in. */
export function spacedNumber(number: string): string {
  return number.length === 6 ? `${number.slice(0, 3)} ${number.slice(3)}` : number;
}

/* ============================================================
   QrGlyph — a REAL, scannable QR code (qrcode.react, bundled — no
   third-party service) encoding `value` (the /i/<number> invite
   link). Dark modules on a light plate in BOTH themes — that's how
   a code stays scannable — so the two colours are FIXED graphic
   values, not theme surfaces. `level="M"` tolerates ~15% occlusion.
   ============================================================ */
export function QrGlyph({ value, className }: { value: string; className?: string }) {
  return (
    <QRCodeSVG
      value={value}
      level="M"
      marginSize={2}
      bgColor="#eff2f5"
      fgColor="#12161b"
      className={className}
      style={{ width: "100%", height: "100%" }}
    />
  );
}

/** Copy the bare number. Shared so the card and the sheet cannot disagree about what
 *  "copy" means — the NUMBER, not the link; the link is what Share sends. */
export function copyOwnNumber(number: string) {
  navigator.clipboard
    ?.writeText(number)
    .then(() => toast.success("Number copied"))
    .catch(() => toast.error("Couldn't copy the number"));
}

/**
 * Share the invite link.
 *
 * The MESSAGE is built by `buildInviteMessage` (v2.106.92) rather than here — there were
 * four share sites with three different wordings, which is how the run-on, phone-linkified
 * text the owner screenshotted came to exist. This function's only job is to supply who is
 * sharing and where the link points.
 */
export function shareOwnNumber(t: Translate, number: string, myName?: string | null) {
  shareInviteMessage(t, {
    who: { name: myName, pin: number },
    url: inviteUrlFor(number),
    onCopied: () => toast.success("Invite copied"),
    onCopyFailed: () => toast.error("Couldn't copy the invite"),
  });
}

/* ============================================================
   ShareNumberSheet — the QR-share bottom sheet: a rounded-top sheet
   that slides up with the QR artwork, the RELAY number + flag, and
   real Copy / Share actions. Uses the shared vaul Drawer so
   surfaces stay theme-aware.
   ============================================================ */
export function ShareNumberSheet({
  open,
  onOpenChange,
  number,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  number: string;
}) {
  const geo = trpc.directory.geoSelf.useQuery(undefined, {
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  const t = useT();
  const me = trpc.identity.whoami.useQuery(undefined, { staleTime: 30_000 });
  const pretty = spacedNumber(number);
  const inviteUrl = inviteUrlFor(number);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="border-border">
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-6 pb-8 pt-3">
          <DrawerTitle className="text-base font-extrabold">Share your RELAY number</DrawerTitle>
          {/* QR plate: fixed light plate + dark modules (legibility), themed frame */}
          <div className="grid size-44 place-items-center rounded-2xl border border-border bg-[#eff2f5] p-3.5">
            <QrGlyph value={inviteUrl} className="size-full" />
          </div>
          <div className="flex items-center gap-2">
            <CountryFlag
              code={geo.data?.country}
              title={geo.data?.countryName ?? geo.data?.country ?? ""}
              className="text-lg"
            />
            <span className="font-mono text-lg font-bold tracking-[0.12em]">{pretty}</span>
          </div>
          <DrawerDescription className="text-center text-xs">
            Share your number so friends can call or message you on RELAY.
          </DrawerDescription>
          <div className="grid w-full grid-cols-2 gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={() => copyOwnNumber(number)}
              className="gap-2"
            >
              <Copy className="size-4" /> Copy number
            </Button>
            <Button
              type="button"
              onClick={() => shareOwnNumber(t, number, me.data?.displayName)}
              className="gap-2 border-0 text-[#08211d] hover:brightness-95"
              style={{ background: "linear-gradient(135deg,#3FE0C5,#6EE7FF)" }}
            >
              <Share2 className="size-4" /> Share
            </Button>
          </div>
          <DrawerClose asChild>
            <Button type="button" variant="ghost" className="w-full">
              Done
            </Button>
          </DrawerClose>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * MyNumberCard — the design handoff's 1a "MY NUMBER" glass card.
 *
 * Board: a `.rglass` card with the mono label "MY NUMBER", the number itself, and three
 * round actions — copy, QR, share. It owns the sheet it opens, so a caller mounts ONE
 * element and gets the whole behaviour; two call sites managing their own `open` state is
 * how one of them ends up with a card whose QR button does nothing.
 *
 * Renders NOTHING without a number: a guest mid-mint has none, and a card headed
 * "MY NUMBER" with an em-dash under it states something false about the account.
 */
export function MyNumberCard({
  number,
  className = "",
}: {
  number: string | null | undefined;
  className?: string;
}) {
  const [qrOpen, setQrOpen] = useState(false);
  const t = useT();
  /* Same query key the shell already runs, so react-query serves it from cache — this
     costs no request. It supplies the NAME the invite leads with; without it the message
     falls back to its anonymous phrasing rather than interpolating "undefined". */
  const me = trpc.identity.whoami.useQuery(undefined, { staleTime: 30_000 });
  if (!number || number.length !== 6) return null;
  const actions: { key: string; label: string; icon: React.ReactNode; run: () => void }[] = [
    { key: "copy", label: "Copy my number", icon: <Copy className="size-4" />, run: () => copyOwnNumber(number) },
    { key: "qr", label: "Show my QR code", icon: <QrCode className="size-4" />, run: () => setQrOpen(true) },
    {
      key: "share",
      label: "Share my number",
      icon: <Share2 className="size-4" />,
      run: () => shareOwnNumber(t, number, me.data?.displayName),
    },
  ];
  return (
    <>
      <div
        className={"rmynum rglass flex items-center gap-3 rounded-2xl px-4 py-3 " + className}
        data-testid="my-number-card"
      >
        <div className="min-w-0 flex-1">
          <div
            className="font-mono text-[10px] uppercase text-muted-foreground"
            style={{ letterSpacing: ".22em" }}
          >
            My number
          </div>
          {/* dir=ltr + bidi isolation: a dash-separated number can have its parts
              reordered inside an RTL paragraph (the v2.99.77 rule). */}
          <div
            dir="ltr"
            className="font-mono text-[22px] font-bold leading-tight [unicode-bidi:isolate]"
            style={{ letterSpacing: ".08em" }}
          >
            {spacedNumber(number).replace(" ", "-")}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={a.run}
              aria-label={a.label}
              title={a.label}
              className="rchip-accent grid size-9 place-items-center rounded-xl transition-transform duration-150 active:scale-[0.94]"
            >
              {a.icon}
            </button>
          ))}
        </div>
      </div>
      <ShareNumberSheet open={qrOpen} onOpenChange={setQrOpen} number={number} />
    </>
  );
}
