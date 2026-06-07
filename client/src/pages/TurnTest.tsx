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
 * Runs entirely in the browser: it spins up an RTCPeerConnection against the
 * RELAY coturn server on Northflank and watches which ICE candidates get
 * gathered. A `relay` candidate proves the TURN server is reachable AND
 * relaying for THIS browser on THIS network.
 */

const TURN_UDP_IP = "34.39.116.101";
const TURN_TCP_IP = "34.39.27.232";

// Fallback only (used if the /api/relay/ice fetch fails). STUN-only so the page
// still loads; the real probe always uses the server-issued, time-limited
// use-auth-secret credentials fetched at runtime.
const FALLBACK_ICE: RTCIceServer[] = [{ urls: `stun:${TURN_UDP_IP}:3478` }];

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

export default function TurnTest() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [cands, setCands] = useState<CandRow[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [iceServers, setIceServers] = useState<RTCIceServer[]>(FALLBACK_ICE);
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
      .catch(() => { /* keep STUN-only fallback */ });
    return () => { alive = false; };
  }, []);

  const addLog = useCallback((line: string) => {
    const ts = new Date().toLocaleTimeString();
    setLog((l) => [...l, `${ts}  ${line}`]);
  }, []);

  const [relayOnly, setRelayOnly] = useState<"idle" | "running" | "ok" | "fail">("idle");

  const summary = useMemo(() => {
    const has = (t: string) => cands.some((c) => c.type === t);
    return {
      host: has("host"),
      srflx: has("srflx"),
      relay: has("relay"),
    };
  }, [cands]);

  // Forced-relay probe: iceTransportPolicy 'relay' means the browser will ONLY
  // gather relay candidates, so any candidate at all == TURN works.
  const runRelayOnly = useCallback(async () => {
    setRelayOnly("running");
    addLog("[relay-only] starting forced-relay probe (iceTransportPolicy: relay)");
    let pc: RTCPeerConnection;
    try {
      pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: "relay" });
    } catch (e) {
      addLog("[relay-only] failed to create pc: " + String(e));
      setRelayOnly("fail");
      return;
    }
    let got = false;
    let settled = false;
    const done = (ok: boolean, reason: string) => {
      if (settled) return;
      settled = true;
      addLog(`[relay-only] ${ok ? "RELAY OK" : "NO RELAY"} (${reason})`);
      setRelayOnly(ok ? "ok" : "fail");
      try {
        pc.close();
      } catch {
        /* noop */
      }
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate && ev.candidate.candidate) {
        got = true;
        addLog(`[relay-only] candidate: ${ev.candidate.type} ${ev.candidate.protocol} ${ev.candidate.address}:${ev.candidate.port ?? ""}`);
      } else {
        done(got, "end-of-candidates");
      }
    };
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") done(got, "state=complete");
    };
    try {
      pc.createDataChannel("relay-only");
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
    } catch (e) {
      done(false, "offer-error " + String(e));
      return;
    }
    window.setTimeout(() => done(got, "timeout-12s"), 12000);
  }, [addLog]);

  const runTest = useCallback(async () => {
    setPhase("running");
    setCands([]);
    setLog([]);
    setErrorMsg(null);
    idRef.current = 0;

    let pc: RTCPeerConnection;
    try {
      pc = new RTCPeerConnection({
        iceServers,
        iceCandidatePoolSize: 0,
      });
    } catch (e) {
      setErrorMsg("Your browser blocked RTCPeerConnection: " + String(e));
      setPhase("error");
      return;
    }

    addLog("Created RTCPeerConnection with RELAY ICE servers");

    const finish = (reason: string) => {
      addLog(`Gathering complete (${reason})`);
      try {
        pc.close();
      } catch {
        /* noop */
      }
      setPhase("done");
    };

    let settled = false;
    const settleOnce = (reason: string) => {
      if (settled) return;
      settled = true;
      finish(reason);
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
      // A data channel is enough to trigger ICE gathering without media perms.
      pc.createDataChannel("relay-turn-test");
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      addLog("Local description set — gathering candidates…");
    } catch (e) {
      setErrorMsg("Failed to start ICE gathering: " + String(e));
      setPhase("error");
      try {
        pc.close();
      } catch {
        /* noop */
      }
      return;
    }

    // Safety timeout in case the browser never emits the null candidate.
    window.setTimeout(() => settleOnce("timeout-12s"), 12000);

    // Also kick off the stricter forced-relay probe in parallel.
    void runRelayOnly();
  }, [addLog, runRelayOnly]);

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
            Target server
          </div>
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-4 rounded-md bg-background/40 px-3 py-2">
              <span className="text-muted-foreground">STUN / TURN (UDP)</span>
              <span className="font-mono">{TURN_UDP_IP}:3478</span>
            </div>
            <div className="flex justify-between gap-4 rounded-md bg-background/40 px-3 py-2">
              <span className="text-muted-foreground">TURN (TCP 443)</span>
              <span className="font-mono">{TURN_TCP_IP}:443</span>
            </div>
            <div className="flex justify-between gap-4 rounded-md bg-background/40 px-3 py-2">
              <span className="text-muted-foreground">Realm</span>
              <span className="font-mono">relay.turn</span>
            </div>
            <div className="flex justify-between gap-4 rounded-md bg-background/40 px-3 py-2">
              <span className="text-muted-foreground">Credentials</span>
              <span className="font-mono">{iceServers.length} server (live)</span>
            </div>
          </div>
        </Card>

        {/* Run button + verdict */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Button
            onClick={runTest}
            disabled={phase === "running"}
            size="lg"
            className="gap-2"
          >
            {phase === "running" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Gathering candidates…
              </>
            ) : (
              <>
                <Wifi className="h-4 w-4" /> Run live test
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
          strict NATs/firewalls. If you only see <span className="font-mono">host</span> and{" "}
          <span className="font-mono">srflx</span>, your network may be blocking the TURN ports.
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
