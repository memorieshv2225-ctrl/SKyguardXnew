/** Server-side 20s countdown — keeps running if transmitter disconnects. */

import { isMoving } from "./alertContext.js";

const COUNTDOWN_SEC = Number(process.env.COUNTDOWN_SEC || 20);
const FINAL_WINDOW_SEC = 5;
/** Consecutive off polls before treating helmet as removed (~3s at 500ms). */
const NOT_WORN_STREAK_THRESHOLD = 6;

let active = null;

/**
 * Helmet worn for alerts: touch can open briefly when tilted.
 * Require sustained "off" in the final window before NO_HELMET.
 */
export function deriveHelmetWorn(tracker) {
  if (!tracker) return false;
  if (!tracker.everWorn) return false;

  const samples = tracker.final5sSamples || [];
  if (samples.length >= 3 && tracker.everNotWorn) {
    const wornInFinal = samples.filter((s) => s.worn).length;
    if (wornInFinal === 0) return false;
  }

  return true;
}

export function startServerCountdown(cycle, snapshot) {
  active = {
    cycle,
    startedAt: Date.now(),
    durationSec: COUNTDOWN_SEC,
    snapshot: snapshot ? { ...snapshot } : {},
    helmetDisconnectedMid: false,
    cancelled: false,
    expiredHandled: false,
    everWorn: !!snapshot?.worn,
    everNotWorn: false,
    notWornStreak: snapshot?.worn ? 0 : 1,
    maxTilt: Number(snapshot?.tilt ?? snapshot?.angle ?? 0),
    final5sSamples: [],
    final5sHadMovement: false,
    final5sHadWorn: false,
  };
}

export function recordCountdownSample(data) {
  if (!active || active.cancelled || active.expiredHandled) return;

  const elapsed = (Date.now() - active.startedAt) / 1000;
  const touchWorn =
    data?.wornTouchRaw !== undefined ? !!data.wornTouchRaw : !!data?.worn;
  const worn = !!data?.worn;
  const tilt = Number(data?.tilt ?? data?.angle ?? 0);
  const moving = isMoving(data || {});

  if (touchWorn) {
    active.everWorn = true;
    active.notWornStreak = 0;
  } else if (active.everWorn) {
    active.notWornStreak = (active.notWornStreak || 0) + 1;
    if (active.notWornStreak >= NOT_WORN_STREAK_THRESHOLD) {
      active.everNotWorn = true;
    }
  }

  active.maxTilt = Math.max(active.maxTilt ?? 0, tilt);
  active.snapshot = { ...active.snapshot, ...data };

  if (elapsed >= active.durationSec - FINAL_WINDOW_SEC) {
    active.final5sSamples.push({ worn: touchWorn, tilt, moving, elapsed });
    if (moving) active.final5sHadMovement = true;
    if (touchWorn) active.final5sHadWorn = true;
  }
}

export function cancelServerCountdown() {
  if (active) active.cancelled = true;
  active = null;
}

export function clearServerCountdown() {
  active = null;
}

export function markHelmetDisconnected() {
  if (active && !active.cancelled) {
    active.helmetDisconnectedMid = true;
  }
}

export function isServerCountdownRunning() {
  return !!(active && !active.cancelled && !active.expiredHandled);
}

export function getActiveCountdownTracker() {
  return active && !active.cancelled ? active : null;
}

function remainingSec() {
  if (!active || active.cancelled) return 0;
  const elapsed = (Date.now() - active.startedAt) / 1000;
  return Math.max(0, Math.ceil(active.durationSec - elapsed));
}

export function tickServerCountdown() {
  if (!active || active.cancelled || active.expiredHandled) return null;

  const remaining = remainingSec();
  if (remaining > 0) return { justExpired: false, remaining };

  active.expiredHandled = true;
  return {
    justExpired: true,
    remaining: 0,
    snapshot: active.snapshot,
    helmetDisconnectedMid: active.helmetDisconnectedMid,
    cycle: active.cycle,
    tracker: active,
  };
}

export function overlayServerCountdown(data, transmitterOnline) {
  if (!active || active.cancelled) return data;

  if (!transmitterOnline) markHelmetDisconnected();
  if (data) recordCountdownSample(data);

  const remaining = remainingSec();
  const base = data || active.snapshot || {};

  const inferredWorn = deriveHelmetWorn(active) || !!base.worn;

  return {
    ...base,
    worn: inferredWorn,
    wornTouchRaw: !!base.worn,
    serverCountdownActive: true,
    serverCountdown: remaining,
    countdown: remaining,
    mode: "FAST",
    alertStatus: remaining > 0 ? "PENDING" : base.alertStatus || "PENDING",
    helmetDisconnectedMid: active.helmetDisconnectedMid,
    transmitterOfflineDuringCountdown: !transmitterOnline,
  };
}

export function getCountdownSec() {
  return COUNTDOWN_SEC;
}
