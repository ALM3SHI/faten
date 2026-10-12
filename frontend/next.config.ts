import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page is client-rendered, so `npm run build` emits a plain static
  // site in `out/` — hosted for free on Firebase Hosting (see firebase.json).
  output: "export",
  // /chat → /chat/index.html, which static hosts serve without rewrites.
  trailingSlash: true,
};

export default nextConfig;
