import assert from "node:assert/strict";
import test from "node:test";
import { rotateImageInBrowser } from "../helpers/document-annotation-browser.mjs";
import { imageFixture, pngPixels } from "../helpers/image-fixture.mjs";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";
const { imageRotationFormat, validImageRotation, normalizeImageRotation, remainingImageRotation, hasImageRotationDraft, workspaceImagePaths } =
  createTsModuleLoader().loadModule("src/components/workspace-editor/workspaceImageOperations.ts");

test("image policy retains format, quarter-turn bounds, path order and absolute draft angles", () => {
  assert.equal(imageRotationFormat("picture.JPG", "IMAGE/JPEG; charset=binary"), "image/jpeg");
  assert.equal(imageRotationFormat("picture.jpg", "image/png"), null);
  assert.equal(imageRotationFormat("picture.gif", "image/gif"), null);
  for (const angle of [-90, 360, 45, NaN, "90"]) assert.equal(validImageRotation(angle), false);
  assert.equal(normalizeImageRotation(-90), 270);
  assert.deepEqual(workspaceImagePaths(["b.png", "b.png", ""], "a.png"), ["b.png", "a.png"]);
  const later = remainingImageRotation({ angle: 180, saved: 0, editable: true }, { angle: 90, saved: 0, editable: true });
  assert.deepEqual(later, { angle: 180, saved: 90, editable: true });
  assert.equal(hasImageRotationDraft(later), true);
  assert.equal(hasImageRotationDraft({ angle: 90, saved: 90, editable: true }), false);
});

test("the shared raster implementation rotates actual PNG pixels clockwise and preserves original bytes at zero", async () => {
  const bytes = imageFixture(), original = pngPixels(bytes);
  const clockwise = pngPixels(await rotateImageInBrowser(bytes, "image/png", 90));
  assert.equal(clockwise.width, 3); assert.equal(clockwise.height, 2);
  assert.deepEqual(clockwise.pixels, [original.pixels[4], original.pixels[2], original.pixels[0], original.pixels[5], original.pixels[3], original.pixels[1]]);
  const upsideDown = pngPixels(await rotateImageInBrowser(bytes, "image/png", 180));
  assert.deepEqual(upsideDown.pixels, original.pixels.toReversed());
  assert.deepEqual(Buffer.from(await rotateImageInBrowser(bytes, "image/png", 0)), bytes);
});

test("image encoding returns the requested real format and rejects a browser's PNG fallback", async () => {
  const bytes = imageFixture();
  const jpeg = await rotateImageInBrowser(bytes, "image/jpeg", 90);
  assert.equal(jpeg[0], 255); assert.equal(jpeg[1], 216);
  const webp = Buffer.from(await rotateImageInBrowser(bytes, "image/webp", 90));
  assert.equal(webp.toString("ascii", 0, 4), "RIFF"); assert.equal(webp.toString("ascii", 8, 12), "WEBP");
  await assert.rejects(() => rotateImageInBrowser(bytes, "image/webp", 90, true), /cannot be encoded/);
  await assert.rejects(() => rotateImageInBrowser(bytes, "image/gif", 90), /Unsupported/);
});
