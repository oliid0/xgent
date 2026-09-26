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
const nativeMobileSource = readFileSync(
  new URL("../../src-tauri/native/apple-ui/PresentationMobile.swift", import.meta.url),
  "utf8",
);
const nativeMobileNodeSource = readFileSync(
  new URL("../../src-tauri/native/apple-ui/PresentationMobileNode.swift", import.meta.url),
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
  for (const modifier of ["Insets", "FixedFrame", "BoundsFrame", "TextLayout", "Control"]) {
    assert.match(nativeViewSource, new RegExp(`struct XgentNode${modifier}Modifier: ViewModifier`));
  }
  assert.match(
    nativeViewSource,
    /AnyView\(generatedContent\)[\s\S]*?\.modifier\(XgentNodeFixedFrameModifier\([\s\S]*?\.modifier\(XgentNodeBoundsFrameModifier\(/,
  );
  assert.match(
    nativeLayoutSource,
    /XgentGlassSurface\(radius: CGFloat\(presentationTheme\.radius\.chat\), floating: true\)/,
  );
  assert.match(nativeLayoutSource, /child\.icon == nil \? 0 : 36/);
  assert.match(nativeViewSource, /Picker\(node\.label \?\? "", selection: textBinding\)/);
  assert.match(nativeViewSource, /picker\.pickerStyle\(\.menu\)\.labelsHidden\(\)/);
  assert.match(nativeViewSource, /Form \{[\s\S]*?\.formStyle\(\.grouped\)/);
  assert.doesNotMatch(nativeViewSource, /\.presentationBackground\(/);
  assert.match(nativeLayoutSource, /List\(node\.children \?\? \[\]\)/);
  assert.match(nativeLayoutSource, /document\.formFactor == \.mobile[\s\S]*?\.listStyle\(\.insetGrouped\)/);
  assert.match(nativeLayoutSource, /\.listStyle\(\.sidebar\)/);
  assert.match(nativeLayoutSource, /var nativeSettingsGroup: some View \{\s*Section \{/);
  assert.match(nativeLayoutSource, /return NavigationSplitView \{/);
  assert.match(nativeLayoutSource, /HSplitView \{/);
  assert.match(nativeLayoutSource, /@AppStorage\("xgent\.native\.sidebar-width\.v1"\)/);
});

test("the complete iOS application surface is handwritten and bypasses generated mappings", () => {
  assert.match(nativeMobileSource, /struct XgentIOSRootPresentation: View/);
  assert.match(nativeMobileSource, /struct XgentIOSWorkspacePresentation: View/);
  assert.match(nativeMobileSource, /struct XgentIOSPagePresentation: View/);
  assert.match(nativeMobileSource, /struct XgentIOSSheetPresentation: View/);
  assert.doesNotMatch(nativeMobileSource, /\.safeAreaInset\(edge: \.bottom/);
  assert.match(nativeMobileSource, /if !isObscured, let composer \{\s*XgentIOSComposer\(node: composer/);
  assert.doesNotMatch(nativeMobileSource, /NavigationStack \{/);
  assert.doesNotMatch(nativeMobileSource, /@ToolbarContentBuilder/);
  assert.doesNotMatch(nativeMobileSource, /ToolbarItem\(placement:/);
  assert.match(nativeMobileSource, /\.frame\(minHeight: 68\)/);
  assert.match(nativeMobileSource, /geometry\.size\.width \* 0\.85/);
  assert.match(nativeMobileSource, /\.safeAreaBar\(edge: \.bottom/);
  assert.match(nativeMobileSource, /\.onScrollGeometryChange\(for: Bool\.self\)/);
  assert.match(nativeMobileSource, /\.onScrollPhaseChange/);
  assert.doesNotMatch(nativeMobileSource, /Form \{|\.formStyle\(|\.listStyle\(/);
  assert.match(
    nativeMobileSource,
    /list == nil \? \[\.large\] : \[\.fraction\(0\.62\), \.large\][\s\S]*?\.presentationDetents\(detents\)/,
  );
  assert.match(nativeMobileSource, /\.presentationDragIndicator\(\.hidden\)/);
  assert.match(nativeMobileSource, /Capsule\(\)[\s\S]*?\.frame\(width: 40, height: 4\)/);
  assert.doesNotMatch(nativeMobileSource, /WebView|WKWebView|UIViewRepresentable/);
  assert.match(nativeMobileNodeSource, /struct XgentIOSNode: View/);
  assert.match(nativeMobileNodeSource, /switch node\.kind/);
  assert.match(nativeMobileNodeSource, /case \.composerInput:/);
  assert.match(nativeMobileNodeSource, /case \.settingsGroup:/);
  assert.match(nativeMobileNodeSource, /case \.browserViewport:/);
  assert.match(nativeMobileNodeSource, /XgentAttachmentPicker/);
  assert.match(nativeMobileNodeSource, /Menu \{ menuItems \} label:/);
  assert.match(nativeMobileNodeSource, /parentAxis != \.horizontal/);
  assert.match(nativeMobileNodeSource, /case \.list:\s*list/);
  assert.match(nativeMobileNodeSource, /case \.settingsGroup:\s*settingsGroup/);
  assert.doesNotMatch(nativeMobileNodeSource, /\.map\(CGFloat\.init\)/);
  for (const source of [nativeMobileSource, nativeMobileNodeSource]) {
    assert.doesNotMatch(source, /XgentNodeView|XgentNodeChildren|generatedContent/);
  }
  assert.match(nativeViewSource, /#if os\(iOS\)\s*XgentIOSSheetPresentation/);
  assert.match(nativeMobileSource, /sheets\.firstIndex\(where: \{ \$0\.id == document\.id \}\)/);
  assert.match(nativeMobileSource, /return sheets\[index \+ 1\]/);
  assert.match(nativeMobileSource, /\.sheet\(item: Binding\(get: \{ nextSheet \}/);
  assert.match(nativeMobileSource, /model\.dismiss\(nextSheet\)/);
  assert.match(nativeMobileSource, /AnyView\(XgentIOSSheetPresentation\(initialDocument: next, model: model\)\)/);
  assert.match(nativeMobileSource, /XgentAlerts\(model: model, enabled: nextSheet == nil\)/);
  assert.match(nativeMobileSource, /XgentIOSChatPresentation\(document: document, model: model, isObscured: sidebar != nil\)/);
  assert.match(
    nativeLayoutSource,
    /root\.formFactor == \.mobile[\s\S]*?XgentIOSRootPresentation[\s\S]*?XgentIOSWorkspacePresentation/,
  );
  assert.match(nativeLayoutSource, /else \{\s*XgentIOSPagePresentation\(document: root, sidebar: sidebar/);
});
