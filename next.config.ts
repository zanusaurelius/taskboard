import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "better-sqlite3-multiple-ciphers", "@prisma/adapter-better-sqlite3"],
  experimental: {
    // proxy.ts runs on /api/files, so Next buffers the request body in memory to
    // make it readable in both proxy and the route. The default cap is 10MB, which
    // truncates larger uploads and breaks formData() parsing. Match the Files API's
    // 500MB MAX_BYTES so uploads up to that size survive the proxy buffer.
    proxyClientMaxBodySize: "500mb",
  },
};

export default nextConfig;
