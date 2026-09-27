import "../../src/lib/system/layerCompatibility";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Dialog } from "@astryxdesign/core/Dialog";
import { Selector } from "@astryxdesign/core/Selector";
import { BottomSheet } from "@astryxdesign/core/BottomSheet";

function App() {
  const [value, setValue] = useState("a");
  const [open, setOpen] = useState(!location.search.includes("delayed"));
  const content = <>
    <Selector label="Language" value={value} onChange={setValue} options={[{value:"a",label:"English"},{value:"b",label:"Chinese"}]} />
    <output>{value}</output>
    <button onClick={() => setOpen(false)}>Close settings</button>
  </>;
  return <>
    <button onClick={() => setOpen(true)}>Open settings</button>
    {location.search.includes("compact")
      ? <BottomSheet isOpen={open} onOpenChange={setOpen} label="Settings">{content}</BottomSheet>
      : <Dialog isOpen={open} onOpenChange={setOpen} aria-label="Settings">{content}</Dialog>}
  </>;
}
createRoot(document.getElementById("root")!).render(<App />);
