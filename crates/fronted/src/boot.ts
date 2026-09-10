import { showFirstLaunch, showLaunchFailure } from "./lib/system/launchScreen";
import "@oddbird/popover-polyfill";
import "./lib/system/layerCompatibility";

// Reveal the already-painted first-launch surface before loading the app graph.
showFirstLaunch();
void import("./main").catch((error) => {
  showLaunchFailure();
  console.error("Application startup failed", error);
});
