import assert from "node:assert/strict";
import test from "node:test";

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function createHarness(resolveInvoke, access = {
  getToolPolicies: () => Object.fromEntries(["bluetooth", "location", "calendar", "reminders", "health", "clipboard", "photos"].map((key) => [`personal:${key}`, "allow"])),
}) {
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
  return {
    bundle: createMobilePersonalAssistantTools(access), calls,
    approval: loader.loadModule("src/lib/tools/toolApproval.ts"),
  };
}

function toolCall(name, args, id = "mobile-call") {
  return { type: "toolCall", id, name, arguments: args };
}

function resultData(result) {
  return JSON.parse(result.content[0].text);
}

test("authorized GATT operations preserve discovered properties and raw bytes", async () => {
  const data = { deviceId: "AA:BB:CC:DD:EE:FF", services: [{ uuid: "180f", characteristics: [{ uuid: "2a19", readable: true, writable: false, notifiable: true }] }], dataHex: "64" };
  const { bundle, calls } = createHarness((command) => {
    if (command.endsWith("|status")) return { permissionAliases: { bluetooth: "bluetooth" } };
    if (command.endsWith("|check_permissions")) return { bluetooth: "granted" };
    if (command.endsWith("|bluetooth_gatt")) return data;
    throw new Error(`Unexpected command ${command}`);
  });
  for (const action of ["bluetooth_services", "read_bluetooth_characteristic"]) {
    const response = await bundle.executeToolCall(toolCall("MobilePersonalData", { action, device_id: data.deviceId, service_uuid: "180f", characteristic_uuid: "2a19" }));
    assert.equal(response.isError, false);
    assert.deepEqual(resultData(response), data);
    assert.equal(calls.at(-1).args.request.operation, action === "bluetooth_services" ? "services" : "read");
    assert.equal(calls.at(-1).args.request.timeoutMs, 10_000);
  }
});

test("GATT policy denial, OS denial and malformed reads cannot invoke native GATT", async () => {
  for (const mode of ["policy", "os", "uuid", "timeout"]) {
    const { bundle, calls } = createHarness((command) => {
      if (command.endsWith("|status")) return { permissionAliases: { bluetooth: "bluetooth" } };
      if (command.endsWith("|check_permissions")) return { bluetooth: mode === "os" ? "denied" : "granted" };
      throw new Error(`Unexpected command ${command}`);
    }, { getToolPolicies: () => ({ "personal:bluetooth": mode === "policy" ? "deny" : "allow" }) });
    const response = await bundle.executeToolCall(toolCall("MobilePersonalData", {
      action: "read_bluetooth_characteristic", device_id: "AA:BB:CC:DD:EE:FF",
      service_uuid: mode === "uuid" ? "invalid" : "180f", characteristic_uuid: "2a19",
      timeout_ms: mode === "timeout" ? 0 : 10_000,
    }));
    assert.equal(response.isError, true);
    assert.equal(calls.some(({ command }) => command.endsWith("|bluetooth_gatt")), false);
    if (mode === "policy") assert.equal(calls.length, 0);
  }
});

test("GATT native failures and in-flight cancellation never become successful readings", async () => {
  for (const cancel of [true, false]) {
    const controller = new AbortController();
    const { bundle } = createHarness((command) => {
      if (command.endsWith("|status")) return { permissionAliases: { bluetooth: "bluetooth" } };
      if (command.endsWith("|check_permissions")) return { bluetooth: "granted" };
      if (command.endsWith("|bluetooth_gatt")) {
        if (cancel) { controller.abort(); return { dataHex: "64" }; }
        throw new Error("Bluetooth GATT operation timed out");
      }
      throw new Error(`Unexpected command ${command}`);
    });
    const response = await bundle.executeToolCall(toolCall("MobilePersonalData", { action: "bluetooth_services", device_id: "AA:BB:CC:DD:EE:FF" }), controller.signal);
    assert.equal(response.isError, true);
    assert.match(response.content[0].text, cancel ? /Cancelled/ : /timed out/);
  }
});

