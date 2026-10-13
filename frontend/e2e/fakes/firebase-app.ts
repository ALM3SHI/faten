/**
 * E2E stand-in for `firebase/app` — aliased in next.config.ts only when
 * FATEN_E2E=1. Nothing here talks to the network.
 */

type FakeApp = { name: string; options: Record<string, unknown> };

const apps: FakeApp[] = [];

export function initializeApp(options: Record<string, unknown> = {}): FakeApp {
  const app = { name: "[DEFAULT]", options };
  apps.push(app);
  return app;
}

export function getApps(): FakeApp[] {
  return apps;
}

export function getApp(): FakeApp {
  return apps[0] ?? initializeApp();
}
