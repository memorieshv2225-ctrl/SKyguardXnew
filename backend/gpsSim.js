/**
 * Campus route simulation — lat/lon advance only while helmet sensors show movement.
 */

export const LANDMARK = "Saveetha School of Management";

const SIM_ROUTE = [
  { lat: 13.025958, lon: 80.017478 },
  { lat: 13.025436, lon: 80.015771 },
  { lat: 13.025792, lon: 80.017051 },
  { lat: 13.025914, lon: 80.017076 },
  { lat: 13.025875, lon: 80.017096 },
  { lat: 13.025664, lon: 80.016691 },
];

const STEP_MS = 2500;

let wpIndex = 0;
let lastAdvanceMs = Date.now();
let frozen = { lat: SIM_ROUTE[0].lat, lon: SIM_ROUTE[0].lon };

function advanceRoute() {
  const now = Date.now();
  if (now - lastAdvanceMs >= STEP_MS) {
    wpIndex = (wpIndex + 1) % SIM_ROUTE.length;
    lastAdvanceMs = now;
  }
}

function interpolatePosition() {
  const from = SIM_ROUTE[wpIndex];
  const to = SIM_ROUTE[(wpIndex + 1) % SIM_ROUTE.length];
  const t = Math.min(1, (Date.now() - lastAdvanceMs) / STEP_MS);
  return {
    lat: from.lat + (to.lat - from.lat) * t,
    lon: from.lon + (to.lon - from.lon) * t,
  };
}

export function isHelmetMoving(data) {
  if (!data) return false;
  const vib = Number(data.vibration ?? 0);
  const g = Number(data.gforce ?? 1);
  const tilt = Number(data.tilt ?? 0);
  return vib > 5 || Math.abs(g - 1) > 0.1 || tilt > 8;
}

function routePosition(moving) {
  if (moving) {
    advanceRoute();
    const p = interpolatePosition();
    frozen.lat = p.lat;
    frozen.lon = p.lon;
    return {
      lat: p.lat,
      lon: p.lon,
      speed: 4.2 + (Math.sin(Date.now() / 1500) + 1) * 1.4,
      gpsStatus: "TRACKING",
    };
  }
  return {
    lat: frozen.lat,
    lon: frozen.lon,
    speed: 0,
    gpsStatus: "STATIONARY",
  };
}

export function needsGpsSimulation(data) {
  if (!data) return false;
  if (!data.gpsValid) return true;
  const lat = Number(data.lat);
  const lon = Number(data.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return true;
  if (Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001) return true;
  return false;
}

export function getSimulatedPosition(data) {
  return routePosition(isHelmetMoving(data));
}

export function applyGpsSimulation(data) {
  if (!data) return data;

  const pos = getSimulatedPosition(data);
  const out = { ...data, helmetMoving: isHelmetMoving(data) };

  if (needsGpsSimulation(data)) {
    out.lat = pos.lat;
    out.lon = pos.lon;
    out.speed = pos.speed;
    out.gpsValid = true;
    out.gpsStatus = pos.gpsStatus;
    out.locationSimulated = true;
    out.landmark = LANDMARK;
    out.satellites = out.satellites || 8;

    // Device stuck on GPS REQUIRED — website finishes alert with sim coords, then normal UI
    if (out.alertStatus === "GPS REQUIRED") {
      out._rawAlertStatus = "GPS REQUIRED";
      out.alertStatus = "CLEAR";
      out.alert = false;
      out.alertResolvedBySim = true;
    }
  }

  if (Array.isArray(out.alertHistory)) {
    out.alertHistory = out.alertHistory.map((a) => enrichAlertCoords(a, pos));
  }

  return out;
}

export function enrichAlertCoords(alert, pos) {
  if (!alert) return alert;
  const lat = Number(alert.lat);
  const lon = Number(alert.lon);
  const missing =
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    (Math.abs(lat) < 0.0001 && Math.abs(lon) < 0.0001);
  if (!missing) return alert;
  const p = pos || getSimulatedPosition({});
  return {
    ...alert,
    lat: p.lat,
    lon: p.lon,
    speed: alert.speed ?? p.speed,
    locationSimulated: true,
    landmark: LANDMARK,
  };
}
