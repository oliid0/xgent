import { getNativeWindowLabel } from "./runtime";
import "./index.css";
import "katex/dist/katex.min.css";
import "streamdown/styles.css";

if (import.meta.env.DEV) {
  // Dev console hook for transcript perf work: window.__seedLongConversation()
  void import("./lib/debug/seedLongConversation").then(({ seedLongConversation }) => {
    const devWindow = window as Window & { __seedLongConversation?: typeof seedLongConversation };
    devWindow.__seedLongConversation = seedLongConversation;
  });
}

async function startApplication() {
  if ((await getNativeWindowLabel()) === "agent-worker") {
    const { startAgentWorker } = await import("./runtime/agentWorker");
    const stop = startAgentWorker();
    window.addEventListener("pagehide", stop, { once: true });
  } else {
    const { mountApp } = await import("./runtime/mountApp");
    mountApp();
  }
}

void startApplication().catch(console.error);
