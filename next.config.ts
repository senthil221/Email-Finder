import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Everything here is live data from Postgres; nothing is worth caching.
  output: "standalone",
  serverExternalPackages: ["pg"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
