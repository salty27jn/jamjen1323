#!/usr/bin/env node
/**
 * apply-custom.mjs — 幂等重放"本地增强"到作者代码上
 *
 * 背景：本仓库是作者 ai-virtual-phone 的 fork，作者更新代码后（Sync fork / merge），
 * 本脚本自动重新应用以下增强（独立文件在 custom/ 目录，作者文件只做最小挂载点改动）：
 *
 *   1. custom/idb-timeout.ts     —— IndexedDB 初始化超时兜底（防 iOS Safari 卡启动页）
 *   2. custom/splash-tap.tsx     —— 启动页整屏点击进入
 *   3. custom/edge-swipe-back.ts —— 手机壳左边缘右滑返回手势
 *   4. public/sw.js              —— CACHE_VERSION 升到 v6（强制刷新旧缓存）
 *
 * 用法：node apply-custom.mjs [--check]
 *   --check 只检查并报告状态，不做修改（exit 0=全部已应用，1=有缺失）
 *   不带参数 = 检查并自动应用缺失的增强
 *
 * 幂等：每个增强都有唯一锚点，重复运行不会重复插入。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const checkOnly = process.argv.includes("--check");

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}
function write(rel, content) {
  writeFileSync(join(ROOT, rel), content, "utf8");
}

/**
 * 每个增强 = { id, check(), apply() }
 * check: 是否已应用；apply: 执行应用（必须幂等，可安全重复）
 */
