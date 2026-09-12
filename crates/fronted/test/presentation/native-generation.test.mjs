import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { generateNativeComponents, runGeneration } from "../../../../scripts/generate-native-ui.mjs";

const registry = JSON.parse(readFileSync(new URL("../../presentation/astryx-swiftui.json", import.meta.url), "utf8"));
const nativeViewSource = readFileSync(
  new URL("../../src-tauri/native/apple-ui/PresentationView.swift", import.meta.url),
  "utf8",
);
const nativeLayoutSource = readFileSync(
  new URL("../../src-tauri/native/apple-ui/PresentationLayout.swift", import.meta.url),
  "utf8",
);

test("checked-in native declarations agree with the mapping and installed Astryx version", () => {
  runGeneration({ check: true });
  const generated = generateNativeComponents(registry);
  for (const entry of registry.components) {
    assert.ok(generated.swift.includes(`case .${entry.swiftCase}:`));
    assert.ok(generated.types.includes(`"${entry.kind}"`));
  }
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(registry.platforms).map(([platform, value]) => [
        platform,
        [value.renderer, value.formFactor, value.desktopOnlyFeatures],
      ]),
    ),
    {
      ios: ["SwiftUI", "mobile", false],
      macos: ["SwiftUI", "desktop", true],
      android: ["Astryx", "mobile", false],
      windows: ["Astryx", "desktop", true],
      linux: ["Astryx", "desktop", true],
    },
  );
  assert.equal(registry.rendering.applicationUI, "SwiftUI");
  assert.equal(registry.rendering.webContent, "WebKitOnly");
  assert.match(registry.rendering.transportWebView, /Noninteractive/);
  assert.ok(Object.keys(registry.astryxCatalog).length >= 75);
  for (const required of ["Chat", "MobileNav", "MoreMenu", "Lightbox", "TreeList"]) {
    assert.ok(registry.astryxCatalog[required]?.swiftUI);
  }
  assert.equal(registry.version, 2);
  assert.equal(registry.astryxVersion, "0.6.0");
  assert.equal(Object.keys(registry.propertyMappings).length, 39);
  assert.ok(Object.keys(registry.tokens).length >= 35);
  assert.equal(registry.tokens["--color-accent"].target, "palette.accent");
  assert.equal(registry.tokens["--duration-medium"].target, "motion.medium");
  assert.equal(
    registry.tokens["--astryx-theme-xgent-glass-material-blur"].target,
    "material.blur",
  );
  const strategyKinds = Object.values(registry.renderStrategies).flatMap((value) => value.kinds);
  assert.equal(strategyKinds.length, registry.components.length);
  assert.equal(new Set(strategyKinds).size, registry.components.length);
  assert.match(generated.swift, /var renderStrategy: XgentRenderStrategy/);
  assert.match(generated.swift, /var eventSemantics: Set<String>/);
  assert.match(generated.types, /presentationMappedProperties/);
  assert.match(generated.tokens, /presentationTokenMappings/);
});

test("the generator rejects ambiguous mappings instead of silently rendering the wrong control", () => {
  assert.throws(() => generateNativeComponents(null), /mapping/);
  assert.throws(() => generateNativeComponents({ ...registry, components: [] }), /mapping/);
  assert.throws(() => generateNativeComponents({ ...registry, astryxVersion: undefined }), /version/);
  const first = registry.components[0];
  assert.throws(() => generateNativeComponents({ ...registry, components: [first, first] }), /Duplicate/);
  assert.throws(() => generateNativeComponents({
    ...registry, components: [first, { ...first, kind: "Different" }],
  }), /Duplicate/);
  assert.throws(() => generateNativeComponents({
    ...registry, components: [{ ...first, declaration: "" }],
  }), /Invalid/);
  assert.throws(() => generateNativeComponents({ ...registry, templates: {} }), /metadata/);
  assert.throws(() => generateNativeComponents({ ...registry, platforms: {
    ...registry.platforms, ios: { ...registry.platforms.ios, formFactor: "desktop" },
  } }), /platform/);
  assert.throws(() => generateNativeComponents({ ...registry, astryxCatalog: {} }), /catalog/);
  assert.throws(() => generateNativeComponents({ ...registry, propertyMappings: {} }), /property/);
  assert.throws(() => generateNativeComponents({ ...registry, renderStrategies: {} }), /strategy/);
  assert.throws(() => generateNativeComponents({ ...registry, tokens: {
    ...registry.tokens,
    "--duplicate-target": { ...registry.tokens["--color-accent"] },
  } }), /token/);
});

test("native glass keeps grouped surfaces distinct from floating controls", () => {
  assert.match(nativeViewSource, /var floating: Bool/);
  assert.match(
    nativeViewSource,
    /floating \? material\.popoverOpacity : material\.surfaceOpacity/,
  );
  assert.match(nativeViewSource, /buttonBorderShape\(\.roundedRectangle\(radius:/);
  assert.match(nativeViewSource, /struct XgentNodePresentationModifier: ViewModifier/);
  assert.match(
    nativeViewSource,
    /generatedContent\s*\.modifier\(XgentNodePresentationModifier\(/,
  );
  assert.match(
    nativeLayoutSource,
    /XgentGlassSurface\(radius: CGFloat\(presentationTheme\.radius\.chat\), floating: true\)/,
  );
  assert.match(nativeLayoutSource, /child\.icon == nil \? 0 : 36/);
  assert.match(
    nativeLayoutSource,
    /\.frame\(width: 280\)\s*\.frame\(maxHeight: \.infinity, alignment: \.topLeading\)/,
  );
  assert.doesNotMatch(nativeLayoutSource, /\.frame\(width: 280, maxHeight:/);
});
