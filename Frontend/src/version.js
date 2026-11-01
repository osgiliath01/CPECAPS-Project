// Which version of the app this is. Filled in at build time by deploy.ps1 (through the web
// container); "dev" when running with npm run dev.
const env = import.meta.env;

export const APP_VERSION = {
  version: env.VITE_APP_VERSION || "dev",
  commit: env.VITE_APP_COMMIT || "dev",
  branch: env.VITE_APP_BRANCH || "local",
  built: env.VITE_APP_BUILT || "",
};

export const isDevBuild = APP_VERSION.commit === "dev";

export function versionLabel() {
  if (isDevBuild) return "Development build";
  // The branch isn't shown on screen; it's still in /version.json for troubleshooting
  const { version, commit } = APP_VERSION;
  return `Version ${version} · ${commit}`;
}
