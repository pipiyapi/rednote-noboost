import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import vm from "node:vm";
import { makeOpenCvCspSafe } from "../scripts/opencv-csp.mjs";

const require = createRequire(import.meta.url);
const path = require.resolve("@techstark/opencv-js");
const source = readFileSync(path, "utf8");

describe("OpenCV under MV3-style no-JavaScript-eval restrictions", () => {
  it("rejects unexpected dependency versions", () => {
    expect(() => makeOpenCvCspSafe("changed dependency")).toThrow(/needs review/);
  });
  it("loads real WASM and runs image operations without new Function", async () => {
    const context = vm.createContext({
      module: { exports: {} }, exports: {}, require: createRequire(path),
      __dirname: dirname(path), process: { ...process, argv: [], on() {} }, console, Buffer,
      setTimeout, clearTimeout, TextDecoder, TextEncoder,
    }, { codeGeneration: { strings: false, wasm: true } });
    expect(() => vm.runInContext("new Function('return 1')()", context)).toThrow();
    vm.runInContext(makeOpenCvCspSafe(source), context);
    await new Promise((resolve) => context.module.exports.then(() => resolve()));
    const cv = context.module.exports;
    const src = new cv.Mat(8, 8, cv.CV_8UC4, new cv.Scalar(255, 255, 255, 255));
    const dst = new cv.Mat();
    try {
      cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
      expect(dst.rows).toBe(8);
      expect(dst.data[0]).toBe(255);
    } finally { src.delete(); dst.delete(); }
  }, 20000);
});
