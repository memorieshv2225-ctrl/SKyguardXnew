/** Map sensor / countdown data into classifier inputs. */

import { classifyAlert } from "./alertClassifier.js";

export function isMoving(data) {
  const vib = Number(data.vibration ?? 0);
  const g = Number(data.gforce ?? 1);
  return vib > 5 || Math.abs(g - 1) > 0.1;
}

export function buildClassifierInputsFromTracker(tracker, overrides = {}) {
  if (!tracker) {
    return buildClassifierInputsFromSnapshot(overrides);
  }

  const disconnected = !!(
    overrides.helmetDisconnectedMid ?? tracker.helmetDisconnectedMid
  );
  const helmetWorn = !!tracker.everWorn && !tracker.everNotWorn;
  const movementDetectedLast5s =
    tracker.final5sSamples.length > 0
      ? !!tracker.final5sHadMovement
      : isMoving(tracker.snapshot || {});

  return {
    helmetWorn,
    tiltAngle: tracker.maxTilt ?? 0,
    movementDetectedLast5s,
    transmitterConnected: !disconnected,
    latitude: overrides.latitude ?? tracker.snapshot?.lat,
    longitude: overrides.longitude ?? tracker.snapshot?.lon,
    timestamp: overrides.timestamp,
  };
}

export function buildClassifierInputsFromSnapshot(data, overrides = {}) {
  const disconnected = !!(
    overrides.helmetDisconnectedMid ?? data?.helmetDisconnectedMid
  );
  const worn = !!data?.worn;

  return {
    helmetWorn: worn,
    tiltAngle: Number(data?.tilt ?? data?.angle ?? 0),
    movementDetectedLast5s: isMoving(data || {}),
    transmitterConnected: !disconnected,
    latitude: overrides.latitude ?? data?.lat,
    longitude: overrides.longitude ?? data?.lon,
    timestamp: overrides.timestamp,
  };
}

export function classifyFromTracker(tracker, pos = {}) {
  const inputs = buildClassifierInputsFromTracker(tracker, {
    helmetDisconnectedMid: tracker?.helmetDisconnectedMid,
    latitude: pos.lat,
    longitude: pos.lon,
  });
  return classifyAlert(inputs);
}

export function classifyFromSnapshot(data, pos = {}) {
  const inputs = buildClassifierInputsFromSnapshot(data, {
    latitude: pos.lat ?? data?.lat,
    longitude: pos.lon ?? data?.lon,
  });
  return classifyAlert(inputs);
}

/** @deprecated use classifyFromTracker */
export function buildAlertContextFromTracker(tracker) {
  return buildClassifierInputsFromTracker(tracker);
}

/** @deprecated use classifyFromSnapshot */
export function buildAlertContextFromSnapshot(data) {
  return buildClassifierInputsFromSnapshot(data);
}
