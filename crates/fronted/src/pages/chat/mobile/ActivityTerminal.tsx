import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";

/** A read-only view of the actual command stream; it never executes input. */
export function ActivityTerminal({ command, output }: { command: string; output: string }) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const written = useRef("");
  useEffect(() => {
    if (!host.current) return;
    const colors = getComputedStyle(host.current);
    const term = new Terminal({
      disableStdin: true,
      convertEol: true,
      scrollback: 3000,
      fontSize: 13,
      fontFamily: "Consolas, ui-monospace, monospace",
      cursorBlink: false,
      screenReaderMode: true,
      theme: {
        background: colors.backgroundColor,
        foreground: colors.color,
        cursor: colors.backgroundColor,
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    terminal.current = term;
    written.current = "";
    const observer = new ResizeObserver(() => {
      if (host.current && host.current.clientWidth > 0 && host.current.clientHeight > 0) fit.fit();
    });
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      terminal.current = null;
      term.dispose();
    };
  }, []);
  useEffect(() => {
    const term = terminal.current;
    if (!term) return;
    const next = `$ ${command}\r\n${output}`;
    if (next.startsWith(written.current)) term.write(next.slice(written.current.length));
    else {
      term.reset();
      term.write(next);
    }
    written.current = next;
  }, [command, output]);
  return <div ref={host} className="xgent-activity-terminal" aria-label={command} />;
}
