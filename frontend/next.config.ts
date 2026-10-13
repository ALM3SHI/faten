import type { NextConfig } from "next";

// `FATEN_E2E=1 npm run build` swaps Firebase for in-browser fakes so the
// Playwright suite (e2e/) runs with no real Firebase project or network.
// Production builds never set it, so this alias never ships.
const e2e = process.env.FATEN_E2E === "1";

const nextConfig: NextConfig = {
  // Every page is client-rendered, so `npm run build` emits a plain static
  // site in `out/` — hosted for free on Firebase Hosting (see firebase.json).
  output: "export",
  // /chat → /chat/index.html, which static hosts serve without rewrites.
  trailingSlash: true,
  ...(e2e && {
    // Keep the test build away from out/, which DEPLOY_FRONTEND.bat publishes.
    distDir: "out-e2e",
    turbopack: {
      resolveAlias: {
        "firebase/app": "./e2e/fakes/firebase-app.ts",
        "firebase/auth": "./e2e/fakes/firebase-auth.ts",
        "firebase/firestore": "./e2e/fakes/firebase-firestore.ts",
        "firebase/messaging": "./e2e/fakes/firebase-messaging.ts",
      },
    },
  }),
};

export default nextConfig;
