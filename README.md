# Mystery Mansion

Real-time multiplayer mystery party game for 2–8 players.

## Run locally

1. Install Node.js 18+.
2. In this folder run `npm install`.
3. Run `npm start`.
4. Open **http://localhost:3000**.

## Test on multiple devices on the same Wi-Fi

Run `npm start`, find your computer's local IP (for example `192.168.1.10`), then open `http://192.168.1.10:3000` on the other devices.

The server listens on `0.0.0.0` so LAN devices can connect. Your firewall may ask for permission.

## Public deployment

Deploy the Node app to a host that supports persistent WebSocket connections (Socket.IO). Set the start command to `npm start`.
