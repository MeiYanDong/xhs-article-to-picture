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
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 40,
            },
            {
              name: "editor-lezer",
              test: /node_modules[\\/]@lezer[\\/]/,
              priority: 70,
            },
            {
              name: "editor-state",
              test: /node_modules[\\/]@codemirror[\\/]state[\\/]/,
              priority: 65,
            },
            {
              name: "editor-view",
              test: /node_modules[\\/](?:@codemirror[\\/]view|crelt|style-mod|w3c-keyname)[\\/]/,
              priority: 60,
            },
            {
              name: "editor-language",
              test: /node_modules[\\/]@codemirror[\\/](?:autocomplete|commands|lang-markdown|language|lint|search)[\\/]/,
              priority: 55,
            },
            {
              name: "editor-wrapper",
              test: /node_modules[\\/]@uiw[\\/]react-codemirror[\\/]/,
              priority: 50,
            },
            {
              name: "editor-other",
              test: /node_modules[\\/]@codemirror[\\/]/,
              priority: 45,
            },
            {
              name: "markdown",
              test: /node_modules[\\/](?:unified|remark-|micromark|mdast-|unist-|vfile|bail|is-plain-obj|trough)[\\/]/,
              priority: 20,
            },
            {
              name: "export",
              test: /node_modules[\\/](?:diff|html-to-image)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
});
