# RELAY — self-hosted browser calling

Voice, video, and live chat in the browser. Pick a name, get a 6-digit number,
dial anyone's number. Up to **6 people** per call. Media is true peer-to-peer
(WebRTC mesh); your server only does call setup.

This is the **production** version: your own signaling server + your own TURN
relay + the front-end, all running on infrastructure you control. No third-party
calling service.

```
relay-server/
├── server.js            Node signaling + static web server (+ TURN credentials)
├── package.json
├── public/
│   ├── index.html       the RELAY UI
│   └── app.js           the client (native WebRTC mesh)
├── Dockerfile
├── docker-compose.yml   app + coturn (TURN) + Caddy (auto HTTPS), one command
├── Caddyfile
├── .env.example
├── coturn/
│   └── turnserver.conf  reference config for a non-Docker coturn install
└── README.md
```

---

## How it works (30-second tour)

1. The browser opens a WebSocket to `server.js` and registers a name. The server
   hands back a unique 6-digit number and a list of ICE servers (STUN + your TURN,
   with short-lived credentials).
2. To call someone you send their number; the server rings them.
3. On accept, the server tells the **newcomer** who is already in the call, and the
   newcomer sends a WebRTC offer to each of them. Only one side ever offers, so there
   are no connection collisions.
4. Audio/video/chat then flow **directly between browsers**. The server is no longer
   in the media path — that's what keeps latency low.
5. TURN is only used as a fallback to relay media when two browsers can't reach each
   other directly (strict corporate / some mobile networks).

---

## Why you need HTTPS and TURN

- **HTTPS / WSS** — browsers only grant camera & microphone access on a secure origin
  (`https://` or `localhost`). Opening the file directly (`file://`) or over plain
  `http://` from another machine will block the camera. The Docker setup uses Caddy to
  get you a free auto-renewing certificate.
- **TURN** — STUN alone connects on most home/office Wi-Fi, but ~10–20% of networks
  (symmetric NAT, restrictive firewalls, some carriers) need a relay. coturn is that
  relay. Without it, those users silently fail to connect.

---

## Option A — Run locally (quick test, no TURN)

Good for trying it on one machine or across devices on the same Wi-Fi.

```bash
cd relay-server
npm install
node server.js
```

Open **http://localhost:8080** in two tabs, register two names, dial one from the other.

> Across two *different* devices, `localhost` won't work and plain http blocks the
> camera. Use Option B (deploy) or put it behind any HTTPS tunnel
> (e.g. `ngrok http 8080`) and open the https URL it gives you.

---

## Option B — Production deploy with Docker (recommended)

You need: a small Linux server with a **public IP** (DigitalOcean, Hetzner, Linode,
AWS Lightsail, etc.), Docker + Docker Compose installed, and a **domain** with an
A-record pointing at the server (e.g. `relay.yourdomain.com`).

```bash
# 1. Put this folder on the server, then:
cd relay-server
cp .env.example .env

# 2. Edit .env:
#    DOMAIN=relay.yourdomain.com
#    TURN_SECRET=<paste output of: openssl rand -hex 32>
nano .env

# 3. Launch everything (app + TURN + HTTPS):
docker compose up -d --build

# 4. Watch logs (optional):
docker compose logs -f
```

Open **https://relay.yourdomain.com**. Share that link with anyone — different
cities, different networks — and you can call each other.

### Firewall ports to open on the server

| Port            | Proto    | Purpose                          |
|-----------------|----------|----------------------------------|
| 80, 443         | TCP      | Web + HTTPS (Caddy)              |
| 3478            | UDP+TCP  | STUN/TURN (coturn)              |
| 5349            | TCP      | TURN over TLS (coturn)          |
| 49152–65535     | UDP      | TURN media relay range          |

On most cloud providers you set these in the provider's firewall/security-group **and**
(if enabled) the OS firewall, e.g.:

```bash
sudo ufw allow 80,443/tcp
sudo ufw allow 3478
sudo ufw allow 5349/tcp
sudo ufw allow 49152:65535/udp
```

> If your server is behind NAT (its network interface shows a private IP, not the
> public one), add `--external-ip=YOUR_PUBLIC_IP` to the `coturn` command in
> `docker-compose.yml`.

---

## Option C — Production deploy without Docker

Run coturn and Node directly on a host.

**1) TURN (coturn):**
```bash
sudo apt update && sudo apt install coturn
sudo sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
sudo cp coturn/turnserver.conf /etc/turnserver.conf
# Edit /etc/turnserver.conf: set static-auth-secret (your TURN_SECRET) and realm (your domain)
sudo systemctl restart coturn
```

**2) App (Node):**
```bash
cd relay-server
npm install
TURN_SECRET=<same secret> TURN_HOST=relay.yourdomain.com PORT=8080 node server.js
# Use pm2 or a systemd unit to keep it running.
```

**3) HTTPS:** put Nginx or Caddy in front of the Node app on 443 and proxy to
`localhost:8080` (the proxy must allow WebSocket upgrades — Caddy does this
automatically; for Nginx add the `Upgrade`/`Connection` headers).

---

## Configuration (environment variables)

| Variable      | Required | Description                                                        |
|---------------|----------|--------------------------------------------------------------------|
| `PORT`        | no       | Port the Node server listens on (default `8080`).                  |
| `TURN_SECRET` | for TURN | Shared secret; **must equal** coturn's `static-auth-secret`.       |
| `TURN_HOST`   | for TURN | Hostname/IP of your coturn (usually your domain).                  |
| `TURN_TTL`    | no       | Lifetime of TURN credentials in seconds (default `3600`).          |

If `TURN_SECRET`/`TURN_HOST` are unset, the app runs STUN-only (works on most
networks; relay-needing users won't connect).

---

## Verifying TURN actually works

1. Open the app, start a call, and in Chrome go to `chrome://webrtc-internals`.
2. In the active connection, check the selected candidate pair. A `relay` candidate
   type means media is going through your TURN server.
3. Or test credentials directly at Trickle ICE
   (`https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/`):
   enter `turn:relay.yourdomain.com:3478`, plus a username/credential pair your
   server would issue, and confirm you get a `relay` candidate.

---

## Limits & notes

- **Mesh tops out around 6** because every participant sends their stream to every
  other participant (upload grows with group size). For larger rooms you'd move to an
  SFU (e.g. mediasoup, LiveKit, Janus) — a bigger project.
- **State is in-memory.** Restarting the server drops active calls and frees all
  numbers. That's fine for this scale; add Redis if you run multiple instances.
- **Numbers are ephemeral**, assigned on registration and released on disconnect.
- **Security:** the server validates message shape, scopes signaling to the addressed
  peer, and never trusts the client for room membership. Consider adding rate-limiting
  and an allowlist/auth layer before exposing it widely.

---

Built as a clean, self-contained reference. Swap the front-end, rebrand it, or drop the
signaling server into a larger app as you like.
