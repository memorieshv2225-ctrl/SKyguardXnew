import {
  enrichAlertCoords,
  getSimulatedPosition,
  needsGpsSimulation,
  LANDMARK,
} from "./gpsSim.js";
import {
  startServerCountdown,
  cancelServerCountdown,
  clearServerCountdown,
  getActiveCountdownTracker,
} from "./countdownTracker.js";
import { classifyFromTracker, classifyFromSnapshot } from "./alertContext.js";

let lastStatus = "";
let lastEventId = 0;
let alertCycle = 0;
let lastCountdown = -1;
let cycleAlertSent = false;
const notifiedKeys = new Set();

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function pushEntry(history, entry) {
  if (entry.sessionKey && history.some((h) => h.sessionKey === entry.sessionKey)) {
    return;
  }
  history.unshift(entry);
  if (history.length > 50) history.pop();
}

function baseRecord(data, overrides = {}) {
  const pos = getSimulatedPosition(data);
  return {
    id: overrides.id ?? makeId(),
    utc: overrides.utc ?? data.utc ?? nowIso(),
    lat: overrides.lat ?? pos.lat,
    lon: overrides.lon ?? pos.lon,
    speed: overrides.speed ?? pos.speed ?? 0,
    gforce: overrides.gforce ?? data.gforce,
    angle: overrides.angle ?? data.tilt,
    alertType: overrides.alertType ?? "CRASH",
    landmark: LANDMARK,
    locationSimulated: true,
    receivedAt: nowIso(),
    mapsUrl: `https://maps.google.com/?q=${pos.lat},${pos.lon}`,
    cycle: overrides.cycle ?? alertCycle,
    ...overrides,
  };
}

async function notifyOnce(key, record, onAlertSent) {
  if (notifiedKeys.has(key)) return false;
  notifiedKeys.add(key);
  if (notifiedKeys.size > 100) {
    notifiedKeys.delete(notifiedKeys.values().next().value);
  }
  if (onAlertSent) await onAlertSent(record);
  return true;
}

function resolveClassification(data, extra = {}) {
  const tracker = extra.tracker || getActiveCountdownTracker();
  const pos = getSimulatedPosition(data);

  if (tracker) {
    if (extra.helmetDisconnectedMid) tracker.helmetDisconnectedMid = true;
    return classifyFromTracker(tracker, pos);
  }

  return classifyFromSnapshot(
    { ...data, helmetDisconnectedMid: extra.helmetDisconnectedMid },
    pos
  );
}

/** 20s countdown finished — send WhatsApp and mark history as ALERT SENT. */
async function finishCountdownAlert(data, history, onAlertSent, extra = {}) {
  if (cycleAlertSent) return;
  cycleAlertSent = true;

  const classification = resolveClassification(data, extra);
  clearServerCountdown();

  const pos = getSimulatedPosition(data);
  const pendingKey = `cycle-${alertCycle}-pending`;
  const pending = history.find((h) => h.sessionKey === pendingKey);
  if (pending) {
    pending.status = "ALERT SENT";
    pending.driverResponse = classification.category;
    pending.lat = pos.lat;
    pending.lon = pos.lon;
    pending.mapsUrl = `https://maps.google.com/?q=${pos.lat},${pos.lon}`;
    pending.riskScore = classification.riskScore;
  }

  const record = baseRecord(data, {
    sessionKey: `cycle-${alertCycle}-sent`,
    status: "ALERT SENT",
    driverResponse: classification.category,
    classification,
    riskScore: classification.riskScore,
    alertCategory: classification.category,
  });
  pushEntry(history, record);
  await notifyOnce(`notify-cycle-${alertCycle}`, record, onAlertSent);
}

/** Called when server-side timer hits 0 (e.g. transmitter was offline). */
export async function finishCountdownFromServer(
  snapshot,
  history,
  onAlertSent,
  helmetDisconnectedMid,
  tracker
) {
  const data = snapshot || {};
  if (tracker && helmetDisconnectedMid) tracker.helmetDisconnectedMid = true;
  await finishCountdownAlert(data, history, onAlertSent, {
    helmetDisconnectedMid: !!helmetDisconnectedMid,
    tracker,
  });
}

