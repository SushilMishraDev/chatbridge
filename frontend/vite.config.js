import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/sync": "http://127.0.0.1:8000",
      "/login": "http://127.0.0.1:8000",
      "/register": "http://127.0.0.1:8000",
      "/reset-password": "http://127.0.0.1:8000",
      "/auth": "http://127.0.0.1:8000",
      "/chats": "http://127.0.0.1:8000",
      "/me": "http://127.0.0.1:8000",
      "/handoff": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8000",
    },
  },
});
