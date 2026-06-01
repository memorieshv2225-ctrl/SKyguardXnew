import { useEffect, useRef, useState } from "react";

const LERP = 0.14;
const VIB_BUFFER = 240;

/** 60fps eased values toward latest sensor readings. */
export function useSmoothMotion(data) {
  const target = useRef({ gforce: 1, tilt: 0, vibration: 0 });
  const [smooth, setSmooth] = useState({ gforce: 1, tilt: 0, vibration: 0 });

  useEffect(() => {
    if (!data) return;
    target.current = {
      gforce: Number(data.gforce ?? 1),
      tilt: Number(data.tilt ?? data.angle ?? 0),
      vibration: Number(data.vibration ?? 0),
    };
  }, [data?.gforce, data?.tilt, data?.angle, data?.vibration]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setSmooth((prev) => {
        const t = target.current;
        const next = {
          gforce: prev.gforce + (t.gforce - prev.gforce) * LERP,
          tilt: prev.tilt + (t.tilt - prev.tilt) * LERP,
          vibration: prev.vibration + (t.vibration - prev.vibration) * LERP,
        };
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return smooth;
}

/** Semicircular dial gauge with smoothed needle (0 → max, one-way). */
export function DialGauge({ label, value, min = 0, max, unit = "", warn = false }) {
  const v = Number(value ?? 0);
  const pct = Math.min(1, Math.max(0, (v - min) / (max - min)));
  const cx = 100;
  const cy = 95;
  const r = 72;
  const startDeg = 135;
  const sweepDeg = 270;
  const needleDeg = startDeg + pct * sweepDeg;

  const polar = (deg, radius = r) => {
    const rad = (deg * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    };
  };

  const arcPath = (from, to, radius) => {
    const a0 = polar(from, radius);
    const a1 = polar(to, radius);
    const large = to - from > 180 ? 1 : 0;
    return `M ${a0.x} ${a0.y} A ${radius} ${radius} 0 ${large} 1 ${a1.x} ${a1.y}`;
  };

  const valueEnd = startDeg + pct * sweepDeg;
  const needleTip = polar(needleDeg, r - 8);
  const needleColor = warn ? "var(--red)" : "var(--accent)";

  return (
    <div className={`dial-gauge ${warn ? "dial-warn" : ""}`}>
      <div className="dial-title">{label}</div>
      <svg viewBox="0 0 200 115" className="dial-svg" aria-hidden>
        <path
          d={arcPath(startDeg, startDeg + sweepDeg, r)}
          fill="none"
          stroke="var(--border)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        {pct > 0.01 && (
          <path
            d={arcPath(startDeg, valueEnd, r)}
            fill="none"
            stroke={needleColor}
            strokeWidth="10"
            strokeLinecap="round"
            className="dial-arc-value"
          />
        )}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const tick = polar(startDeg + t * sweepDeg, r + 4);
          const inner = polar(startDeg + t * sweepDeg, r - 12);
          return (
            <line
              key={t}
              x1={inner.x}
              y1={inner.y}
              x2={tick.x}
              y2={tick.y}
              stroke="var(--muted)"
              strokeWidth="1"
            />
          );
        })}
        <circle cx={cx} cy={cy} r="5" fill="var(--card)" stroke={needleColor} strokeWidth="2" />
        <line
          x1={cx}
          y1={cy}
          x2={needleTip.x}
          y2={needleTip.y}
          stroke={needleColor}
          strokeWidth="2.5"
          strokeLinecap="round"
          style={{ transition: "none" }}
        />
      </svg>
      <div className={`dial-reading ${warn ? "gauge-warn" : ""}`}>
        {v.toFixed(2)}
        <span className="dial-unit">{unit}</span>
      </div>
      <div className="dial-scale">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

function drawSeismo(ctx, w, h, data) {
  const maxV = Math.max(15, ...data, 1);
  const midY = h / 2;
  const pad = 8;

  ctx.fillStyle = "#0a0c12";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "#1e2433";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad + ((h - pad * 2) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#2a3348";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(w, midY);
  ctx.stroke();
  ctx.setLineDash([]);

  const step = (w - pad * 2) / Math.max(data.length - 1, 1);

  ctx.beginPath();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#22c55e";
  data.forEach((v, i) => {
    const x = pad + i * step;
    const amp = (v / maxV) * (midY - pad - 4);
    const y = midY - amp;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.lineTo(pad + (data.length - 1) * step, midY);
  ctx.lineTo(pad, midY);
  ctx.closePath();
  ctx.fillStyle = "rgba(34, 197, 94, 0.12)";
  ctx.fill();

  const last = data[data.length - 1];
  const lastX = pad + (data.length - 1) * step;
  const lastY = midY - (last / maxV) * (midY - pad - 4);
  ctx.fillStyle = last > 10 ? "#ef4444" : "#22c55e";
  ctx.beginPath();
  ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#6b7280";
  ctx.font = "10px monospace";
  ctx.fillText(`max ${maxV.toFixed(0)}`, pad, 12);
  ctx.fillText(`${last.toFixed(1)}`, w - pad - 28, 12);
}

/** Live seismograph — 60fps buffer + smooth interpolation. */
export function VibrationSeismograph({ value }) {
  const canvasRef = useRef(null);
  const bufferRef = useRef([0]);
  const smoothRef = useRef(0);
  const targetRef = useRef(0);

  useEffect(() => {
    targetRef.current = Number(value ?? 0);
  }, [value]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let raf = 0;

    const frame = () => {
      smoothRef.current += (targetRef.current - smoothRef.current) * LERP;
      const buf = bufferRef.current;
      buf.push(smoothRef.current);
      if (buf.length > VIB_BUFFER) buf.shift();

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w > 0 && h > 0) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawSeismo(ctx, w, h, buf);
      }

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w > 0 && h > 0) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawSeismo(ctx, w, h, bufferRef.current);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="seismo-wrap">
      <div className="seismo-head">
        <span className="seismo-title">Vibration</span>
        <span className="seismo-sub">Live trace</span>
      </div>
      <canvas ref={canvasRef} className="seismo-canvas" />
    </div>
  );
}