const ENHANCEMENTS = [
  {
    id: "custom/idb-timeout.ts 文件存在",
    check: () => existsSync(join(ROOT, "custom", "idb-timeout.ts")),
    apply: () => {},
  },
  {
    id: "custom/splash-tap.tsx 文件存在",
    check: () => existsSync(join(ROOT, "custom", "splash-tap.tsx")),
    apply: () => {},
  },
  {
    id: "custom/edge-swipe-back.ts 文件存在",
    check: () => existsSync(join(ROOT, "custom", "edge-swipe-back.ts")),
    apply: () => {},
  },
  {
    id: "main-app.tsx: import custom 模块",
    check: () => read("components/main-app.tsx").includes('from "@/custom/idb-timeout"'),
    apply: () => {
      const p = join(ROOT, "components", "main-app.tsx");
      const c = readFileSync(p, "utf8");
      if (c.includes('from "@/custom/idb-timeout"')) return;
      const next = c.replace(
        'import { shouldRequestPwaFullscreen } from "@/lib/pwa-display-mode";',
        'import { shouldRequestPwaFullscreen } from "@/lib/pwa-display-mode";\nimport { withTimeout } from "@/custom/idb-timeout";\nimport { SplashTap } from "@/custom/splash-tap";',
      );
      if (next === c) throw new Error("main-app.tsx 锚点未找到（作者可能改过 import 区）");
      writeFileSync(p, next, "utf8");
    },
  },
  {
    id: "main-app.tsx: hydrateKvDb/主题预加载加超时",
    check: () => read("components/main-app.tsx").includes('await withTimeout(hydrateKvDb(), 2000'),
    apply: () => {
      const p = join(ROOT, "components", "main-app.tsx");
      let c = readFileSync(p, "utf8");
      if (c.includes('await withTimeout(hydrateKvDb(), 2000')) return;
      let next = c.replace(
        "await hydrateKvDb();",
        'await withTimeout(hydrateKvDb(), 2000, "IndexedDB 初始化超时，跳过本地数据恢复");',
      );
      next = next.replace(
        "nextPreparedTheme = await prepareDesktopThemeForFirstPaint();",
        'nextPreparedTheme = await withTimeout(prepareDesktopThemeForFirstPaint(), 2000, "主题预加载超时");',
      );
      if (next === c) throw new Error("main-app.tsx 超时锚点未找到");
      writeFileSync(p, next, "utf8");
    },
  },
  {
    id: "main-app.tsx: SplashTap 整屏点击",
    check: () => read("components/main-app.tsx").includes("<SplashTap"),
    apply: () => {
      const p = join(ROOT, "components", "main-app.tsx");
      const c = readFileSync(p, "utf8");
      if (c.includes("<SplashTap")) return;
      const next = c.replace(
        "<SplashScreen ready={hydrated} onEnter={() => setSplashDismissed(true)} />",
        `<SplashTap ready={hydrated} onEnter={() => setSplashDismissed(true)}>\n        <SplashScreen ready={hydrated} onEnter={() => setSplashDismissed(true)} />\n      </SplashTap>`,
      );
      if (next === c) throw new Error("main-app.tsx SplashScreen 锚点未找到");
      writeFileSync(p, next, "utf8");
    },
  },
  {
    id: "desktop-shell.tsx: import useEdgeSwipeBack",
    check: () => read("components/desktop-shell.tsx").includes('from "@/custom/edge-swipe-back"'),
    apply: () => {
      const p = join(ROOT, "components", "desktop-shell.tsx");
      const c = readFileSync(p, "utf8");
      if (c.includes('from "@/custom/edge-swipe-back"')) return;
      const next = c.replace(
        'import { Component, memo, useCallback,',
        'import { useEdgeSwipeBack } from "@/custom/edge-swipe-back";\nimport { Component, memo, useCallback,',
      );
      if (next === c) throw new Error("desktop-shell.tsx import 锚点未找到");
      writeFileSync(p, next, "utf8");
    },
  },
  {
    id: "desktop-shell.tsx: useEdgeSwipeBack 挂载",
    check: () => read("components/desktop-shell.tsx").includes("useEdgeSwipeBack({"),
    apply: () => {
      const p = join(ROOT, "components", "desktop-shell.tsx");
      const c = readFileSync(p, "utf8");
      if (c.includes("useEdgeSwipeBack({")) return;
      const next = c.replace(
        "const shellRef = useRef<HTMLDivElement | null>(null);\n  const glassBusyTimerRef = useRef<number>(0);",
        "const shellRef = useRef<HTMLDivElement | null>(null);\n  useEdgeSwipeBack({\n    containerRef: shellRef,\n    activeAppRef: activeAppRef as React.RefObject<string | null>,\n    onCloseApp: () => setActiveApp(null),\n  });\n  const glassBusyTimerRef = useRef<number>(0);",
      );
      if (next === c) throw new Error("desktop-shell.tsx shellRef 锚点未找到");
      writeFileSync(p, next, "utf8");
    },
  },
  {
    id: "sw.js: CACHE_VERSION v6",
    check: () => read("public/sw.js").includes('CACHE_VERSION = "ai-phone-pwa-v6"'),
    apply: () => {
      const p = join(ROOT, "public", "sw.js");
      const c = readFileSync(p, "utf8");
      if (c.includes("ai-phone-pwa-v6")) return;
      const next = c.replace(
        'CACHE_VERSION = "ai-phone-pwa-v4"',
        'CACHE_VERSION = "ai-phone-pwa-v6"',
      );
      if (next === c) throw new Error("sw.js CACHE_VERSION 锚点未找到");
      writeFileSync(p, next, "utf8");
    },
  },
  {
    id: ".gitignore: 排除构建产物",
    check: () =>
      read(".gitignore").includes(".open-next/") &&
      read(".gitignore").includes(".wrangler/"),
    apply: () => {
      const p = join(ROOT, ".gitignore");
      const c = readFileSync(p, "utf8");
      if (c.includes(".open-next/") && c.includes(".wrangler/")) return;
      const next = c.replace(
        "node_modules/\n",
        "node_modules/\n.open-next/\n.wrangler/\ndeploy-output/\npages-build/\n",
      );
      if (next === c) throw new Error(".gitignore 锚点未找到");
      writeFileSync(p, next, "utf8");
    },
  },
];

let changed = false;
let allApplied = true;

for (const e of ENHANCEMENTS) {
  let ok;
  try {
    ok = e.check();
  } catch (err) {
    console.log(`[apply-custom] ${e.id}: 检查失败 (${err.message})`);
    allApplied = false;
    continue;
  }
  if (ok) {
    console.log(`[apply-custom] ${e.id}: OK`);
    continue;
  }
  allApplied = false;
  console.log(`[apply-custom] ${e.id}: 缺失`);
  if (checkOnly) continue;
  try {
    e.apply();
    changed = true;
    console.log(`[apply-custom]   -> 已应用`);
  } catch (err) {
    console.log(`[apply-custom]   -> 应用失败: ${err.message}`);
  }
}

if (checkOnly) {
  console.log(allApplied ? "[apply-custom] 全部已应用 ✓" : "[apply-custom] 有缺失 ✗");
  process.exit(allApplied ? 0 : 1);
}
console.log(changed ? "[apply-custom] 完成，已应用缺失的增强" : "[apply-custom] 完成，无需改动");