function syncEspHistory(history, espList, data) {
  for (const esp of espList || []) {
    const enriched = enrichAlertCoords(esp, getSimulatedPosition(data));
    const sessionKey = `device-${enriched.id}`;
    if (history.some((h) => h.sessionKey === sessionKey)) continue;

    pushEntry(history, {
      ...enriched,
      sessionKey,
      receivedAt: nowIso(),
      mapsUrl: `https://maps.google.com/?q=${enriched.lat},${enriched.lon}`,
      source: "device",
      status: enriched.status || "ALERT SENT",
      driverResponse: enriched.driverResponse || "NO_RESPONSE",
    });
  }
}

function countdownExpired(data, status) {
  const cd = Number(data.countdown ?? -1);
  if (status === "PENDING" && cd === 0) return true;
  if (lastCountdown > 0 && cd === 0) return true;
  return false;
}

export async function processAlertState(data, history, onAlertSent) {
  if (!data) return;

  const status = data._rawAlertStatus ?? data.alertStatus ?? "CLEAR";
  const cd = Number(data.countdown ?? -1);

  syncEspHistory(history, data.alertHistory, data);

  if (status === "PENDING" && lastStatus !== "PENDING") {
    alertCycle += 1;
    cycleAlertSent = false;
    lastCountdown = cd >= 0 ? cd : 20;
    startServerCountdown(alertCycle, data);
    pushEntry(
      history,
      baseRecord(data, {
        sessionKey: `cycle-${alertCycle}-pending`,
        status: "PENDING",
        driverResponse: "COUNTDOWN",
      })
    );
  }

  if (status === "CANCELLED" && lastStatus !== "CANCELLED") {
    cycleAlertSent = true;
    cancelServerCountdown();
    pushEntry(
      history,
      baseRecord(data, {
        sessionKey: `cycle-${alertCycle}-cancelled`,
        status: "CANCELLED",
        driverResponse: "OK PRESSED",
      })
    );
  }

  const countdownDone =
    !cycleAlertSent &&
    (countdownExpired(data, status) ||
      (status === "GPS REQUIRED" && (lastStatus === "PENDING" || lastCountdown > 0)) ||
      (lastStatus === "PENDING" && status !== "PENDING" && status !== "CANCELLED"));

  if (countdownDone && status !== "CANCELLED") {
    await finishCountdownAlert(data, history, onAlertSent);
  }

  if (data.alertEventId && data.alertEventId > lastEventId) {
    const newAlerts = (data.alertHistory || []).filter((a) => a.id > lastEventId);
    for (const a of newAlerts) {
      const withGps = enrichAlertCoords(a, getSimulatedPosition(data));
      const record = {
        ...withGps,
        sessionKey: `device-${withGps.id}`,
        receivedAt: nowIso(),
        mapsUrl: `https://maps.google.com/?q=${withGps.lat},${withGps.lon}`,
        status: withGps.status || "ALERT SENT",
        driverResponse: withGps.driverResponse || "NOTIFY SENT",
        source: "device",
        cycle: alertCycle,
      };
      pushEntry(history, record);
      if (!cycleAlertSent) {
        await notifyOnce(`notify-device-${withGps.id}`, record, onAlertSent);
        cycleAlertSent = true;
      }
    }
    lastEventId = data.alertEventId;
  }

  if (status === "CLEAR" && lastStatus !== "CLEAR") {
    cycleAlertSent = false;
    lastCountdown = -1;
  }

  if (cd >= 0) lastCountdown = cd;
  lastStatus = status;
}

export function resetAlertTracker() {
  lastStatus = "";
  lastEventId = 0;
  alertCycle = 0;
  lastCountdown = -1;
  cycleAlertSent = false;
  notifiedKeys.clear();
}
