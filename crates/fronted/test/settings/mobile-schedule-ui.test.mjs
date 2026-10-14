import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("schedule fields and controls invoke the actual shared operations and honor loading or unknown-write disablement", async () => {
  const calls = [];
  const state = { kind: "reminder", calendars: { calendars: [{ id: "observed", title: "Work", source: "account" }], truncated: false },
    calendarId: "observed", title: "Exercise", day: "2099-10-09", time: "20:00", recurrence: "daily", duration: 30,
    records: [], busy: false, canSave: true, error: "", receipt: null };
  for (const name of ["setKind", "setCalendarId", "setTitle", "setDay", "setTime", "setRecurrence", "setDuration", "load", "save"]) state[name] = value => calls.push([name, value]);
  const names = ["Banner", "Button", "List", "Section", "Selector", "TextInput"];
  const mocks = Object.fromEntries(names.map(name => [`@astryxdesign/core/${name}`, { [name]: name, ...(name === "List" ? { ListItem: "ListItem" } : {}) }]));
  const loader = createTsModuleLoader({ mocks: { ...mocks, "./ConnectorDataList": { ConnectorDataList: "ConnectorDataList" },
    "@astryxdesign/core/Layout": { VStack: "VStack" }, "@astryxdesign/core/Text": { Heading: "Heading", Text: "Text" },
    "../../i18n": { useLocale: () => ({ t: key => key }) }, "../../lib/connectors/useMobileSchedule": { useMobileSchedule: () => state },
  } });
  const { MobileScheduleSection } = loader.loadModule("src/pages/settings/MobileScheduleSection.tsx");
  const flatten = element => !element ? [] : Array.isArray(element) ? element.flatMap(flatten) : [element, ...flatten(element.props?.children)];
  const elements = () => flatten(MobileScheduleSection({}));
  const field = label => elements().find(e => e.props?.label === `settings.connectors.${label}`);
  field("destination").props.onChange("observed"); field("recordTitle").props.onChange("Run");
  field("recordDay").props.onChange("2099-10-10"); field("recordTime").props.onChange("19:00"); field("recurrence").props.onChange("weekly");
  await field("loadSchedule").props.onClick(); await field("saveSchedule").props.onClick();
  assert.deepEqual(calls.map(c => c[0]), ["setCalendarId", "setTitle", "setDay", "setTime", "setRecurrence", "load", "save"]);
  state.canSave = false; state.error = "Write result unknown"; assert.equal(field("saveSchedule").props.isDisabled, true);
  assert.ok(elements().some(e => e.type === "Banner" && e.props.title === state.error));
  state.busy = true; assert.ok(elements().filter(e => ["Button", "TextInput", "Selector"].includes(e.type)).every(e => e.props.isDisabled));
  state.busy = false; state.calendars = { calendars: [], truncated: false };
  assert.equal(field("saveSchedule"), undefined); assert.ok(elements().some(e => e.props?.children === "settings.connectors.noCalendars"));
});
