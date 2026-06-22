import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During `npm run dev` the API/WS calls are proxied to the backend container so the
// frontend can use same-origin relative URLs in every environment.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
});
