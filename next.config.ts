import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "deck.gl",
    "@deck.gl/core",
    "@deck.gl/layers",
    "@deck.gl/geo-layers",
    "@deck.gl/react",
    "@deck.gl/mesh-layers",
    "@loaders.gl/core",
    "@loaders.gl/terrain",
    "@loaders.gl/images",
  ],
};

export default nextConfig;
