import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Loader2,
  Radio,
  ShieldCheck,
  Wifi,
} from "lucide-react";

/**
 * Live in-app TURN / STUN connectivity test.
 *
 * Runs entirely in the browser. It first does a combined gather (all servers),
 * then probes EACH transport in isolation (UDP:3478, TCP:3478, TCP:443) with a
 * forced-relay RTCPeerConnection so we can tell EXACTLY which path works on the
 * current network. On mobile/carrier networks UDP and non-443 TCP are commonly
 * blocked, so the TCP:443 row is the one that matters most.
 */

const FALLBACK_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type CandRow = {
  id: number;
  type: string; // host | srflx | prflx | relay
  protocol: string;
  address: string;
  port: number | null;
  related: string | null;
  raw: string;
};

type Phase = "idle" | "running" | "done" | "error";
type ProbeState = "idle" | "running" | "ok" | "fail";

type TransportProbe = {
  key: string;
  label: string;
  server: RTCIceServer | null;
  state: ProbeState;
  detail: string;
};

function typeMeta(type: string) {
  switch (type) {
    case "relay":
      return { label: "TURN relay", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" };
    case "srflx":
      return { label: "STUN reflexive", color: "bg-sky-500/15 text-sky-400 border-sky-500/30" };
    case "prflx":
      return { label: "Peer reflexive", color: "bg-violet-500/15 text-violet-400 border-violet-500/30" };
    case "host":
      return { label: "Host (local)", color: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" };
    default:
      return { label: type, color: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30" };
  }
}

// Human label for a single TURN ICE server entry based on its url.
function transportLabel(urls: string): string {
  if (urls.startsWith("stun:")) return "STUN " + urls.replace("stun:", "");
  const isTls = urls.startsWith("turns:");
  const proto = /transport=tcp/.test(urls) ? "TCP" : "UDP";
  const portMatch = urls.match(/:(\d+)\?/);
  const port = portMatch ? portMatch[1] : "?";
  return `${isTls ? "TURNS" : "TURN"} ${proto}:${port}`;
}

export default function TurnTest() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [cands, setCands] = useState<CandRow[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [iceServers, setIceServers] = useState<RTCIceServer[]>(FALLBACK_ICE);
  const [iceLoaded, setIceLoaded] = useState(false);
  const [probes, setProbes] = useState<TransportProbe[]>([]);
  const idRef = useRef(0);

  // Fetch fresh, server-issued time-limited TURN credentials (use-auth-secret).
  // The static long-term credentials no longer work because coturn runs in
  // use-auth-secret mode, so the page MUST get HMAC creds from the server.
  useEffect(() => {
    let alive = true;
    fetch("/api/relay/ice")
      .then((r) => r.json())
      .then((d) => {
        if (alive && Array.isArray(d?.iceServers) && d.iceServers.length) {
          setIceServers(d.iceServers as RTCIceServer[]);
        }
      })
      .catch(() => { /* keep STUN-only fallback */ })
      .finally(() => { if (alive) setIceLoaded(true); });
    return () => { alive = false; };
  }, []);

  const addLog = useCallback((line: string) => {
    const ts = new Date().toLocaleTimeString();
    setLog((l) => [...l, `${ts}  ${line}`]);
  }, []);

  const [relayOnly, setRelayOnly] = useState<ProbeState>("idle");

  const summary = useMemo(() => {
    const has = (t: string) => cands.some((c) => c.type === t);
    return {
      host: has("host"),
      srflx: has("srflx"),
      relay: has("relay"),
    };
  }, [cands]);

  // Probe a SINGLE ICE server with forced relay. Resolves true if a relay
  // candidate is gathered through that specific server within the timeout.
  const probeOne = useCallback(
    (server: RTCIceServer, label: string): Promise<{ ok: boolean; detail: string }> => {
      return new Promise((resolve) => {
        let pc: RTCPeerConnection;
        try {
          pc = new RTCPeerConnection({ iceServers: [server], iceTransportPolicy: "relay" });
        } catch (e) {
          resolve({ ok: false, detail: "pc error " + String(e) });
          return;
        }
        let settled = false;
        let relayAddr = "";
        const done = (ok: boolean, detail: string) => {
          if (settled) return;
          settled = true;
          try { pc.close(); } catch { /* noop */ }
          addLog(`[${label}] ${ok ? "RELAY OK " + relayAddr : "no relay (" + detail + ")"}`);
          resolve({ ok, detail });
        };
        pc.onicecandidate = (ev) => {
          if (ev.candidate && ev.candidate.candidate) {
            if (ev.candidate.type === "relay") {
              relayAddr = `${ev.candidate.address}:${ev.candidate.port ?? ""}`;
              done(true, relayAddr);
            }
          } else {
            done(false, "end-of-candidates");
          }
        };
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === "complete") done(false, "complete-no-relay");
        };
        try {
          pc.createDataChannel("probe");
          pc.createOffer().then((o) => pc.setLocalDescription(o)).catch((e) => done(false, "offer " + String(e)));
        } catch (e) {
          done(false, "start " + String(e));
        }
        window.setTimeout(() => done(false, "timeout-10s"), 10000);
      });
    },
    [addLog]
  );

  const runRelayOnly = useCallback(async (servers: RTCIceServer[]) => {
    setRelayOnly("running");
    addLog("[relay-only] forced-relay probe against ALL servers");
    const r = await new Promise<boolean>((resolve) => {
      let pc: RTCPeerConnection;
      try {
        pc = new RTCPeerConnection({ iceServers: servers, iceTransportPolicy: "relay" });
      } catch {
        resolve(false);
        return;
      }
      let got = false;
      let settled = false;
      const done = (ok: boolean, reason: string) => {
        if (settled) return;
        settled = true;
        addLog(`[relay-only] ${ok ? "RELAY OK" : "NO RELAY"} (${reason})`);
        try { pc.close(); } catch { /* noop */ }
        resolve(ok);
      };
      pc.onicecandidate = (ev) => {
        if (ev.candidate && ev.candidate.candidate) {
          if (ev.candidate.type === "relay") { got = true; done(true, "relay-candidate"); }
        } else {
          done(got, "end-of-candidates");
        }
      };
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === "complete") done(got, "state=complete");
      };
      try {
        pc.createDataChannel("relay-only");
        pc.createOffer().then((o) => pc.setLocalDescription(o)).catch((e) => done(false, "offer " + String(e)));
      } catch (e) {
        done(false, "start " + String(e));
      }
      window.setTimeout(() => done(got, "timeout-12s"), 12000);
    });
    setRelayOnly(r ? "ok" : "fail");
  }, [addLog]);

  const runTest = useCallback(async () => {
    const servers = iceServers;
    setPhase("running");
    setCands([]);
    setLog([]);
    setErrorMsg(null);
    idRef.current = 0;

    addLog(`Loaded ${servers.length} ICE servers from /api/relay/ice`);
    servers.forEach((s) => {
      const u = Array.isArray(s.urls) ? s.urls[0] : s.urls;
      addLog(`  • ${u}`);
    });

    // Build the per-transport probe list from the TURN servers only.
    const turnServers = servers.filter((s) => {
      const u = Array.isArray(s.urls) ? s.urls[0] : s.urls;
      return u.startsWith("turn:") || u.startsWith("turns:");
    });
    const initialProbes: TransportProbe[] = turnServers.map((s, i) => {
      const u = Array.isArray(s.urls) ? s.urls[0] : s.urls;
      return { key: "p" + i, label: transportLabel(u), server: s, state: "running", detail: "" };
    });
    setProbes(initialProbes);

    let pc: RTCPeerConnection;
    try {
      pc = new RTCPeerConnection({ iceServers: servers, iceCandidatePoolSize: 0 });
    } catch (e) {
      setErrorMsg("Your browser blocked RTCPeerConnection: " + String(e));
      setPhase("error");
      return;
    }

    addLog("Created RTCPeerConnection with all ICE servers");

    let settled = false;
    const settleOnce = (reason: string) => {
      if (settled) return;
      settled = true;
      addLog(`Gathering complete (${reason})`);
      try { pc.close(); } catch { /* noop */ }
      setPhase("done");
    };

    pc.onicecandidate = (ev) => {
      if (!ev.candidate || !ev.candidate.candidate) {
        settleOnce("end-of-candidates");
        return;
      }
      const c = ev.candidate;
      const row: CandRow = {
        id: idRef.current++,
        type: c.type ?? "unknown",
        protocol: (c.protocol ?? "").toUpperCase(),
        address: c.address ?? "(hidden)",
        port: c.port ?? null,
        related: c.relatedAddress ? `${c.relatedAddress}:${c.relatedPort ?? ""}` : null,
        raw: c.candidate,
      };
      setCands((prev) => [...prev, row]);
      addLog(`candidate: ${row.type} ${row.protocol} ${row.address}:${row.port ?? ""}`);
    };

    pc.onicegatheringstatechange = () => {
      addLog(`iceGatheringState = ${pc.iceGatheringState}`);
      if (pc.iceGatheringState === "complete") settleOnce("state=complete");
    };

    try {
      pc.createDataChannel("relay-turn-test");
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      addLog("Local description set — gathering candidates…");
    } catch (e) {
      setErrorMsg("Failed to start ICE gathering: " + String(e));
      setPhase("error");
      try { pc.close(); } catch { /* noop */ }
      return;
    }

    window.setTimeout(() => settleOnce("timeout-15s"), 15000);

    // Forced-relay against all servers (overall verdict).
    void runRelayOnly(servers);

    // Per-transport isolation probes — run sequentially so logs stay readable.
    for (const p of initialProbes) {
      if (!p.server) continue;
      const res = await probeOne(p.server, p.label);
      setProbes((prev) =>
        prev.map((x) => (x.key === p.key ? { ...x, state: res.ok ? "ok" : "fail", detail: res.detail } : x))
      );
    }
  }, [iceServers, addLog, runRelayOnly, probeOne]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container max-w-4xl py-8">
        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <Link href="/">
            <Button variant="outline" size="icon" className="bg-card/40">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">TURN server live test</h1>
            <p className="text-sm text-muted-foreground">
              Checks the RELAY coturn server on Northflank from your current network.
            </p>
          </div>
        </div>

        {/* Server card */}
        <Card className="mb-6 border-border/60 bg-card/40 p-5">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Radio className="h-4 w-4 text-emerald-400" />
            ICE servers in use
            {!iceLoaded && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            {iceServers.map((s, i) => {
              const u = Array.isArray(s.urls) ? s.urls[0] : s.urls;
              return (
                <div key={i} className="flex justify-between gap-4 rounded-md bg-background/40 px-3 py-2">
                  <span className="text-muted-foreground">{transportLabel(u)}</span>
                  <span className="font-mono text-xs">{u.replace(/^turns?:|^stun:/, "")}</span>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Run button + verdict */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Button
            onClick={runTest}
            disabled={phase === "running" || !iceLoaded}
            size="lg"
            className="gap-2"
          >
            {phase === "running" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Testing…
              </>
            ) : (
              <>
                <Wifi className="h-4 w-4" /> {iceLoaded ? "Run live test" : "Loading…"}
              </>
            )}
          </Button>

          {(phase === "done" || relayOnly === "ok" || relayOnly === "fail") && (
            <div
              className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium ${
                summary.relay || relayOnly === "ok"
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-400"
              }`}
            >
              {summary.relay || relayOnly === "ok" ? (
                <>
                  <ShieldCheck className="h-4 w-4" />
                  TURN works — relay candidate gathered
                </>
              ) : (
                <>
                  <XCircle className="h-4 w-4" />
                  No relay candidate (TURN not reachable on this network)
                </>
              )}
            </div>
          )}
        </div>

        {/* Per-transport probe results — the key diagnostic */}
        {probes.length > 0 && (
          <Card className="mb-6 overflow-hidden border-border/60 bg-card/40">
            <div className="border-b border-border/60 px-4 py-3 text-sm font-medium">
              Per-transport relay test
            </div>
            <div className="divide-y divide-border/40">
              {probes.map((p) => (
                <div key={p.key} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="flex items-center gap-3">
                    {p.state === "running" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    {p.state === "ok" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                    {p.state === "fail" && <XCircle className="h-4 w-4 text-amber-400" />}
                    {p.state === "idle" && <div className="h-4 w-4" />}
                    <span className="font-mono">{p.label}</span>
                  </div>
                  <span
                    className={`text-xs font-medium ${
                      p.state === "ok"
                        ? "text-emerald-400"
                        : p.state === "fail"
                        ? "text-amber-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {p.state === "running" ? "testing…" : p.state === "ok" ? "relay OK" : p.state === "fail" ? "blocked" : ""}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Verdict tiles */}
        {(phase === "done" || cands.length > 0) && (
          <div className="mb-6 grid grid-cols-3 gap-3">
            <VerdictTile ok={summary.host} title="Host" subtitle="Local candidates" />
            <VerdictTile ok={summary.srflx} title="STUN" subtitle="srflx (public IP)" />
            <VerdictTile ok={summary.relay || relayOnly === "ok"} title="TURN" subtitle="relay (media relay)" highlight />
          </div>
        )}

        {errorMsg && (
          <Card className="mb-6 border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {errorMsg}
          </Card>
        )}

        {/* Candidate table */}
        {cands.length > 0 && (
          <Card className="mb-6 overflow-hidden border-border/60 bg-card/40">
            <div className="border-b border-border/60 px-4 py-3 text-sm font-medium">
              ICE candidates ({cands.length})
            </div>
            <div className="divide-y divide-border/40">
              {cands.map((c) => {
                const meta = typeMeta(c.type);
                return (
                  <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                    <Badge variant="outline" className={`${meta.color} shrink-0`}>
                      {meta.label}
                    </Badge>
                    <span className="font-mono text-muted-foreground">{c.protocol}</span>
                    <span className="font-mono">
                      {c.address}:{c.port ?? ""}
                    </span>
                    {c.related && (
                      <span className="font-mono text-xs text-muted-foreground">
                        via {c.related}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Log */}
        {log.length > 0 && (
          <Card className="border-border/60 bg-card/40">
            <div className="border-b border-border/60 px-4 py-3 text-sm font-medium">Event log</div>
            <pre className="max-h-64 overflow-auto px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              {log.join("\n")}
            </pre>
          </Card>
        )}

        <p className="mt-6 text-xs text-muted-foreground">
          A <span className="font-mono text-emerald-400">relay</span> candidate means the TURN server
          accepted your credentials and allocated a media relay — calls will connect even behind
          strict NATs/firewalls. The <span className="font-mono">TURN TCP:443</span> row is the most
          important on mobile networks, since port 443 is almost never blocked.
        </p>
      </div>
    </div>
  );
}

function VerdictTile({
  ok,
  title,
  subtitle,
  highlight,
}: {
  ok: boolean;
  title: string;
  subtitle: string;
  highlight?: boolean;
}) {
  return (
    <Card
      className={`flex flex-col items-center gap-1 border p-4 text-center ${
        ok
          ? highlight
            ? "border-emerald-500/40 bg-emerald-500/10"
            : "border-sky-500/30 bg-sky-500/5"
          : "border-border/60 bg-card/30"
      }`}
    >
      {ok ? (
        <CheckCircle2 className={`h-6 w-6 ${highlight ? "text-emerald-400" : "text-sky-400"}`} />
      ) : (
        <XCircle className="h-6 w-6 text-muted-foreground/50" />
      )}
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-xs text-muted-foreground">{subtitle}</div>
    </Card>
  );
}
