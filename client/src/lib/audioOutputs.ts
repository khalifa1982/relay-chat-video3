/* Pure logic for the in-call audio-output picker. Kept DOM-free so the row
 * generation, the "Automatic" de-dup, and the stale-device validation are
 * unit-testable without a browser. */

export interface AudioOutRow {
  /** "" = Automatic (system default); otherwise a real audiooutput deviceId. */
  id: string;
  label: string;
  selected: boolean;
}

export interface AudioOutList {
  rows: AudioOutRow[];
  /** Friendly label of the active output (for the button tooltip). */
  currentLabel: string;
  /** The sink that should actually be applied: the requested one if it still
   *  exists, else "" (Automatic). Prevents pinning to an unplugged device. */
  validSink: string;
}

interface DeviceLike {
  kind: string;
  deviceId: string;
  label: string;
}

/**
 * Build the output-picker rows from enumerateDevices(), validating the
 * currently-requested sink against what actually exists.
 *
 * - Always emits a single synthetic "Automatic (system default)" row (id "").
 * - DROPS the platform "default" pseudo-device row (Chrome exposes one) so the
 *   user isn't offered two confusingly-similar defaults.
 * - If `requestedSink` no longer exists (e.g. a Bluetooth headset that
 *   disconnected, or a stale persisted id), falls back to "" so the UI never
 *   shows a phantom selection.
 */
export function buildAudioOutputList(
  devices: DeviceLike[],
  requestedSink: string,
): AudioOutList {
  const outs = devices.filter((d) => d.kind === "audiooutput" && d.deviceId && d.deviceId !== "default");
  const exists = requestedSink === "" || outs.some((d) => d.deviceId === requestedSink);
  const validSink = exists ? requestedSink : "";

  const rows: AudioOutRow[] = [
    { id: "", label: "Automatic (system default)", selected: validSink === "" },
  ];
  let currentLabel = "Automatic";
  outs.forEach((d, i) => {
    const label = d.label || "Output " + (i + 1);
    const selected = d.deviceId === validSink;
    if (selected) currentLabel = label;
    rows.push({ id: d.deviceId, label, selected });
  });
  return { rows, currentLabel, validSink };
}
