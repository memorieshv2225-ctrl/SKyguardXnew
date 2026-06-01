# SkyGuardX — Helmet Crash Detector

Dashboard + Node backend for ESP32 helmet crash detection with WhatsApp alerts (Twilio).

## Run locally (Windows)

**Backend** (port 3001):

```bat
cd /d "c:\Users\hesh2\OneDrive\Desktop\pdd nmew\backend"
cmd.exe /c "npm start"
```

**Frontend** (port 5173):

```bat
cd /d "c:\Users\hesh2\OneDrive\Desktop\pdd nmew\frontend"
cmd.exe /c "npm run dev"
```

Open http://localhost:5173/

Copy `backend/.env.example` → `backend/.env` and fill Twilio + ESP32 URL.

---

## Push to GitHub

From project root (`pdd nmew`):

```bat
cd /d "c:\Users\hesh2\OneDrive\Desktop\pdd nmew"
git init
git add .
git commit -m "SkyGuardX helmet crash detector"
git branch -M main
git remote add origin https://github.com/hareshbharadwaj/SkyGuardX.git
git push -u origin main
```

If the remote already has a README-only commit, use:

```bat
git pull origin main --allow-unrelated-histories
git push -u origin main
```

**Never commit `backend/.env`** (secrets). Use Railway Variables instead.

---

## Deploy backend on Railway

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub** → select **SkyGuardX**
2. **Settings → Source → Root Directory:** `backend`
3. **Variables** (copy from your local `.env`):

| Variable | Example |
|----------|---------|
| `ESP32_URL` | `http://YOUR_PUBLIC_ESP_URL/data` |
| `TWILIO_ACCOUNT_SID` | `AC...` |
| `TWILIO_AUTH_TOKEN` | `...` |
| `TWILIO_FROM` | `whatsapp:+14155238886` |
| `ALERT_PHONE` | `whatsapp:+918754593267` |
| `FRONTEND_URL` | `https://your-frontend.up.railway.app` (after frontend deploy) |

4. **Settings → Networking → Generate Domain** → e.g. `https://skyguardx-backend.up.railway.app`
5. Test: `https://YOUR-BACKEND.up.railway.app/api/status`

Railway sets `PORT` automatically. `Procfile` runs `node server.js`.

### ESP32 + cloud backend

Railway **cannot** reach `192.168.x.x`. You need either:

- Port-forward / public IP + set `ESP32_URL=https://your-router-or-tunnel/data`, or  
- ngrok / Cloudflare tunnel to the ESP, or  
- Change firmware later to **POST** data to Railway (no change required for local-only use).

---

## Deploy frontend on Railway

1. Same Railway project → **New Service** → same GitHub repo
2. **Root Directory:** `frontend`
3. **Variables:**

| Variable | Value |
|----------|--------|
| `VITE_API_URL` | `https://YOUR-BACKEND.up.railway.app` |

4. **Build command:** `npm run build`  
5. **Start command:** `npm run start` (serves `dist` via Vite preview)
6. **Generate Domain** for frontend
7. Set backend variable `FRONTEND_URL` to the frontend Railway URL and redeploy backend (CORS)

Open the frontend URL in the browser.

---

## API

| Endpoint | Description |
|----------|-------------|
| `GET /api/status` | Health check |
| `GET /api/live` | Live helmet data |
| `GET /api/alerts` | Alert history + notify log |
| `POST /api/test-notify` | Test WhatsApp |
