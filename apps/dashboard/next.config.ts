import type { NextConfig } from "next";
import path from "path";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // @react-pdf/renderer must run in Node.js, not be bundled by webpack/turbopack
  serverExternalPackages: ["@react-pdf/renderer"],
  // Dev-Only: erlaubt cloudflared/ngrok-Tunnel und LAN-IPs als Origin für
  // HMR und Mobile-Tests. In Prod ignoriert.
  allowedDevOrigins: [
    "*.trycloudflare.com",
    "*.ngrok-free.app",
    "*.ngrok.io",
    "192.168.0.0/16",
    "10.0.0.0/8",
  ],
  // standalone + file tracing only in production builds — in dev they cause Turbopack
  // to watch/trace the entire monorepo (incl. node_modules), which kills CPU/memory.
  ...(isProd && {
    output: "standalone",
    outputFileTracingRoot: path.join(__dirname, "../../"),
  }),
};

export default withNextIntl(nextConfig);
