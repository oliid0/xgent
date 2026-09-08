import { showFirstLaunch, showLaunchFailure } from "./lib/system/launchScreen";

// Reveal the already-painted first-launch surface before loading the app graph.
showFirstLaunch();
void import("./main").catch((error) => {
  showLaunchFailure();
  console.error("Application startup failed", error);
});
