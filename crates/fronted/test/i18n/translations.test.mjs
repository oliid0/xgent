import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const i18n = loader.loadModule("src/i18n/config.ts");

test("supported locales and default locale are stable", () => {
  assert.equal(i18n.DEFAULT_LOCALE, "zh-CN");
  assert.deepEqual([...i18n.SUPPORTED_LOCALES], ["system", "zh-CN", "en-US"]);
  assert.equal(i18n.normalizeLocale("system"), "system");
  assert.equal(i18n.normalizeLocale("en-US"), "en-US");
  assert.equal(i18n.normalizeLocale("fr-FR"), "zh-CN");
});

test("all locales expose the same translation keys", () => {
  const localeKeys = Object.fromEntries(
    Object.entries(i18n.translations).map(([locale, messages]) => [
      locale,
      Object.keys(messages).sort(),
    ]),
  );
  const zhKeys = localeKeys["zh-CN"];
  const enKeys = localeKeys["en-US"];

  assert.deepEqual(
    zhKeys.filter((key) => !enKeys.includes(key)),
    [],
    "en-US is missing keys present in zh-CN",
  );
  assert.deepEqual(
    enKeys.filter((key) => !zhKeys.includes(key)),
    [],
    "zh-CN is missing keys present in en-US",
  );
});

test("translation lookup falls back to the key for unknown entries", () => {
  assert.equal(i18n.t("app.name", "en-US"), "Xgent");
  assert.equal(i18n.t("missing.key", "en-US"), "missing.key");
});

test("translations do not contain encoding replacement characters or question-mark placeholders", () => {
  for (const [locale, messages] of Object.entries(i18n.translations)) {
    for (const [key, value] of Object.entries(messages)) {
      assert.doesNotMatch(value, /\uFFFD|\?{2,}/, `${locale}:${key} contains damaged text`);
    }
  }
  assert.equal(i18n.t("search.title", "zh-CN"), "搜索");
});
