import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("Home settings invokes actual refresh and exposes loading, not-read, empty, partial and error states", async () => {
  const mocks = {};
  for (const [module, names] of Object.entries({ Banner: ["Banner"], Button: ["Button"], Layout: ["VStack"], List: ["List", "ListItem"], Section: ["Section"], Text: ["Heading", "Text"] }))
    mocks[`@astryxdesign/core/${module}`] = Object.fromEntries(names.map(name => [name, name]));
  const loader = createTsModuleLoader({ mocks: { ...mocks, "./ConnectorDataList": { ConnectorDataList: "ConnectorDataList" }, "../../i18n": { useLocale: () => ({ t: key => key }) } } });
  const { MobileHomeSection } = loader.loadModule("src/pages/settings/MobileHomeSection.tsx");
  const elements = value => !value ? [] : Array.isArray(value) ? value.flatMap(elements) : [value, ...elements(value.props?.children)];
  const calls = [], home = { data: null, busy: false, error: "", refresh: async () => calls.push("native-refresh"),setPower:async request=>calls.push(request) };
  const render = (disabled = false) => elements(MobileHomeSection({ home, disabled }));
  assert.ok(render().some(node => node.props?.children === "settings.connectors.homeNotRead"));
  await render().find(node => node.type === "Button").props.onClick(); assert.deepEqual(calls, ["native-refresh"]);
  home.busy = true; assert.equal(render().find(node => node.type === "Button").props.isDisabled, true);
  assert.ok(render().some(node => node.props?.["aria-busy"] === true && node.props["aria-live"] === "polite"));
  home.busy = false; home.error = "Native SDK load timeout";
  assert.ok(render().some(node => node.type === "Banner" && node.props.title === home.error));
  assert.ok(!render().some(node => node.props?.children === "settings.connectors.noHome"));
  home.error = ""; home.data = { source: "homekit", observedAtMs: 1234, records: [], truncated: false };
  assert.ok(render().some(node => node.props?.children === "settings.connectors.noHome"));
  const id = "11111111-1111-4111-8111-111111111111";
  home.data = { ...home.data, truncated: true, records: [{ kind: "home", id, homeId: id, name: "Long home name" }] };
  assert.ok(render().some(node => node.props?.children === "settings.connectors.homeTruncated"));
  const row = render().find(node => node.type === "ConnectorDataList").props.rows[0];
  assert.equal(row.label, "Long home name"); assert.equal(row.icon, "home"); assert.equal(row.id, `home:${id}`);
  assert.equal(render(true).find(node => node.type === "Button").props.isDisabled, true);
  home.data.records.push({kind:"accessory",id:"accessory-id",homeId:id,name:"Light",reachable:true,powerControls:[{id:"power-id",serviceId:"service-id",name:"Light"}]});
  const action=render().find(node=>node.type==="ConnectorDataList").props.rows[1].actions[0];
  assert.equal(action.enabled,true);await action.run();assert.deepEqual(calls.at(-1),{homeId:id,accessoryId:"accessory-id",serviceId:"service-id",characteristicId:"power-id",power:true});
  home.busy=true;assert.ok(render().find(node=>node.type==="ConnectorDataList").props.rows[1].actions.every(action=>!action.enabled));
});
