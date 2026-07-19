import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Default is 1MB; AES CSV imports (Phase 2) upload full result files as a
    // server-action FormData File. See docs/plan.md Phase 2.
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
