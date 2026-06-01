import { useEffect, useRef, useState } from "react";
import "./App.css";
import { apiUrl } from "./api.js";
import { DialGauge, VibrationSeismograph, useSmoothMotion } from "./MotionSensors.jsx";

const LIVE_URL = apiUrl("/api/live");
const ALERTS_URL = apiUrl("/api/alerts");
const LIVE_POLL_MS = 500;
const ALERTS_POLL_MS = 3000;
const MAP_REFRESH_MS = 10000;
const G_THRESH = 1.2;
const LANDMARK = "Saveetha School of Management";
const CAMPUS_CENTER = { lat: 13.025792, lon: 80.017051 };

function buildMapUrl(lat, lon) {
  const pad = 0.0025;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lon - pad},${lat - pad},${lon + pad},${lat + pad}&layer=mapnik&marker=${lat},${lon}`;
}

function openMapsLink(lat, lon) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

function Pill({ on, trueLabel, falseLabel, trueClass, falseClass }) {
  return (
    <span className={`pill ${on ? trueClass : falseClass}`}>
      {on ? trueLabel : falseLabel}
    </span>
  );
}

export default function App() {
  const [payload, setPayload] = useState(null);
  const [alertsMeta, setAlertsMeta] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const [mapUrl, setMapUrl] = useState(buildMapUrl(CAMPUS_CENTER.lat, CAMPUS_CENTER.lon));
  const displayCoords = useRef({ lat: CAMPUS_CENTER.lat, lon: CAMPUS_CENTER.lon });

  useEffect(() => {
    let active = true;

    async function pollLive() {
      try {
        const liveRes = await fetch(LIVE_URL);
        if (!liveRes.ok) throw new Error(`Live HTTP ${liveRes.status}`);
        const live = await liveRes.json();
        if (!active) return;
        setPayload(live);
        setFetchError(null);
        const d = live.data;
        if (d?.lat != null && d?.lon != null) {
          displayCoords.current = { lat: d.lat, lon: d.lon };
        }
      } catch (err) {
        if (active) setFetchError(err.message);
      }
    }

    async function pollAlerts() {
      try {
        const alertRes = await fetch(ALERTS_URL);
        if (alertRes.ok && active) setAlertsMeta(await alertRes.json());
      } catch {
        /* alerts optional */
      }
    }

    pollLive();
    pollAlerts();
    const liveId = setInterval(pollLive, LIVE_POLL_MS);
    const alertId = setInterval(pollAlerts, ALERTS_POLL_MS);
    return () => {
      active = false;
      clearInterval(liveId);
      clearInterval(alertId);
    };
  }, []);

  useEffect(() => {
    function refreshMap() {
      const { lat, lon } = displayCoords.current;
      setMapUrl(buildMapUrl(lat, lon));
    }
    refreshMap();
    const id = setInterval(refreshMap, MAP_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const txConnected = payload?.connected ?? false;
  const lastUpdate = payload?.lastUpdate
    ? new Date(payload.lastUpdate).toLocaleString()
    : "—";
  const d = payload?.data;
  const motion = useSmoothMotion(d);
  const worn = d?.worn ?? false;
  const history =
    alertsMeta?.history?.length > 0
      ? alertsMeta.history
      : d?.alertHistory ?? [];
  const landmark = d?.landmark || LANDMARK;
  const lat = d?.lat ?? displayCoords.current.lat;
  const lon = d?.lon ?? displayCoords.current.lon;
  const countdownActive = d?.serverCountdownActive || (d?.alertStatus === "PENDING" && d?.mode === "FAST");
  const countdownSec = d?.serverCountdownActive ? d.serverCountdown : d?.countdown;
  const inAlert = d?.alertStatus === "ALERT SENT" || countdownActive;

  return (
    <div className="app">
      <h1 className="app-title">Helmet Crash Detector</h1>
      <TopBar
        txConnected={txConnected}
        lastUpdate={lastUpdate}
        fetchError={fetchError}
        txError={payload?.error}
        notifyReady={alertsMeta?.twilioConfigured}
      />

      {!d && (
        <p className="waiting">
          {txConnected
            ? "Waiting for transmitter data…"
            : "Start the server and connect to the same network as the transmitter."}
        </p>
      )}

      {d && (
        <>
          {!worn && (
            <div className="warn-banner">
              Helmet NOT WORN — touch the helmet sensor to arm detection.
            </div>
          )}

          {d.alertStatus === "ALERT SENT" && (
            <div className="alert-banner">EMERGENCY ALERT — ALERT SENT</div>
          )}
          {countdownActive && (
            <div className="countdown">
              {countdownSec}s — FAST MODE — press OK to cancel
              {d.transmitterOfflineDuringCountdown && (
                <span className="countdown-note"> · Transmitter offline — server timer still running</span>
              )}
            </div>
          )}
          {d.alertStatus === "CANCELLED" && (
            <div className="warn-banner">Alert CANCELLED — returned to Normal</div>
          )}

          <div className="mode-flow card">
            <div className="card-title">System Mode Flow</div>
            <div className="flow-steps">
              <FlowStep active={!worn} label="Monitor" sub="Helmet off" />
              <span className="flow-arrow">→</span>
              <FlowStep active={worn && d.mode === "NORMAL" && !d.alert} label="Normal" sub="Motion & location" />
              <span className="flow-arrow">→</span>
              <FlowStep active={d.mode === "FAST"} label="Fast" sub="20s verify" warn />
              <span className="flow-arrow">→</span>
              <FlowStep active={inAlert} label="Alert" sub="Notify + history" danger />
            </div>
          </div>

          <div className="dashboard-grid">
            <section className="card">
              <div className="card-title"><span className="live-dot" />1. Device Status</div>
              <div className="status-grid">
                <Stat label="Transmitter" value={<Pill on={txConnected} trueLabel="ONLINE" falseLabel="OFFLINE" trueClass="pill-green" falseClass="pill-red" />} />
                <Stat label="Location" value={locationPill(d)} />
                <Stat label="Helmet" value={<Pill on={worn} trueLabel="WORN" falseLabel="NOT WORN" trueClass="pill-green" falseClass="pill-red" />} />
                <Stat label="Mode" value={d.mode === "FAST" ? <span className="pill pill-red">FAST</span> : <span className="pill pill-green">NORMAL</span>} />
                <Stat label="Alert Status" value={<span className="pill pill-blue">{d.alertStatus || (d.alert ? "ALERT SENT" : "CLEAR")}</span>} />
                <Stat label="Armed" value={<Pill on={d.armed} trueLabel="ARMED" falseLabel="DISARMED" trueClass="pill-green" falseClass="pill-yellow" />} />
              </div>
            </section>

            <section className="card">
              <div className="card-title"><span className="live-dot" />2. Emergency Controls</div>
              <div className="status-grid">
                <Stat label="Countdown" value={countdownActive ? `${countdownSec}s` : "—"} />
                <Stat label="Buzzer" value={<Pill on={d.buzzer} trueLabel="ON" falseLabel="OFF" trueClass="pill-red" falseClass="pill-blue" />} />
                <Stat label="OK Button" value={<Pill on={d.button} trueLabel="PRESSED" falseLabel="IDLE" trueClass="pill-yellow" falseClass="pill-blue" />} />
                <Stat label="Fast Mode" value={<Pill on={d.mode === "FAST"} trueLabel="ACTIVE" falseLabel="OFF" trueClass="pill-red" falseClass="pill-blue" />} />
              </div>
            </section>

            <section className="card wide motion-card">
              <div className="card-title"><span className="live-dot" />3. Motion Sensors</div>
              <div className="dial-row">
                <DialGauge
                  label="Impact (G-Force)"
                  value={motion.gforce}
                  min={0}
                  max={4}
                  unit="g"
                  warn={motion.gforce > G_THRESH}
                />
                <DialGauge
                  label="Tilt"
                  value={motion.tilt}
                  min={0}
                  max={90}
                  unit="°"
                  warn={motion.tilt > 45}
                />
              </div>
              <VibrationSeismograph value={motion.vibration} />
              <div className="axis-grid">
                <Axis label="Axis X" v={d.ax} />
                <Axis label="Axis Y" v={d.ay} />
                <Axis label="Axis Z" v={d.az} />
              </div>
              <div className="angle-row">
                <span>Pitch {d.pitch?.toFixed(1) ?? "—"}°</span>
                <span>Roll {d.roll?.toFixed(1) ?? "—"}°</span>
              </div>
            </section>

            <section className="card wide">
              <div className="card-title"><span className="live-dot" />4. Location</div>
              <p className="landmark-name">{landmark}</p>
              <p className="landmark-sub">Maduravoyal, Chennai · Campus route simulation</p>
              <div className="gps-coords">
                <div className="coord-box">
                  <div className="coord-label">Latitude</div>
                  <div className="coord-val">{lat.toFixed(6)}</div>
                </div>
                <div className="coord-box">
                  <div className="coord-label">Longitude</div>
                  <div className="coord-val">{lon.toFixed(6)}</div>
                </div>
              </div>
              <div className="gps-meta">
                <span>Speed: {d.speed?.toFixed(1) ?? 0} km/h</span>
                <span>Status: {d.gpsStatus || "—"}</span>
                <span>{d.helmetMoving ? "Moving" : "Idle (position held)"}</span>
                {d.locationSimulated && <span>Campus route simulation</span>}
              </div>
              {mapUrl && (
                <>
                  <iframe className="map-frame" title="Location map" src={mapUrl} />
                  <a
                    className="map-link"
                    href={openMapsLink(lat, lon)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in Google Maps ↗
                  </a>
                </>
              )}
            </section>

            <section className="card wide logs-row">
              <div className="logs-split">
                <div className="logs-panel">
                  <div className="card-title">5. Alert History</div>
                  {history.length === 0 ? (
                    <p className="muted">No alerts yet.</p>
                  ) : (
                    <div className="table-scroll">
                      <table className="alert-table">
                        <thead>
                          <tr>
                            <th>Time</th>
                            <th>Location</th>
                            <th>Impact</th>
                            <th>Status</th>
                            <th>Response</th>
                          </tr>
                        </thead>
                        <tbody>
                          {history.map((a) => (
                            <tr key={a.sessionKey ?? `${a.id}-${a.status}-${a.receivedAt}`}>
                              <td>{a.utc ?? a.receivedAt}</td>
                              <td>
                                {a.lat && a.lon ? (
                                  <a href={openMapsLink(a.lat, a.lon)} target="_blank" rel="noreferrer">
                                    {Number(a.lat).toFixed(5)}, {Number(a.lon).toFixed(5)}
                                  </a>
                                ) : "—"}
                              </td>
                              <td>{a.gforce ?? "—"} g</td>
                              <td>{a.status ?? "SENT"}</td>
                              <td>{a.driverResponse ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                <div className="logs-panel">
                  <div className="card-title">6. Event Log</div>
                  <EventLog entries={d.log ?? []} />
                </div>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function FlowStep({ active, label, sub, warn, danger }) {
  let cls = "flow-step";
  if (active) cls += warn ? " flow-warn" : danger ? " flow-danger" : " flow-active";
  return (
    <div className={cls}>
      <strong>{label}</strong>
      <small>{sub}</small>
    </div>
  );
}

function locationPill(d) {
  const s = d.gpsStatus || (d.gpsValid ? "ACTIVE" : "NO FIX");
  const ok = s === "FIX" || s === "TRACKING" || s === "STATIONARY" || s === "ACTIVE";
  const wait = s === "SEARCHING";
  return (
    <span className={`pill ${ok ? "pill-green" : wait ? "pill-yellow" : "pill-red"}`}>
      {s}
    </span>
  );
}

function TopBar({ txConnected, lastUpdate, fetchError, txError, notifyReady }) {
  return (
    <div className="top-bar">
      <span className={`conn-badge ${txConnected ? "conn-ok" : "conn-bad"}`}>
        {txConnected ? "Transmitter Online" : "Transmitter Offline"}
      </span>
      <span>Updated: {lastUpdate}</span>
      {notifyReady && <span className="notify-on">Emergency notify ready</span>}
      {fetchError && <span className="top-error">Server: {fetchError}</span>}
      {!fetchError && txError && <span className="top-error">Transmitter: {txError}</span>}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat-box">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function Axis({ label, v }) {
  return (
    <div className="axis-box">
      <span>{label}</span>
      <strong>{v != null ? `${v.toFixed(3)} g` : "—"}</strong>
    </div>
  );
}

function EventLog({ entries }) {
  const logRef = useRef(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  return (
    <div className="event-log" ref={logRef}>
      {entries.length === 0 ? (
        <p className="muted">No events yet.</p>
      ) : (
        entries.map((e, i) => (
          <div key={i} className="log-entry">{e}</div>
        ))
      )}
    </div>
  );
}
