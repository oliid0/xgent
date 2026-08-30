import assert from "node:assert/strict";
import test from "node:test";

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function createHarness(resolveInvoke) {
  const calls = [];
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          calls.push({ command, args });
          return resolveInvoke(command, args);
        },
      },
    },
  });
  const { createMobilePersonalAssistantTools } = loader.loadModule(
    "src/lib/tools/mobilePersonalAssistantTools.ts",
  );
  return { bundle: createMobilePersonalAssistantTools(), calls };
}

function toolCall(name, args, id = "mobile-call") {
  return { type: "toolCall", id, name, arguments: args };
}

function resultData(result) {
  return JSON.parse(result.content[0].text);
}

test("mobile personal assistant separates read-only data from state-changing actions", () => {
  const { bundle } = createHarness(() => null);

  assert.deepEqual(
    bundle.tools.map((tool) => tool.name),
    ["MobilePersonalData", "MobilePersonalActions"],
  );
  assert.equal(bundle.metadataByName.get("MobilePersonalData").isReadOnly, true);
  assert.equal(bundle.metadataByName.get("MobilePersonalActions").isReadOnly, false);
});

test("calendar reads validate ISO dates and pass a bounded native request", async () => {
  const events = [
    {
      id: "event-1",
      title: "Design review",
      startMs: Date.parse("2026-09-01T14:00:00Z"),
      endMs: Date.parse("2026-09-01T15:00:00Z"),
      allDay: false,
    },
  ];
  const { bundle, calls } = createHarness(() => events);

  const result = await bundle.executeToolCall(
    toolCall("MobilePersonalData", {
      action: "list_calendar_events",
      start: "2026-09-01T00:00:00Z",
      end: "2026-09-02T00:00:00Z",
      limit: 999,
    }),
  );

  assert.equal(result.isError, false);
  assert.deepEqual(resultData(result), { events });
  assert.deepEqual(calls, [
    {
      command: "plugin:mobile-assistant|list_calendar_events",
      args: {
        request: {
          startMs: Date.parse("2026-09-01T00:00:00Z"),
          endMs: Date.parse("2026-09-02T00:00:00Z"),
          limit: 200,
        },
      },
    },
  ]);
});

test("email and SMS tools only report a presented user-controlled draft", async () => {
  const { bundle, calls } = createHarness(() => ({
    id: null,
    presented: true,
    detail: "System sms draft opened",
  }));

  const result = await bundle.executeToolCall(
    toolCall("MobilePersonalActions", {
      action: "compose_sms",
      recipients: [" +1 555 0100 ", ""],
      body: "On my way",
    }),
  );

  assert.equal(result.isError, false);
  assert.deepEqual(resultData(result), {
    id: null,
    presented: true,
    detail: "System sms draft opened",
    userConfirmationRequired: true,
    sent: false,
  });
  assert.deepEqual(calls, [
    {
      command: "plugin:mobile-assistant|compose_message",
      args: {
        request: {
          kind: "sms",
          recipients: ["+1 555 0100"],
          subject: null,
          body: "On my way",
        },
      },
    },
  ]);
});

test("invalid personal-action dates fail before native IPC", async () => {
  const { bundle, calls } = createHarness(() => {
    throw new Error("native invoke must not run");
  });

  const result = await bundle.executeToolCall(
    toolCall("MobilePersonalActions", {
      action: "create_calendar_event",
      title: "Review",
      start: "not-a-date",
      end: "2026-09-02T00:00:00Z",
    }),
  );

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /start must be a valid ISO 8601 date-time/);
  assert.deepEqual(calls, []);
});