test("authorized photo queries preserve restricted-library and truncation evidence", async () => {
  const data = { photos: [{ id: "42", createdMs: 1, width: 300, height: 200 }], accessLimited: true, truncated: true };
  const { bundle, calls } = createHarness((command) => {
    if (command.endsWith("|status")) return { permissionAliases: { photos: "photosSelected" } };
    if (command.endsWith("|check_permissions")) return { photosSelected: "granted" };
    if (command.endsWith("|list_photos")) return data;
    throw new Error(`Unexpected command ${command}`);
  });
  const response = await bundle.executeToolCall(toolCall("MobilePersonalData", { action: "list_photos", limit: 999 }));
  assert.deepEqual(resultData(response), data);
  assert.deepEqual(calls.at(-1).args.request, { startMs: null, endMs: null, limit: 200 });
});

test("photo preview reads return actual image content without embedding base64 in text evidence", async () => {
  const { bundle } = createHarness((command) => {
    if (command.endsWith("|status")) return { permissionAliases: { photos: "photos" } };
    if (command.endsWith("|check_permissions")) return { photos: "granted" };
    if (command.endsWith("|read_photo")) return { id: "42", width: 20, height: 10, mimeType: "image/jpeg", dataBase64: "aW1hZ2U=" };
    throw new Error(`Unexpected command ${command}`);
  });
  const response = await bundle.executeToolCall(toolCall("MobilePersonalData", { action: "read_photo", photo_id: "42" }));
  assert.equal(response.isError, false);
  assert.deepEqual(response.content[1], { type: "image", mimeType: "image/jpeg", data: "aW1hZ2U=" });
  assert.match(response.content[0].text, /not original/);
  assert.ok(!response.content[0].text.includes("aW1hZ2U="));
});

test("photo preview import requires authorization and never writes after cancellation", async () => {
  for (const cancel of [false, true]) {
    const controller = new AbortController();
    const { bundle, calls } = createHarness((command) => {
      if (command.endsWith("|status")) return { permissionAliases: { photos: "photos" } };
      if (command.endsWith("|check_permissions")) return { photos: "granted" };
      if (command.endsWith("|read_photo")) {
        if (cancel) controller.abort();
        return { id: "42", mimeType: "image/jpeg", dataBase64: "aW1hZ2U=", width: 20, height: 10 };
      }
      if (command === "fs_import_file") return { path: "images/photo (1).jpg" };
      throw new Error(`Unexpected command ${command}`);
    }, { workdir: "/workspace", getToolPolicies: () => ({ "personal:photos": "allow" }) });
    const response = await bundle.executeToolCall(toolCall("MobilePersonalActions", {
      action: "import_photo_preview", photo_id: "42", file_name: "photo.jpg", directory: "images",
    }), controller.signal);
    assert.equal(response.isError, cancel);
    assert.equal(calls.some(({ command }) => command === "fs_import_file"), !cancel);
    if (!cancel) {
      assert.equal(resultData(response).path, "images/photo (1).jpg");
      assert.deepEqual(calls.at(-1).args, { workdir: "/workspace", directory: "images", file_name: "photo.jpg", content_base64: "aW1hZ2U=" });
    }
  }
});

test("denied photo permission prevents native list and read operations", async () => {
  const { bundle, calls } = createHarness((command) => command.endsWith("|status")
    ? { permissionAliases: { photos: "photos" } } : { photos: "denied" });
  for (const action of ["list_photos", "read_photo"]) {
    const response = await bundle.executeToolCall(toolCall("MobilePersonalData", { action, photo_id: "42" }));
    assert.equal(response.isError, true);
  }
  assert.ok(calls.every(({ command }) => /\|(status|check_permissions)$/.test(command)));
});

test("personal capability policy denies before any OS access, including noninteractive calls", async () => {
  for (const access of [
    { getToolPolicies: () => ({ "personal:location": "deny" }) },
    {},
    { getToolPolicies: () => ({ "personal:location": "allow", MobilePersonalData: "deny" }) },
  ]) {
    const { bundle, calls } = createHarness(() => { throw new Error("Unexpected native access"); }, access);
    const response = await bundle.executeToolCall(toolCall("MobilePersonalData", { action: "get_current_location" }));
    assert.equal(response.isError, true);
    assert.equal(calls.length, 0);
    assert.match(response.content[0].text, /disabled|interactive/);
  }
});

