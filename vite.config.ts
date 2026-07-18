import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createLocalImageProxyMiddleware } from "./local-image-proxy";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "zheye-local-image-proxy",
      configureServer(server) {
        server.middlewares.use(createLocalImageProxyMiddleware());
      },
      configurePreviewServer(server) {
        server.middlewares.use(createLocalImageProxyMiddleware());
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
});
