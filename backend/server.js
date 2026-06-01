import "dotenv/config";
import express from "express";
import cors from "cors";
import {
  sendEmergencyNotifications,
  sendTestWhatsAppAlert,
  isNotifyConfigured,
} from "./notify.js";
import { applyGpsSimulation } from "./gpsSim.js";
import { processAlertState, finishCountdownFromServer } from "./alertTracker.js";
import {
  tickServerCountdown,
  overlayServerCountdown,
  isServerCountdownRunning,
  markHelmetDisconnected,
  recordCountdownSample,
} from "./countdownTracker.js";

const ESP32_URL = process.env.ESP32_URL || "http://10.138.165.36/data";
const POLL_MS = 500;
const PORT = Number(process.env.PORT || 3001);

const app = express();
const FRONTEND_URL = process.env.FRONTEND_URL;
app.use(
  cors(
    FRONTEND_URL
      ? { origin: FRONTEND_URL, credentials: true }
      : { origin: true }
  )
);

let latest = null;
let lastFetchOk = false;
let lastFetchAt = null;
let lastError = null;
/** Debounce touch flicker when helmet tilts (TTP223 opens briefly). */
let wornLatch = false;
let wornOffStreak = 0;
const WORN_OFF_STREAK = 6;

function applyWornLatch(data) {
  if (!data) return data;
  const touchWorn = !!data.worn;
  if (touchWorn) {
    wornLatch = true;
    wornOffStreak = 0;
  } else if (wornLatch) {
    wornOffStreak += 1;
    if (wornOffStreak >= WORN_OFF_STREAK) wornLatch = false;
  }
  return { ...data, worn: wornLatch || touchWorn, wornTouchRaw: touchWorn };
}
const alertHistory = [];
const notifyLog = [];

async function pollEsp32() {
  try {
    const res = await fetch(ESP32_URL, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = applyWornLatch(applyGpsSimulation(await res.json()));
    if (isServerCountdownRunning()) recordCountdownSample(data);
    latest = data;
    lastFetchOk = true;
    lastFetchAt = new Date().toISOString();
    lastError = null;

    await processAlertState(data, alertHistory, onAlertNotify);
  } catch (err) {
    lastFetchOk = false;
    lastError = err.message;
    if (isServerCountdownRunning()) markHelmetDisconnected();
  }
}

async function onAlertNotify(record) {
  const notifyResult = await sendEmergencyNotifications({
    lat: record.lat,
    lon: record.lon,
    speed: record.speed,
    utc: record.utc,
    gforce: record.gforce,
    worn: record.worn,
    tilt: record.tilt ?? record.angle,
    vibration: record.vibration,
    classification: record.classification,
    countdownTracker: record.countdownTracker,
  });
  notifyLog.unshift({
    alertId: record.id,
    cycle: record.cycle,
    at: record.receivedAt,
    result: notifyResult,
  });
  if (notifyLog.length > 20) notifyLog.pop();
}

setInterval(pollEsp32, POLL_MS);
pollEsp32();

setInterval(async () => {
  const tick = tickServerCountdown();
  if (tick?.justExpired) {
    await finishCountdownFromServer(
      applyGpsSimulation(tick.snapshot),
      alertHistory,
      onAlertNotify,
      tick.helmetDisconnectedMid,
      tick.tracker
    );
  }
}, 500);

function buildLiveData() {
  const base = latest ? applyGpsSimulation(latest) : null;
  return overlayServerCountdown(base, lastFetchOk);
}

app.get("/api/status", (_req, res) => {
  res.json({
    ok: true,
    service: "SkyGuardX helmet backend",
    transmitterConnected: lastFetchOk,
    twilioConfigured: isNotifyConfigured(),
    esp32Url: ESP32_URL,
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (_req, res) => {
  res.redirect("/api/status");
});

app.get("/api/live", (_req, res) => {
  res.json({
    connected: lastFetchOk,
    lastUpdate: lastFetchAt,
    error: lastError,
    data: buildLiveData(),
    serverCountdownRunning: isServerCountdownRunning(),
  });
});

app.get("/api/alerts", (_req, res) => {
  res.json({
    history: alertHistory,
    notifyLog,
    twilioConfigured: isNotifyConfigured(),
    alertPhone: process.env.ALERT_PHONE || "whatsapp:+918754593267",
  });
});

app.post("/api/test-notify", async (_req, res) => {
  try {
    const result = await sendTestWhatsAppAlert();
    res.json({
      ok: result.whatsapp === "sent",
      result,
      hint:
        result.whatsapp !== "sent"
          ? "Join Twilio WhatsApp sandbox or check notifyLog for Twilio error"
          : undefined,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Polling ${ESP32_URL} every ${POLL_MS}ms`);
  console.log(
    "Notifications:",
    process.env.ALERT_PHONE ? "Twilio enabled" : "console only (set ALERT_PHONE)"
  );
});
