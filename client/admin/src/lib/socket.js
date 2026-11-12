import { io as socketIO } from "socket.io-client";
import { api } from "../api/client.js";
import { pode } from "./acesso.js";

/* ══════════════════════════════════════════════════════════
   SOCKET — singleton
   ══════════════════════════════════════════════════════════ */

let _socket = null;

export function getSocket() {
  if (_socket) return _socket;
  // o socket entrega tasks e presença: só abre pra quem vê o kanban (o servidor também barra)
  if (!pode("kanban")) return null;
  const token = api.token();
  if (!token) return null;
  _socket = socketIO({
    path: "/hq/socket.io", // via proxy do ai-service → server principal
    auth: { token },
    transports: ["polling", "websocket"], // polling primeiro, upgrade pra WS quando possível
    upgrade: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
  _socket.on("connect_error", (err) => {
    console.warn("[ws] connect_error:", err.message);
  });
  return _socket;
}

export function disconnectSocket() {
  if (_socket) {
    _socket.disconnect();
    _socket = null;
  }
}
