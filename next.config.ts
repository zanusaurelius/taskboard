import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  htmlLimitedBots: /.*/,
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "better-sqlite3-multiple-ciphers", "@prisma/adapter-better-sqlite3"],
};

export default nextConfig;