test("assistant approval precedes OS authorization and rejected approval never requests OS access", async () => {
  for (const decision of ["approve", "deny"]) {
    const { bundle, calls, approval } = createHarness((command) => {
      if (command.endsWith("|status")) return { permissionAliases: { location: "location" } };
      if (command.endsWith("|check_permissions")) return { location: "prompt" };
      if (command.endsWith("|request_permissions")) return { location: "denied" };
      throw new Error(`Unauthorized native read ${command}`);
    }, { conversationId: "chat" });
    const pending = bundle.executeToolCall(toolCall("MobilePersonalData", { action: "get_current_location" }));
    assert.equal(calls.length, 0);
    assert.equal(approval.listPendingToolApprovalsForConversation("chat").length, 1);
    approval.answerToolApproval("mobile-call", decision);
    const response = await pending;
    assert.equal(response.isError, true);
    assert.equal(calls.length, decision === "approve" ? 3 : 0);
  }
});

test("live personal policy revocation wins over a pending assistant approval", async () => {
  let policy = "ask";
  const { bundle, calls, approval } = createHarness(() => null, {
    conversationId: "chat", getToolPolicies: () => ({ "personal:location": policy }),
  });
  const pending = bundle.executeToolCall(toolCall("MobilePersonalData", { action: "get_current_location" }));
  policy = "deny";
  approval.answerToolApproval("mobile-call", "approve_session");
  assert.equal((await pending).isError, true);
  assert.equal(calls.length, 0);
});

test("ordinary capabilities require granted authorization, never merely requested", async () => {
  for (const [action, permission, args] of [
    ["scan_bluetooth", "bluetooth", {}],
    ["get_current_location", "location", {}],
    ["list_reminders", "reminders", {}],
    ["list_calendar_events", "calendar", { start: "2026-09-01", end: "2026-09-02" }],
  ]) {
    for (const state of ["requested", "denied"]) {
      const { bundle, calls } = createHarness((command) => {
        if (command.endsWith("|status")) return { backend: "ios-native", permissionAliases: {} };
        if (command.endsWith("|check_permissions") || command.endsWith("|request_permissions")) {
          return { [permission]: state };
        }
        throw new Error(`Unauthorized native operation: ${command}`);
      });
      const response = await bundle.executeToolCall(toolCall("MobilePersonalData", { action, ...args }));
      assert.equal(response.isError, true);
      assert.match(response.content[0].text, /permission/);
      assert.ok(calls.every(({ command }) => /\|(status|check_permissions|request_permissions)$/.test(command)));
      if (state === "denied") assert.ok(!calls.some(({ command }) => command.endsWith("|request_permissions")));
    }
  }
});

test("settings and tools serialize OS prompts, skip cancelled requests and recover after errors", async () => {
  const calls = [];
  let finishFirst;
  const firstReply = new Promise((resolve) => { finishFirst = resolve; });
  const loader = createTsModuleLoader({ mocks: {
    "@tauri-apps/api/core": { async invoke(command, args) {
      calls.push(args.request.permissions[0]);
      if (calls.length === 1) return firstReply;
      if (args.request.permissions[0] === "camera") throw new Error("OS request failed");
      return { location: "granted" };
    } },
  } });
  const { requestMobileAssistantPermission } = loader.loadModule("src/lib/mobileAssistant.ts");
  const controller = new AbortController();
  const first = requestMobileAssistantPermission("calendar");
  const cancelled = assert.rejects(requestMobileAssistantPermission("photos", controller.signal), /Cancelled/);
  const failure = assert.rejects(requestMobileAssistantPermission("camera"), /OS request failed/);
  const last = requestMobileAssistantPermission("location");
  await Promise.resolve();
  assert.deepEqual(calls, ["calendar"]);
  controller.abort();
  finishFirst({ calendar: "granted" });
  await Promise.all([first, cancelled, failure]);
  assert.deepEqual(await last, { location: "granted" });
  assert.deepEqual(calls, ["calendar", "camera", "location"]);
});

