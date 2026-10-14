import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

function createToolCall(id, name, args = {}) {
  return {
    type: "toolCall",
    id,
    name,
    arguments: args,
  };
}

function createServer(id) {
  return {
    id,
    enabled: true,
    transport: "stdio",
    command: "mock-mcp-server",
    args: [],
    env: {},
  };
}

for (const [label, first, second] of [
  ["server sanitization", ["pc.one", "write"], ["pc_one", "write"]],
  ["tool sanitization", ["pc", "read.file"], ["pc", "read_file"]],
  ["server/tool boundary", ["pc_one", "write"], ["pc", "one_write"]],
  ["duplicate discovery", ["pc", "write"], ["pc", "write"]],
]) {
  test(`ambiguous MCP ${label} cannot overwrite a route; independent tools remain usable`, async () => {
    const warnings = [], calls = [];
    const infos = [first, second, ["docs", "search"]].map(([serverId, name]) => ({
      serverId, name, serverLabel: serverId, description: name,
      inputSchema: { type: "object" },
    }));
    const loader = createTsModuleLoader({ mocks: {
      "@tauri-apps/api/core": { async invoke(command, args) {
        if (command === "mcp_list_tools") return infos;
        assert.equal(command, "mcp_call_tool");
        calls.push(args);
        return { content: [{ type: "text", text: "actual docs result" }], isError: false, details: {} };
      } },
    } });
    const { createMcpTools } = loader.loadModule("src/lib/tools/mcpTools.ts");
    const servers = [...new Set(infos.map(info => info.serverId))].map(createServer);
    const bundle = await createMcpTools({ servers, onLoadError: message => warnings.push(message) });
    assert.deepEqual(bundle.tools.map(tool => tool.name), ["mcp_docs_search"]);
    assert.deepEqual([...bundle.toolNameMap.keys()], ["mcp_docs_search"]);
    assert.deepEqual([...bundle.metadataByName.keys()], ["mcp_docs_search"]);
    assert.match(warnings[0], /ambiguous/i);
    const disabled = await bundle.executeToolCall(createToolCall("disabled", `mcp_${first[0].replace(/\./g, "_")}_${first[1].replace(/\./g, "_")}`));
    assert.equal(disabled.isError, true);
    assert.equal(calls.length, 0);
    const valid = await bundle.executeToolCall(createToolCall("valid", "mcp_docs_search", { q: "runner" }));
    assert.equal(valid.isError, false);
    assert.equal(calls[0].server_id, "docs");
    assert.equal(calls[0].tool_name, "search");
    assert.deepEqual(calls[0].arguments, { q: "runner" });
    await assert.rejects(createMcpTools({ servers, loadFailureMode: "throw" }), /ambiguous/i);
  });
}

test("chat keeps working MCP servers when another enabled server is incomplete", async () => {
  const warnings = [];
  const listed = [];
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          assert.equal(command, "mcp_list_tools");
          listed.push(...args.servers.map((server) => server.id));
          return [{
            serverId: "docs",
            serverLabel: "Docs",
            name: "search",
            description: "Search docs",
            inputSchema: { type: "object" },
          }];
        },
      },
    },
  });
  const { createMcpTools } = loader.loadModule("src/lib/tools/mcpTools.ts");
  const servers = [createServer("docs"), { ...createServer("broken"), command: "" }];
  const bundle = await createMcpTools({ servers, onLoadError: (message) => warnings.push(message) });

  assert.deepEqual(listed, ["docs"]);
  assert.deepEqual(bundle.tools.map((tool) => tool.name), ["mcp_docs_search"]);
  assert.match(warnings[0], /broken: transport=stdio requires command/);
  await assert.rejects(
    createMcpTools({ servers, loadFailureMode: "throw" }),
    /broken: transport=stdio requires command/,
  );
});

test("MCP business tool calls are serialized per server", async () => {
  let activeCalls = 0;
  let maxActiveCalls = 0;
  const events = [];
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          if (command === "mcp_list_tools") {
            return [
              {
                serverId: "docs",
                serverLabel: "Docs",
                name: "search",
                description: "Search docs",
                inputSchema: { type: "object" },
              },
              {
                serverId: "docs",
                serverLabel: "Docs",
                name: "read",
                description: "Read docs",
                inputSchema: { type: "object" },
              },
            ];
          }
          if (command !== "mcp_call_tool") {
            throw new Error(`Unexpected invoke: ${command}`);
          }

          activeCalls += 1;
          maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
          events.push(`start:${args.tool_name}`);
          await new Promise((resolve) => setTimeout(resolve, 20));
          events.push(`end:${args.tool_name}`);
          activeCalls -= 1;
          return {
            content: [{ type: "text", text: `ok:${args.tool_name}` }],
            isError: false,
            details: {},
          };
        },
      },
    },
  });

  const { createMcpTools } = loader.loadModule("src/lib/tools/mcpTools.ts");
  const bundle = await createMcpTools({
    servers: [createServer("docs")],
  });
  const search = bundle.tools.find((tool) => tool.name.endsWith("_search"));
  const read = bundle.tools.find((tool) => tool.name.endsWith("_read"));

  assert.ok(search);
  assert.ok(read);

  const [searchResult, readResult] = await Promise.all([
    bundle.executeToolCall(createToolCall("call-search", search.name, { q: "agent" })),
    bundle.executeToolCall(createToolCall("call-read", read.name, { id: "agent" })),
  ]);

  assert.equal(searchResult.isError, false);
  assert.equal(readResult.isError, false);
  assert.equal(maxActiveCalls, 1);
  assert.deepEqual(events, ["start:search", "end:search", "start:read", "end:read"]);
});

test("MCP business tool calls on different servers can run concurrently", async () => {
  let activeCalls = 0;
  let maxActiveCalls = 0;
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command, args) {
          if (command === "mcp_list_tools") {
            return [
              {
                serverId: "docs",
                serverLabel: "Docs",
                name: "search",
                description: "Search docs",
                inputSchema: { type: "object" },
              },
              {
                serverId: "issues",
                serverLabel: "Issues",
                name: "search",
                description: "Search issues",
                inputSchema: { type: "object" },
              },
            ];
          }
          if (command !== "mcp_call_tool") {
            throw new Error(`Unexpected invoke: ${command}`);
          }

          activeCalls += 1;
          maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
          await new Promise((resolve) => setTimeout(resolve, 20));
          activeCalls -= 1;
          return {
            content: [{ type: "text", text: `ok:${args.server_id}` }],
            isError: false,
            details: {},
          };
        },
      },
    },
  });

  const { createMcpTools } = loader.loadModule("src/lib/tools/mcpTools.ts");
  const bundle = await createMcpTools({
    servers: [createServer("docs"), createServer("issues")],
  });
  const docsSearch = bundle.tools.find((tool) => tool.name.startsWith("mcp_docs_"));
  const issuesSearch = bundle.tools.find((tool) => tool.name.startsWith("mcp_issues_"));

  assert.ok(docsSearch);
  assert.ok(issuesSearch);

  await Promise.all([
    bundle.executeToolCall(createToolCall("call-docs", docsSearch.name, { q: "agent" })),
    bundle.executeToolCall(createToolCall("call-issues", issuesSearch.name, { q: "agent" })),
  ]);

  assert.equal(maxActiveCalls, 2);
});
