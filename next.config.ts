import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Vercel handles builds natively, but Cloud Run needs standalone output
};

export default nextConfig;
