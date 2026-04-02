import { io } from "socket.io-client";
import { getAuthToken } from "@/store/auth";

const getSocketUrl = () => {
  const value = import.meta.env.VITE_SOCKET_URL;
  if (!value) {
    throw new Error("Missing VITE_SOCKET_URL in frontend environment.");
  }

  return value;
};

export const createMonitoringSocket = () =>
  io(getSocketUrl(), {
    autoConnect: true,
    transports: ["websocket"],
    auth: (() => {
      const token = getAuthToken();
      return token ? { token } : undefined;
    })(),
  });
