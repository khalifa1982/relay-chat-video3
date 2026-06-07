# RELAY TURN server — coturn on Northflank

This is the relay server that lets two people on different networks actually
connect a call. Without it, cross-NAT WebRTC calls drop after a few seconds
(the symptom you saw). Follow this once; after that the web app just works.

---

## 0. The shared secret (already generated for you)

coturn and the web app authenticate with the **same** shared secret
(coturn `use-auth-secret` / "TURN REST API" flow). Use this exact value in
**both** places:

```
TURN_SECRET = ef477ea706b035aed42ad2f4d60aa23fcb3b03095859c79d0ed15dbc0219f85d
```

I will set this same value as a secret on the web app. You set it on coturn
(step 2 below). They must match character-for-character.

---

## 1. Create the coturn service on Northflank

1. Open your project: https://app.northflank.com/t/khalifas-team/project/kv2
   (or whichever project you want it in).
2. **Add new → Service → Deployment.**
3. **Source: External image.** Image:
   ```
   coturn/coturn:4.6.2
   ```
4. **Networking / Ports** — this is the important part. TURN needs UDP to be
   reliable. Add these ports as **Public** and set the protocol correctly:

   | Port  | Protocol | Purpose                                  |
   |-------|----------|------------------------------------------|
   | 3478  | UDP      | TURN/STUN over UDP (primary, best)       |
   | 3478  | TCP      | TURN/STUN over TCP (fallback)            |
   | 5349  | TCP      | TURN over TLS (TURNS, firewall-friendly) |
   | 49160–49200 | UDP | relay media port range (see note)     |

   - If Northflank's plan won't let you expose **UDP**, expose at least
     **3478/TCP** and **5349/TCP**. Calls will still work over TCP/TLS, just
     with a bit more latency. (The web app already lists turn/tcp + turns.)
   - The relay port range (`49160–49200`) is where the actual media flows. If
     Northflank only gives you a single fixed port mapping and no range, set
     `min-port`/`max-port` in the config below to a small range it allows, or
     remove those two lines and coturn will use its default ephemeral range
     (works when the platform passes UDP through 1:1, which Northflank does for
     raw UDP services).

5. **Resources:** the smallest plan is fine (TURN is light on CPU; it's just
   forwarding packets). 0.1 vCPU / 256 MB is enough to start.

---

## 2. coturn configuration

Northflank lets you either pass a command or mount a config file. Easiest is to
override the **command/args** so coturn runs with the right flags. Use this as
the container **Command** (one line) — replace `RELAY_REALM` if you like, it's
just a label:

```
turnserver -n --use-auth-secret --static-auth-secret=ef477ea706b035aed42ad2f4d60aa23fcb3b03095859c79d0ed15dbc0219f85d --realm=relay --no-cli --no-tlsv1 --no-tlsv1_1 --min-port=49160 --max-port=49200 --log-file=stdout --fingerprint --lt-cred-mech
```

Notes:
- `--use-auth-secret` + `--static-auth-secret=…` is the time-limited credential
  mode. The web app generates `username = <expiry>:<userid>` and
  `credential = base64(HMAC-SHA1(secret, username))` — coturn validates it with
  the same secret. No per-user accounts to manage.
- `--realm=relay` must be a non-empty realm; the value itself is arbitrary.
- If you could NOT expose the `49160–49200` UDP range in step 1, delete the
  `--min-port`/`--max-port` flags.

If you prefer a mounted `turnserver.conf` file instead of CLI flags, the
equivalent is:

```
listening-port=3478
tls-listening-port=5349
use-auth-secret
static-auth-secret=ef477ea706b035aed42ad2f4d60aa23fcb3b03095859c79d0ed15dbc0219f85d
realm=relay
no-cli
no-tlsv1
no-tlsv1_1
min-port=49160
max-port=49200
fingerprint
lt-cred-mech
log-file=stdout
```

---

## 3. Deploy, then send me the host

1. Deploy the service.
2. In the service's **Networking** tab, Northflank shows a **public DNS / domain**
   for the exposed ports (something like `turn-relay--kv2--abcd.code.run` or a
   raw IP). That hostname (WITHOUT any `https://` and WITHOUT a port) is your
   `TURN_HOST`.
3. Send me that hostname. I will set:
   - `TURN_HOST = <that hostname>`
   - `TURN_SECRET = ef477ea706b035aed42ad2f4d60aa23fcb3b03095859c79d0ed15dbc0219f85d`
   on the web app, then re-publish.

---

## 4. How we'll verify it actually works

Once TURN_HOST is set and the app re-published, the in-app **diagnostics
overlay** (tap the `?` / diagnostics button on the call screen) will list the
ICE servers. You should see `turn:<your-host>:3478` entries with credentials,
and during a call the connection should reach `connected` and **stay** there
even when the two devices are on different networks.

We can also confirm relay candidates appear: in the diagnostics log you'll see
candidate lines containing `typ relay` — that's proof the TURN server is being
used.

---

## TL;DR for you
1. Deploy `coturn/coturn:4.6.2` on Northflank with ports 3478/udp, 3478/tcp,
   5349/tcp (+ UDP range 49160–49200 if allowed).
2. Command: the `turnserver …` line in step 2.
3. Send me the public hostname Northflank gives it.
4. I wire it into the app and re-publish.
