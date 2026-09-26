// 构建脚本：把 TypeScript 打包成扩展可加载的 content、worker、UI 与 OCR 产物。
//
// 为什么要打包（而不是像参考项目那样手抄一份共享逻辑）：
//   1. manifest 的 content_scripts 不支持 "type": "module"，content script
//      无法静态 import 共享模块；service worker 可以。不打包就只能复制代码，
//      而复制出来的两份实现必然漂移（参考项目已经踩过：真实扩展显示内部
//      reasonCode，离线夹具却显示中文标签）。
//   2. 打包后 content script 仍输出为经典脚本（iife），worker 输出为 ESM。
//
// 产物落在 extension/dist/，已在 .gitignore 中排除（构建产物不入库）。
// 「加载已解压的扩展程序」选择的目录是 extension/，所以改完代码要重新 build。

import { build, context } from "esbuild";
import { copyFile, mkdir, rm, readFile } from "node:fs/promises";
import { makeOpenCvCspSafe } from "./scripts/opencv-csp.mjs";

const OUT_DIR = "extension/dist";
const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const base = {
  bundle: true,
  sourcemap: true,
  target: "chrome111",
  logLevel: "info",
  legalComments: "none",
};

/** @type {import("esbuild").BuildOptions[]} */
const configs = [
  {
    ...base,
    entryPoints: ["extension/src/content/main.ts"],
    outfile: `${OUT_DIR}/content.js`,
    // content script 必须是经典脚本：manifest 里不能声明 type: module
    format: "iife",
  },
  {
    ...base,
    entryPoints: ["extension/src/background/serviceWorker.ts"],
    outfile: `${OUT_DIR}/service-worker.js`,
    // manifest 里声明了 "type": "module"，所以这里是 ESM
    format: "esm",
  },
  {
    ...base,
    entryPoints: ["extension/src/ui/options.ts"],
    outfile: `${OUT_DIR}/options.js`,
    format: "esm",
  },
  {
    ...base,
    entryPoints: ["extension/src/ui/popup.ts"],
    outfile: `${OUT_DIR}/popup.js`,
    format: "esm",
  },
  {
    ...base,
    entryPoints: ["extension/src/offscreen/ocr.ts"],
    outfile: `${OUT_DIR}/offscreen-ocr.js`,
    format: "esm",
    alias: { "onnxruntime-web": "onnxruntime-web/wasm" },
    plugins: [{
      name: "opencv-mv3-csp",
      setup(build) {
        build.onLoad({ filter: /@techstark[\\/]opencv-js[\\/]dist[\\/]opencv\.js$/ }, async ({ path }) => ({
          contents: makeOpenCvCspSafe(await readFile(path, "utf8")),
          loader: "js",
        }));
      },
    }],
    // OpenCV.js 同时携带 Node/browser 分支；浏览器运行时不会进入 Node 分支。
    external: ["fs", "path"],
  },
];

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });
const ortDir = "extension/vendor/ort";
await mkdir(ortDir, { recursive: true });
await copyFile(
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
  `${ortDir}/ort-wasm-simd-threaded.wasm`,
);
// ORT 根据 wasmPaths 动态导入此加载器；只有 .wasm 时初始化会直接失败。
await copyFile(
  "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs",
  `${ortDir}/ort-wasm-simd-threaded.mjs`,
);

if (watch) {
  const contexts = await Promise.all(configs.map((cfg) => context(cfg)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log(`[build] watching -> ${OUT_DIR}（改完仍需在 chrome://extensions 点刷新）`);
} else {
  await Promise.all(configs.map((cfg) => build(cfg)));
  console.log(`[build] done -> ${OUT_DIR}`);
}
