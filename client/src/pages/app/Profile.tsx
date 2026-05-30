import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useIdentity } from "@/app/useIdentity";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Profile page (`/app/profile`).
 *
 * Lets a registered or guest user edit their display name and upload an
 * avatar. For guests, also offers the "Keep my number forever" CTA that
 * triggers Manus OAuth so the server can migrate the guest identity into
 * a permanent user row on callback.
 */
export default function ProfilePage() {
  const { me, refresh } = useIdentity();
  const [name, setName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (me?.displayName) setName(me.displayName);
  }, [me?.displayName]);

  const signOutMut = trpc.identity.signOutGuest.useMutation();
  const updateProfile = trpc.identity.updateProfile.useMutation({
    onSuccess: () => {
      refresh();
      setSavedAt(Date.now());
      setError(null);
    },
    onError: (err) => setError(err.message),
  });

  async function saveName() {
    const next = name.trim();
    if (!next) {
      setError("Display name can't be empty.");
      return;
    }
    if (next === me?.displayName) return;
    updateProfile.mutate({ displayName: next });
  }

  async function onAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Avatar must be an image.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError("Avatar must be under 4 MB.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ""));
        r.onerror = () => reject(new Error("Failed to read file"));
        r.readAsDataURL(file);
      });
      const base64 = dataUrl.split(",")[1] || "";
      const res = await fetch("/api/v2/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type,
          dataBase64: base64,
        }),
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const json = (await res.json()) as { url: string };
      updateProfile.mutate({ avatarUrl: json.url });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Avatar upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function clearAvatar() {
    if (!me?.avatarUrl) return;
    updateProfile.mutate({ avatarUrl: null });
  }

  if (!me) {
    return (
      <div className="h-full grid place-items-center text-muted-foreground">
        Loading profile…
      </div>
    );
  }

  const initials = (me.displayName || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("") || "?";

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-xl mx-auto p-6 space-y-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your display name and avatar are shown to people you call and chat with.
          </p>
        </header>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 text-destructive-foreground px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {savedAt && Date.now() - savedAt < 4000 && !error && (
          <div className="rounded-lg border border-primary/40 bg-primary/10 text-primary-foreground px-4 py-3 text-sm">
            Saved.
          </div>
        )}

        {/* avatar */}
        <section className="space-y-4">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Avatar
          </Label>
          <div className="flex items-center gap-5">
            <div className="relative">
              {me.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={me.avatarUrl}
                  alt={me.displayName}
                  className="w-20 h-20 rounded-full object-cover border border-border"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary to-accent grid place-items-center text-2xl font-bold text-primary-foreground border border-border">
                  {initials}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={onAvatarPick}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => fileRef.current?.click()}
                disabled={uploading || updateProfile.isPending}
              >
                {uploading ? "Uploading…" : me.avatarUrl ? "Replace photo" : "Upload photo"}
              </Button>
              {me.avatarUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={clearAvatar}
                  disabled={updateProfile.isPending}
                  className="text-destructive hover:text-destructive"
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            PNG, JPG, WebP or GIF up to 4 MB.
          </p>
        </section>

        {/* display name */}
        <section className="space-y-3">
          <Label htmlFor="displayName" className="text-xs uppercase tracking-wider text-muted-foreground">
            Display name
          </Label>
          <div className="flex gap-3">
            <Input
              id="displayName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              autoComplete="off"
              className="flex-1"
            />
            <Button
              type="button"
              onClick={saveName}
              disabled={updateProfile.isPending || !name.trim() || name.trim() === me.displayName}
            >
              Save
            </Button>
          </div>
        </section>

        {/* number */}
        <section className="space-y-2">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Your number
          </Label>
          <div className="text-2xl font-mono tracking-widest">
            {me.number.slice(0, 3)} {me.number.slice(3)}
          </div>
          <p className="text-xs text-muted-foreground">
            Share this 6-digit number for people to call or message you.
          </p>
        </section>

        {/* upgrade CTA for guests */}
        {me.isGuest && (
          <section className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-3">
            <h2 className="text-lg font-semibold">Keep this number forever</h2>
            <p className="text-sm text-muted-foreground">
              Guests are kept on this device for 30 days. Sign in to save your number and
              contacts permanently across all your devices.
            </p>
            <Button
              type="button"
              onClick={() => {
                window.location.href = getLoginUrl();
              }}
            >
              Sign in to upgrade
            </Button>
          </section>
        )}

        {/* sign out */}
        <section className="pt-4 border-t border-border">
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={async () => {
              if (!confirm("Sign out and forget this number on this device?")) return;
              try {
                await signOutMut.mutateAsync();
              } catch {
                /* ignore */
              }
              window.location.href = "/";
            }}
          >
            Sign out
          </Button>
        </section>
      </div>
    </div>
  );
}
