import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("Apple workspace settings edit real grants and shared Skills/MCP resources and discard retired folder picks", async (context) => {
  const states = [];
  const effects = new Map();
  const pendingEffects = [];
  const calls = [];
  let cursor = 0;
  let selectedProjectId = "one";
  let resolvePick;
  let pickDelayed = false;
  let failedSave = false;
  const grant = (projectId, id = "documents") => ({ id, projectId, alias: "documents", displayPath: "/Documents",
    canonicalPath: "/Documents", access: "read", state: "active" });
  const loader = createTsModuleLoader({ mocks: {
    react: {
      useMemo: (create) => create(),
      useState(initial) {
        const index = cursor++;
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], (next) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
      },
      useEffect(effect, dependencies) {
        const index = cursor++;
        const previous = effects.get(index);
        if (previous?.dependencies.every((value, index) => Object.is(value, dependencies[index]))) return;
        const current = { dependencies };
        effects.set(index, current);
        pendingEffects.push(() => { previous?.cleanup?.(); current.cleanup = effect(); });
      },
    },
    "@xgent/runtime": { invoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "workspace_root_grants_list") return [grant(args.projectId)];
      if (command === "system_pick_folder") return pickDelayed ? new Promise((resolve) => { resolvePick = resolve; }) : "/Reference Files";
      if (command === "workspace_root_grants_apply") {
        if (failedSave) throw new Error("Folder unavailable");
        return args.grants.map((draft, index) => ({ ...grant(args.projectId, draft.id || `saved-${index}`), ...draft }));
      }
      if (command === "workspace_root_grants_revoke") return;
      throw new Error(`Unexpected command ${command}`);
    } },
    "../../i18n": { useLocale: () => ({ t: (key) => key }) },
    "../../lib/skills": { discoverSkills: async () => ({ skills: [{ name: "research" }, { name: "slides" }] }) },
    "../../runtime/applePresentation": { isApplePresentationRuntime: () => true },
    "../../lib/runtimePlatform": { isNativeMobileRuntime: () => false },
    "../../presentation/nativeTheme": { createNativePresentationTheme: () => undefined },
    "../../presentation/NativeSurface": { NativeSurface: "NativeSurface" },
  } });
  const { ProjectRootsSection } = loader.loadModule("src/pages/settings/ProjectRootsSection.tsx");
  const { getDefaultSettings } = loader.loadModule("src/lib/settings/index.ts");
  const { createPresentationActionRegistry } = loader.loadModule("src/presentation/actionRegistry.ts");
  const { validatePresentationDocument } = loader.loadModule("src/presentation/validateDocument.ts");
  let settings = getDefaultSettings();
  settings.system.workspaceProjects = [{ id: "one", name: "One", path: "/one" }, { id: "two", name: "Two", path: "/two" }];
  settings.mcp.servers = [{ id: "enabled", enabled: true }, { id: "disabled", enabled: false }];
  let rendered;
  let request = 0;
  let closed = false;
  const registry = createPresentationActionRegistry();
  const render = () => {
    cursor = 0;
    rendered = ProjectRootsSection({ settings, selectedProjectId, setSettings: (update) => settings = update(settings),
      onBack: () => closed = true, nativeSettingsSurfaceId: "settings:roots" });
    registry.register("roots", rendered.props.handlers);
    validatePresentationDocument({ ...rendered.props.document, surface: "roots", revision: 1, version: 1 }, rendered.props.handlers);
    for (const effect of pendingEffects.splice(0)) effect();
  };
  const nodes = (items) => items.flatMap((node) => [node, ...nodes(node.children ?? [])]);
  const node = (id) => nodes(rendered.props.document.nodes).find((node) => node.id === id);
  const dispatch = async (action, value = null) => {
    const result = await registry.dispatch({ surface: "roots", action, value, requestId: String(++request) });
    render();
    return result;
  };
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  context.after(() => { for (const effect of effects.values()) effect.cleanup?.(); });
  render();
  await settle();
  render();
  assert.equal(rendered.type, "NativeSurface");
  assert.equal(rendered.props.sessionSurface, "settings:roots");
  assert.equal(rendered.props.document.formFactor, "desktop");
  assert.ok(node("root:documents"));
  await dispatch("root:documents:access", "write");
  assert.equal((await dispatch("root:documents:access", "admin")).ok, false);
  assert.equal((await dispatch("root:documents:alias", "a".repeat(40))).acceptedValue.length, 32);
  await dispatch("roots-add");
  const draft = rendered.props.document.nodes.find((item) => item.id.startsWith("root:draft-"));
  assert.ok(draft);
  await dispatch("roots-resource-mode", "custom");
  await dispatch("roots-skills-all");
  await dispatch("roots-mcp-all");
  assert.equal((await dispatch("roots-mcp:disabled", true)).ok, false);
  await dispatch("roots-save");
  const saved = calls.findLast(({ command }) => command === "workspace_root_grants_apply");
  assert.equal(saved.args.projectId, "one");
  assert.equal(saved.args.projectPath, "/one");
  assert.equal(saved.args.grants[0].access, "write");
  assert.equal(saved.args.grants[1].displayPath, "/Reference Files");
  const resource = settings.system.workspaceResourceSettings["/one"];
  assert.deepEqual({ mode: resource.mode, skillNames: resource.skillNames, mcpServerIds: resource.mcpServerIds }, {
    mode: "custom", skillNames: ["research", "slides"], mcpServerIds: ["enabled"],
  });
  failedSave = true;
  await dispatch("roots-save");
  assert.equal(node("roots-error").label, "Folder unavailable");
  failedSave = false;
  await dispatch("roots-revoke");
  assert.equal(rendered.props.document.nodes.some((node) => node.id.startsWith("root:")), false);

  pickDelayed = true;
  const pendingPick = dispatch("roots-add");
  await settle();
  render();
  assert.equal(rendered.props.document.dismissAction, undefined);
  selectedProjectId = "two";
  render();
  render();
  await settle();
  render();
  resolvePick("/Retired Directory");
  await pendingPick;
  assert.equal(node("root:documents:path").value, "/Documents");
  assert.equal(rendered.props.document.nodes.some((node) => node.id.startsWith("root:draft-")), false);
  assert.equal(node("roots-save").disabled, false);
  await dispatch("close");
  assert.equal(closed, true);
});