test("Bluetooth discovery requests native authorization without invoking Shell", async () => {
  const devices = [{ id: "device-1", name: "Sensor", rssi: -48, serviceUuids: ["1809"] }];
  const { bundle, calls } = createHarness((command) => {
    if (command.endsWith("|status")) return { permissionAliases: { bluetooth: "bluetooth" } };
    if (command.endsWith("|check_permissions")) return { bluetooth: "prompt" };
    if (command.endsWith("|request_permissions")) return { bluetooth: "granted" };
    if (command.endsWith("|scan_bluetooth")) return devices;
    throw new Error(`Unexpected command ${command}`);
  });
  const response = await bundle.executeToolCall(toolCall("MobilePersonalData", {
    action: "scan_bluetooth", timeout_ms: 90_000,
  }));
  assert.equal(response.isError, false);
  assert.deepEqual(resultData(response), { devices });
  assert.deepEqual(calls.at(-1), {
    command: "plugin:mobile-assistant|scan_bluetooth", args: { request: { timeoutMs: 30_000 } },
  });
});

test("Bluetooth discovery never scans when authorization is denied", async () => {
  const { bundle, calls } = createHarness((command) => {
    if (command.endsWith("|status")) return { permissionAliases: { bluetooth: "bluetooth" } };
    return { bluetooth: "denied" };
  });
  const response = await bundle.executeToolCall(toolCall("MobilePersonalData", { action: "scan_bluetooth" }));
  assert.equal(response.isError, true);
  assert.ok(!calls.some(({ command }) => command.endsWith("|scan_bluetooth")));
});

test("cancelling while OS authorization is pending prevents personal actions and reads", async () => {
  for (const [name, action, permission, args] of [
    ["MobilePersonalActions", "create_calendar_event", "calendar", {
      title: "Meeting", start: "2026-09-01T14:00:00Z", end: "2026-09-01T15:00:00Z",
    }],
    ["MobilePersonalActions", "create_reminder", "reminders", { title: "Reminder" }],
    ["MobilePersonalData", "discover_devices", "bluetooth", {}],
  ]) {
    const controller = new AbortController();
    const { bundle, calls } = createHarness(async (command) => {
      if (command.endsWith("|status")) return { permissionAliases: {} };
      if (command.endsWith("|check_permissions")) return { [permission]: "prompt" };
      if (command.endsWith("|request_permissions")) {
        controller.abort();
        return { [permission]: "granted" };
      }
      throw new Error(`Unexpected post-cancellation operation: ${command}`);
    });
    const response = await bundle.executeToolCall(toolCall(name, { action, ...args }), controller.signal);
    assert.equal(response.isError, true, action);
    assert.equal(response.content[0].text, "Cancelled");
    assert.equal(calls.at(-1).command, "plugin:mobile-assistant|request_permissions");
  }
});

test("network status works without Shell or permission prompts", async () => {
  const network = { transport: "wifi", connected: true, validated: true, metered: false };
  const { bundle, calls } = createHarness((command) => {
    assert.equal(command, "plugin:mobile-assistant|status");
    return { network };
  });
  const response = await bundle.executeToolCall(toolCall("MobilePersonalData", {
    action: "network_status",
  }));
  assert.equal(response.isError, false);
  assert.deepEqual(resultData(response), { network });
  assert.deepEqual(calls.map(({ command }) => command), ["plugin:mobile-assistant|status"]);
});

test("device discovery combines OS-connected routes with authorized nearby BLE results", async () => {
  const output = { id: "route-1", name: "Headphones", transport: "bluetooth", active: true };
  const { bundle, calls } = createHarness((command) => {
    if (command.endsWith("|status")) return { audioOutputs: [output], permissionAliases: { bluetooth: "bluetooth" } };
    if (command.endsWith("|check_permissions")) return { bluetooth: "granted" };
    if (command.endsWith("|scan_bluetooth")) return [{ id: "ble-1", name: "Sensor", rssi: -50, serviceUuids: [] }];
    throw new Error(`Unexpected command ${command}`);
  });
  const response = await bundle.executeToolCall(toolCall("MobilePersonalData", {
    action: "discover_devices",
  }));
  assert.equal(response.isError, false);
  assert.deepEqual(resultData(response), {
    network: null,
    connected: [output],
    nearbyBluetooth: [{ id: "ble-1", name: "Sensor", rssi: -50, serviceUuids: [] }],
  });
  assert.deepEqual(calls.map(({ command }) => command), [
    "plugin:mobile-assistant|status", "plugin:mobile-assistant|status",
    "plugin:mobile-assistant|check_permissions", "plugin:mobile-assistant|scan_bluetooth",
  ]);
});

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
  const { bundle, calls } = createHarness((command) => {
    if (command.endsWith("|status")) {
      return { permissionAliases: { calendar: "calendar" } };
    }
    if (command.endsWith("|check_permissions")) {
      return { calendar: "granted" };
    }
    return events;
  });

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
      command: "plugin:mobile-assistant|status",
      args: undefined,
    },
    {
      command: "plugin:mobile-assistant|check_permissions",
      args: undefined,
    },
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

