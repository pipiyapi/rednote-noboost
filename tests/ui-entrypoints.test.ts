import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const extensionRoot = path.resolve("extension");

async function resolveModuleScript(htmlPath: string): Promise<string> {
  const absoluteHtmlPath = path.join(extensionRoot, htmlPath);
  const html = await readFile(absoluteHtmlPath, "utf8");
  const match = html.match(/<script\s+type="module"\s+src="([^"]+)"/);
  const scriptSrc = match?.[1];

  expect(scriptSrc, `${htmlPath} should declare one module script`).toBeTruthy();
  if (!scriptSrc) throw new Error(`${htmlPath} has no module script`);
  return path.resolve(path.dirname(absoluteHtmlPath), scriptSrc);
}

describe("extension UI entrypoints", () => {
  it("本地 OCR 同时包含 ONNX WASM 与配套模块加载器", async () => {
    await expect(access(path.join(extensionRoot, "vendor/ort/ort-wasm-simd-threaded.wasm"))).resolves.toBeUndefined();
    await expect(access(path.join(extensionRoot, "vendor/ort/ort-wasm-simd-threaded.mjs"))).resolves.toBeUndefined();
  });
  it.each([
    ["src/ui/popup.html", "dist/popup.js"],
    ["src/ui/options.html", "dist/options.js"],
    ["src/offscreen/ocr.html", "dist/offscreen-ocr.js"],
  ])("%s loads the built module %s", async (htmlPath, expectedModule) => {
    const resolvedScript = await resolveModuleScript(htmlPath);
    const expectedScript = path.join(extensionRoot, expectedModule);

    expect(resolvedScript).toBe(expectedScript);
    await expect(access(resolvedScript)).resolves.toBeUndefined();
  });

  it("popup 提供开始与暂停按钮，设置页不再重复提供自动扫描开关", async () => {
    const popup = await readFile(path.join(extensionRoot, "src/ui/popup.html"), "utf8");
    const options = await readFile(path.join(extensionRoot, "src/ui/options.html"), "utf8");

    expect(popup).toContain('id="start-scan"');
    expect(popup).toContain('id="pause-scan"');
    expect(options).not.toContain('id="toggle-autoscan"');
  });

  it("两个过滤开关只出现在 popup，不再占用设置页", async () => {
    const popup = await readFile(path.join(extensionRoot, "src/ui/popup.html"), "utf8");
    const options = await readFile(path.join(extensionRoot, "src/ui/options.html"), "utf8");

    expect(popup).toContain('id="toggle-commercial"');
    expect(popup).toContain('id="toggle-emotional"');
    expect(options).not.toContain('id="toggle-commercial"');
    expect(options).not.toContain('id="toggle-emotional"');
  });

  it("manifest 允许 popup 在缺少接收方时注入内容脚本", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(extensionRoot, "manifest.json"), "utf8"),
    ) as { permissions?: string[] };

    expect(manifest.permissions).toContain("scripting");
  });

  it("popup 提供逐帖审计历史，manifest 允许本地 OCR offscreen 运行", async () => {
    const popup = await readFile(path.join(extensionRoot, "src/ui/popup.html"), "utf8");
    const manifest = JSON.parse(
      await readFile(path.join(extensionRoot, "manifest.json"), "utf8"),
    ) as { permissions?: string[]; host_permissions?: string[] };

    expect(popup).toContain('id="history-list"');
    expect(popup).toContain('id="clear-history"');
    expect(popup).toContain("PP-OCRv6 Small");
    expect(manifest.permissions).toContain("offscreen");
    expect(manifest.host_permissions).toContain("https://*.xhscdn.com/*");
    expect(manifest.host_permissions).toContain(
      "https://paddle-model-ecology.bj.bcebos.com/*",
    );
  });
});
