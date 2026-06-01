/**
 * Rule-based alert classifier (priority-ordered rules).
 */

const LYING_TILT_DEG = 65;

const RISK_SCORES = {
  HELMET_DISCONNECTED: 100,
  NO_MOVEMENT: 90,
  LYING_DOWN: 75,
  NO_HELMET: 60,
  CONSCIOUS_RIDER: 30,
  UNKNOWN: 50,
};

function formatLocationBlock(lat, lon) {
  const latStr = Number(lat).toFixed(6);
  const lonStr = Number(lon).toFixed(6);
  return (
    `At this location:\n` +
    `Latitude: ${latStr}\n` +
    `Longitude: ${lonStr}\n` +
    `https://maps.google.com/?q=${latStr},${lonStr}`
  );
}

/**
 * @param {{
 *   helmetWorn: boolean,
 *   tiltAngle: number,
 *   movementDetectedLast5s: boolean,
 *   transmitterConnected: boolean,
 *   latitude: number,
 *   longitude: number,
 *   timestamp?: string
 * }} inputs
 */
export function classifyAlert(inputs) {
  const helmetWorn = !!inputs.helmetWorn;
  const tiltAngle = Math.min(180, Math.max(0, Number(inputs.tiltAngle ?? 0)));
  const movementDetectedLast5s = !!inputs.movementDetectedLast5s;
  const transmitterConnected = !!inputs.transmitterConnected;
  const latitude = Number(inputs.latitude ?? 0);
  const longitude = Number(inputs.longitude ?? 0);
  const timestamp = inputs.timestamp || new Date().toISOString();

  let category;
  let riskScore;
  let lines;

  // 1. Critical — helmet / transmitter disconnected
  if (!transmitterConnected) {
    category = "HELMET_DISCONNECTED";
    riskScore = RISK_SCORES.HELMET_DISCONNECTED;
    lines = [
      "Helmet disconnected mid-alert.",
      "Possible severe accident detected.",
    ];
  }
  // 2. High — no movement, helmet worn
  else if (!movementDetectedLast5s && helmetWorn) {
    category = "NO_MOVEMENT";
    riskScore = RISK_SCORES.NO_MOVEMENT;
    lines = [
      "Accident occurred. Helmet is worn.",
      "No movement detected in the last 5 seconds — helmet may be separated from the driver or the rider may be unconscious.",
    ];
  }
  // 3. High — rider may be lying down
  else if (tiltAngle > LYING_TILT_DEG && helmetWorn) {
    category = "LYING_DOWN";
    riskScore = RISK_SCORES.LYING_DOWN;
    lines = [
      "Accident occurred. Helmet is worn.",
      "Helmet worn — driver may be lying down.",
    ];
  }
  // 4. Moderate — helmet not worn
  else if (!helmetWorn) {
    category = "NO_HELMET";
    riskScore = RISK_SCORES.NO_HELMET;
    lines = ["Helmet not worn during alert."];
  }
  // 5. Normal crash — conscious rider
  else if (helmetWorn && movementDetectedLast5s && tiltAngle <= LYING_TILT_DEG) {
    category = "CONSCIOUS_RIDER";
    riskScore = RISK_SCORES.CONSCIOUS_RIDER;
    lines = [
      "Accident occurred. Helmet is worn.",
      "Helmet is worn — driver appears conscious (movement detected in the last 5 seconds).",
    ];
  } else {
    category = "UNKNOWN";
    riskScore = RISK_SCORES.UNKNOWN;
    lines = ["Accident detected. Please check on the driver."];
  }

  const situation = lines.join("\n");
  const locationBlock = formatLocationBlock(latitude, longitude);
  const message = `*EMERGENCY ALERT*\n\n${situation}\n\n${locationBlock}`;

  return {
    category,
    riskScore,
    message,
    latitude,
    longitude,
    timestamp,
  };
}

export { LYING_TILT_DEG, RISK_SCORES };
