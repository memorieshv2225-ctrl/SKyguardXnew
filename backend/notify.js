/**
 * Emergency WhatsApp via rule-based classifier.
 */

import {
  classifyFromTracker,
  classifyFromSnapshot,
  buildClassifierInputsFromTracker,
  buildClassifierInputsFromSnapshot,
} from "./alertContext.js";
import { classifyAlert } from "./alertClassifier.js";

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM = process.env.TWILIO_FROM || "whatsapp:+14155238886";
const ALERT_TO = process.env.ALERT_PHONE || "whatsapp:+918754593267";
const CALL_TO = process.env.EMERGENCY_CALL_TO || "+918754593267";
const CALL_FROM = process.env.TWILIO_CALL_FROM;

export function buildWhatsAppBody(alert) {
  if (alert.classification?.message) {
    return alert.classification.message;
  }

  const pos = {
    lat: alert.lat,
    lon: alert.lon,
  };

  if (alert.countdownTracker) {
    return classifyFromTracker(alert.countdownTracker, pos).message;
  }

  const inputs = buildClassifierInputsFromSnapshot(alert, pos);
  return classifyAlert(inputs).message;
}

export function buildClassificationForNotify(alert) {
  if (alert.classification) return alert.classification;

  const pos = { lat: alert.lat, lon: alert.lon };

  if (alert.countdownTracker) {
    return classifyFromTracker(alert.countdownTracker, pos);
  }

  const inputs = buildClassifierInputsFromSnapshot(alert, pos);
  if (alert.alertContext && typeof alert.alertContext === "object") {
    return classifyAlert({ ...alert.alertContext, ...inputs });
  }
  return classifyAlert(inputs);
}

async function twilioPost(path, params) {
  const auth = Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, error: text };
  return { ok: true, sid: text };
}

async function sendWhatsAppText(body) {
  const waTo = ALERT_TO.startsWith("whatsapp:") ? ALERT_TO : `whatsapp:${ALERT_TO}`;
  const waFrom = TWILIO_FROM.startsWith("whatsapp:")
    ? TWILIO_FROM
    : `whatsapp:${TWILIO_FROM}`;

  return twilioPost("Messages.json", {
    To: waTo,
    From: waFrom,
    Body: body,
  });
}

export async function sendTestWhatsAppAlert() {
  return sendEmergencyNotifications({
    lat: 13.025792,
    lon: 80.017051,
    gforce: 2.8,
    worn: true,
    tilt: 40,
    vibration: 12,
    transmitterConnected: true,
  });
}

export async function sendEmergencyNotifications(alert) {
  const classification = buildClassificationForNotify(alert);
  const body = classification.message;

  const results = {
    whatsapp: null,
    whatsappError: null,
    call: null,
    configured: !!(TWILIO_SID && TWILIO_TOKEN),
    to: ALERT_TO,
    messagePreview: body,
    classification,
  };

  if (!results.configured) {
    console.log("[notify] Twilio not configured. Would send:\n", body);
    return { ...results, logged: true };
  }

  try {
    const textResult = await sendWhatsAppText(body);
    if (textResult.ok) {
      results.whatsapp = "sent";
    } else {
      results.whatsapp = "failed";
      results.whatsappError = textResult.error;
      console.error("[notify] WhatsApp failed:", textResult.error);
    }
  } catch (e) {
    results.whatsapp = "failed";
    results.whatsappError = e.message;
  }

  if (CALL_FROM) {
    try {
      const twiml =
        '<Response><Say voice="alice">Emergency alert. Accident detected. Check WhatsApp for coordinates.</Say></Response>';
      const callResult = await twilioPost("Calls.json", {
        To: CALL_TO,
        From: CALL_FROM,
        Twiml: twiml,
      });
      results.call = callResult.ok ? "sent" : callResult.error;
    } catch (e) {
      results.call = e.message;
    }
  }

  console.log("[notify]", classification.category, results.whatsapp);
  return results;
}

export function isNotifyConfigured() {
  return !!(TWILIO_SID && TWILIO_TOKEN);
}
