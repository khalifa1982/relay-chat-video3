/**
 * SERVER-SIDE CRASH-STACK DECODING (v2.107.28)
 *
 * The build emits HIDDEN sourcemaps (dist/public/assets/*.js.map): the bundles
 * carry no sourceMappingURL pointer and static.ts refuses .map over HTTP, so
 * visitors can never fetch them. Their ONE reader is this module: recordCrash
 * calls it to append a human-readable translation under each minified stack,
 * so crash rows arrive already pointing at real files, lines and functions.
 *
 * The crash fingerprint is computed BEFORE the translation is appended —
 * grouping and storm-collapse behave exactly as they did without this feature.
 *
 * FAILS OPEN EVERYWHERE. Any miss — map not on disk (a stale tab from an older
 * release), a parse error, an out-of-range position — yields no translation;
 * the raw stack is stored either way. Decoding is decorative, never load-bearing.
 */
import fs from "fs";
import path from "path";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64IDX: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) B64IDX[B64[i]] = i;

/** One absolute mapping: [generatedCol0, sourceIdx, sourceLine0, sourceCol0, nameIdx(-1 = none)] */
type Seg = [number, number, number, number, number];
type ParsedMap = { sources: string[]; names: string[]; lines: Seg[][] };

/** Parsed maps are a few MB each; two or three bundles are live at once
 *  (current release + the preserved previous one), so a tiny FIFO cache is
 *  plenty. `null` entries cache misses too — a stale tab must not re-stat the
 *  disk on every report of the same dead bundle. */
const cache = new Map<string, ParsedMap | null>();
const CACHE_MAX = 4;

function distDir(): string {
  // Bundled server runs from dist/ (so `dist/public`); dev/tsx runs from server/
  // (so `../dist/public`). v2.107.43: try the env-implied path FIRST, then fall
  // back to the other — because a wrong or unset NODE_ENV used to make every map
  // read miss silently, turning symbolication off with no error and no test to
  // notice. The maps are in exactly one of these two places; we check both
  // rather than trust the environment to be labelled correctly.
  const bundled = path.resolve(import.meta.dirname, "public");
  const dev = path.resolve(import.meta.dirname, "..", "dist", "public");
  const primary = process.env.NODE_ENV === "development" ? dev : bundled;
  const secondary = primary === dev ? bundled : dev;
  try {
    if (fs.existsSync(path.join(primary, "assets"))) return primary;
    if (fs.existsSync(path.join(secondary, "assets"))) return secondary;
  } catch {
    /* fall through to primary */
  }
  return primary;
}

function parseMap(file: string): ParsedMap | null {
  if (cache.has(file)) return cache.get(file) ?? null;
  let parsed: ParsedMap | null = null;
  try {
    // `file` must be a bare filename — anything else is a traversal attempt.
    if (/^[A-Za-z0-9_.-]+$/.test(file)) {
      const mapPath = path.join(distDir(), "assets", file + ".map");
      if (fs.existsSync(mapPath)) {
        const m = JSON.parse(fs.readFileSync(mapPath, "utf8")) as {
          sources?: unknown;
          names?: unknown;
          mappings?: unknown;
        };
        if (typeof m.mappings === "string" && Array.isArray(m.sources)) {
          const lines: Seg[][] = [];
          let srcIdx = 0;
          let srcLine = 0;
          let srcCol = 0;
          let nameIdx = 0;
          for (const lineStr of m.mappings.split(";")) {
            const segs: Seg[] = [];
            let genCol = 0;
            if (lineStr) {
              for (const segStr of lineStr.split(",")) {
                const fields: number[] = [];
                let shift = 0;
                let val = 0;
                let bad = false;
                for (let i = 0; i < segStr.length; i++) {
                  const d = B64IDX[segStr[i]];
                  if (d === undefined) {
                    bad = true;
                    break;
                  }
                  val += (d & 31) << shift;
                  if (d & 32) {
                    shift += 5;
                  } else {
                    fields.push(val & 1 ? -(val >>> 1) : val >>> 1);
                    val = 0;
                    shift = 0;
                  }
                }
                if (bad || fields.length === 0) continue;
                genCol += fields[0];
                if (fields.length >= 4) {
                  srcIdx += fields[1];
                  srcLine += fields[2];
                  srcCol += fields[3];
                  let n = -1;
                  if (fields.length >= 5) {
                    nameIdx += fields[4];
                    n = nameIdx;
                  }
                  segs.push([genCol, srcIdx, srcLine, srcCol, n]);
                }
              }
            }
            lines.push(segs);
          }
          parsed = {
            sources: (m.sources as unknown[]).map(String),
            names: Array.isArray(m.names) ? (m.names as unknown[]).map(String) : [],
            lines,
          };
        }
      }
    }
  } catch {
    parsed = null;
  }
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(file, parsed);
  return parsed;
}

function lookup(pm: ParsedMap, line1: number, col1: number): string | null {
  const segs = pm.lines[line1 - 1];
  if (!segs || segs.length === 0) return null;
  const target = col1 - 1; // stacks are 1-based, map columns 0-based
  let lo = 0;
  let hi = segs.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid][0] <= target) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best < 0) return null;
  const [, si, sl, sc, ni] = segs[best];
  const src = (pm.sources[si] ?? "?").replace(/^(?:\.\.\/)+/, "").replace(/^\.\//, "");
  const nm = ni >= 0 && ni < pm.names.length ? pm.names[ni] : null;
  return `${src}:${sl + 1}:${sc + 1}${nm ? ` (${nm})` : ""}`;
}

const FRAME_RE = /\/assets\/([A-Za-z0-9_.-]+?\.js):(\d+):(\d+)/;

/** Translate every /assets/*.js frame the map can resolve. Returns the marked
 *  block to append under the raw stack, or null when nothing decoded. */
export function decodeCrashStack(stack: string): string | null {
  try {
    const out: string[] = [];
    let hits = 0;
    for (const raw of stack.split("\n").slice(0, 30)) {
      const m = FRAME_RE.exec(raw);
      if (!m) continue;
      const pm = parseMap(m[1]);
      const pos = pm ? lookup(pm, Number(m[2]), Number(m[3])) : null;
      if (pos) {
        out.push("    at " + pos);
        hits++;
      } else {
        out.push(`    at ? (${m[1]}:${m[2]}:${m[3]})`);
      }
      if (out.length >= 20) break;
    }
    return hits > 0 ? "\u2500\u2500 decoded \u2500\u2500\n" + out.join("\n") : null;
  } catch {
    return null;
  }
}