test("health step reads request only the health capability and preserve limited-access context", async () => {
  const summary = {
    startMs: Date.parse("2026-09-01T00:00:00Z"),
    endMs: Date.parse("2026-09-02T00:00:00Z"),
    steps: 4321,
    source: "healthkit",
    accessLimited: true,
  };
  const { bundle, calls } = createHarness((command) => {
    if (command.endsWith("|status")) {
      return { backend: "ios-native", healthAvailable: true, permissionAliases: { health: "health" } };
    }
    if (command.endsWith("|check_permissions")) return { health: "requested" };
    return summary;
  });

  const result = await bundle.executeToolCall(
    toolCall("MobilePersonalData", {
      action: "read_health_steps",
      start: "2026-09-01T00:00:00Z",
      end: "2026-09-02T00:00:00Z",
    }),
  );

  assert.equal(result.isError, false);
  assert.deepEqual(resultData(result), {
    summary,
    privacyNote: "The platform may expose only the health data window the user authorized.",
  });
  assert.deepEqual(calls.map((call) => call.command), [
    "plugin:mobile-assistant|status",
    "plugin:mobile-assistant|check_permissions",
    "plugin:mobile-assistant|read_health_steps",
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

test("health metrics request only the selected native type and preserve sample evidence without Shell", async () => {
  for (const [metric, unit] of [
    ["heart_rate", "bpm"], ["blood_glucose", "mg/dL"], ["oxygen_saturation", "%"],
    ["weight", "kg"], ["body_temperature", "degC"],
  ]) {
    const health = {
      metric, unit, startMs: 1, endMs: 2,
      samples: [{ id: "sample-1", startMs: 1, endMs: 1, value: 12, source: "device.app" }],
      source: "healthkit", truncated: true, accessLimited: true,
    };
    const { bundle, calls } = createHarness((command, args) => {
      if (command.endsWith("|status")) return { backend: "ios-native", healthAvailable: true };
      if (command.endsWith("|request_health_metric_permission")) {
        assert.deepEqual(args.request, { metric });
        return { health: "requested" };
      }
      assert.equal(command, "plugin:mobile-assistant|read_health_samples");
      assert.deepEqual(args.request, {
        metric, startMs: Date.parse("2026-09-01T00:00:00Z"),
        endMs: Date.parse("2026-09-02T00:00:00Z"), limit: 200,
      });
      return health;
    });
    const response = await bundle.executeToolCall(toolCall("MobilePersonalData", {
      action: "read_health_samples", metric, start: "2026-09-01T00:00:00Z",
      end: "2026-09-02T00:00:00Z", limit: 999,
    }));
    assert.equal(response.isError, false);
    assert.deepEqual(resultData(response).health, health);
    assert.deepEqual(response.details.data.health, health);
    assert.equal(calls.length, 3);
  }
});

test("health sample reads stop on denial or cancellation and reject invalid requests before IPC", async () => {
  const args = {
    action: "read_health_samples", metric: "heart_rate",
    start: "2026-09-01T00:00:00Z", end: "2026-09-02T00:00:00Z",
  };
  for (const denied of [true, false]) {
    const controller = new AbortController();
    const { bundle, calls } = createHarness((command) => {
      if (command.endsWith("|status")) return { healthAvailable: true };
      assert.equal(command, "plugin:mobile-assistant|request_health_metric_permission");
      if (!denied) controller.abort();
      return { health: denied ? "denied" : "granted" };
    });
    const response = await bundle.executeToolCall(toolCall("MobilePersonalData", args), controller.signal);
    assert.equal(response.isError, true);
    assert.equal(calls.length, 2);
  }
  for (const invalid of [{ metric: "unknown" }, { end: args.start }, { start: "invalid" }]) {
    const { bundle, calls } = createHarness(() => { throw new Error("must not invoke"); });
    const response = await bundle.executeToolCall(toolCall("MobilePersonalData", { ...args, ...invalid }));
    assert.equal(response.isError, true);
    assert.equal(calls.length, 0);
  }
});
