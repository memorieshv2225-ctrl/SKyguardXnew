# SkyGuardX — one-port local + ngrok

## Restore old setup (no ngrok, separate frontend)

```bash
git checkout local-stable
```

`main` keeps ngrok features; nothing was deleted.

## Same Wi-Fi as ESP (fastest)

```bash
cd backend
npm start          # API only :3001 — unchanged
cd ../frontend && npm run dev   # :5173
```

Or unified port:

```bash
cd backend
npm run start:app  # http://localhost:5000
```

## Phone on any network (ngrok)

1. Laptop on Wi-Fi **12** (same as ESP).
2. `backend/.env` — `ESP32_URL=http://YOUR_ESP_IP/data`
3. Optional: `NGROK_AUTHTOKEN=...` from https://dashboard.ngrok.com/get-started/your-authtoken
4. Run:

```bash
cd backend
npm run ngrok
```

5. Open the printed `https://….ngrok-free.app` URL on your phone.

One tunnel — dashboard and API on the same URL.

## Branches on GitHub

| Branch | Purpose |
|--------|---------|
| `local-stable` | Code before ngrok unified server |
| `ngrok-unified` | Same as main with ngrok scripts |
| `main` | Latest (includes ngrok) |
