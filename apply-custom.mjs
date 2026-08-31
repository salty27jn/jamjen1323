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
 *   4. public/sw.js              —— CACHE_VERSION 升到 v7（强制刷新旧缓存）
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
    id: "sw.js: CACHE_VERSION v7",
    check: () => read("public/sw.js").includes('CACHE_VERSION = "ai-phone-pwa-v7"'),
    apply: () => {
      const p = join(ROOT, "public", "sw.js");
      const c = readFileSync(p, "utf8");
      if (c.includes("ai-phone-pwa-v7")) return;
      const next = c.replace(
        'CACHE_VERSION = "ai-phone-pwa-v4"',
        'CACHE_VERSION = "ai-phone-pwa-v7"',
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
  {
    id: "custom/no-photo.ts 文件存在",
    check: () => existsSync(join(ROOT, "custom", "no-photo.ts")),
    apply: () => {},
  },
  {
    id: "rich-message-parser.ts: import noPhotoFilter",
    check: () => read("lib/rich-message-parser.ts").includes('import { noPhotoFilter } from "@/custom/no-photo";'),
    apply: () => {
      const p = join(ROOT, "lib", "rich-message-parser.ts");
      const c = readFileSync(p, "utf8");
      if (c.includes('import { noPhotoFilter } from "@/custom/no-photo";')) return;
      const next = c.replace(
        'import { stripTextToolDirectives } from "./text-tool-protocol";',
        'import { stripTextToolDirectives } from "./text-tool-protocol";\nimport { noPhotoFilter } from "@/custom/no-photo";',
      );
      if (next === c) throw new Error("rich-message-parser.ts import 锚点未找到");
      writeFileSync(p, next, "utf8");
    },
  },
  {
    id: "rich-message-parser.ts: 过滤照片 part",
    check: () => read("lib/rich-message-parser.ts").includes(".filter(noPhotoFilter)"),
    apply: () => {
      const p = join(ROOT, "lib", "rich-message-parser.ts");
      const c = readFileSync(p, "utf8");
      if (c.includes(".filter(noPhotoFilter)")) return;
      const next = c.replace(
        "}).filter(p => p.mediaType || !isInvisibleOrWhitespaceOnly(p.content));",
        "}).filter(p => p.mediaType || !isInvisibleOrWhitespaceOnly(p.content)).filter(noPhotoFilter);",
      );
      if (next === c) throw new Error("rich-message-parser.ts filter 锚点未找到");
      writeFileSync(p, next, "utf8");
    },
  },
  {
    id: "moments-engine.ts: import shouldStripMomentPhoto",
    check: () => read("lib/moments-engine.ts").includes('import { shouldStripMomentPhoto } from "@/custom/no-photo";'),
    apply: () => {
      const p = join(ROOT, "lib", "moments-engine.ts");
      const c = readFileSync(p, "utf8");
      if (c.includes('import { shouldStripMomentPhoto } from "@/custom/no-photo";')) return;
      const next = c.replace(
        'import { prepareShortTermContext } from "./short-term-assembler";',
        'import { prepareShortTermContext } from "./short-term-assembler";\nimport { shouldStripMomentPhoto } from "@/custom/no-photo";',
      );
      if (next === c) throw new Error("moments-engine.ts import 锚点未找到");
      writeFileSync(p, next, "utf8");
    },
  },
  {
    id: "moments-engine.ts: 朋友圈剥离照片",
    check: () => read("lib/moments-engine.ts").includes("const stripMomentPhoto = shouldStripMomentPhoto();"),
    apply: () => {
      const p = join(ROOT, "lib", "moments-engine.ts");
      const c = readFileSync(p, "utf8");
      if (c.includes("const stripMomentPhoto = shouldStripMomentPhoto();")) return;
      const next = c.replace(
        '    const photoDescription = explicitPhotoMatch\n        ? explicitPhotoMatch[2].trim()\n        : legacyPhotoMatch ? legacyPhotoMatch[1].trim() : undefined;\n    const photoUseReferenceImage = explicitPhotoMatch ? explicitPhotoMatch[1] === "使用参考图" : false;',
        '    // 「禁止角色发照片」开启时，朋友圈不再保留照片描述，只发纯文字。\n    const stripMomentPhoto = shouldStripMomentPhoto();\n    const photoDescription = stripMomentPhoto\n        ? undefined\n        : (explicitPhotoMatch\n            ? explicitPhotoMatch[2].trim()\n            : legacyPhotoMatch ? legacyPhotoMatch[1].trim() : undefined);\n    const photoUseReferenceImage = stripMomentPhoto ? false : (explicitPhotoMatch ? explicitPhotoMatch[1] === "使用参考图" : false);',
      );
      if (next === c) throw new Error("moments-engine.ts 朋友圈剥离锚点未找到");
      writeFileSync(p, next, "utf8");
    },
  },
  {
    id: "image-generation-settings.tsx: import no-photo 与 ImageOff",
    check: () => read("components/settings/image-generation-settings.tsx").includes('import { isNoPhotoEnabled, setNoPhotoEnabled } from "@/custom/no-photo";'),
    apply: () => {
      const p = join(ROOT, "components", "settings", "image-generation-settings.tsx");
      let c = readFileSync(p, "utf8");
      if (c.includes('import { isNoPhotoEnabled, setNoPhotoEnabled } from "@/custom/no-photo";')) return;
      let next = c.replace(
        'import { AlertCircle, Camera, ChevronDown, Image, RefreshCw, Sparkles, Trash2, Upload } from "lucide-react";',
        'import { AlertCircle, Camera, ChevronDown, Image, ImageOff, RefreshCw, Sparkles, Trash2, Upload } from "lucide-react";',
      );
      next = next.replace(
        'import { Alert } from "@/components/ui/feedback";\nimport { Input, Select, Textarea, Toggle } from "@/components/ui/form";',
        'import { Alert } from "@/components/ui/feedback";\nimport { Input, Select, Textarea, Toggle } from "@/components/ui/form";\nimport { isNoPhotoEnabled, setNoPhotoEnabled } from "@/custom/no-photo";',
      );
      if (next === c) throw new Error("image-generation-settings.tsx import 锚点未找到");
      writeFileSync(p, next, "utf8");
    },
  },
  {
    id: "image-generation-settings.tsx: 禁止角色发照片开关行（已集成到上游）",
    check: () => {
      const c = read("components/settings/image-generation-settings.tsx");
      return c.includes("isNoPhotoEnabled") && existsSync(join(ROOT, "custom", "no-photo.ts"));
    },
    apply: () => {},
  },
  {
    id: "builtin-preset.ts: moments_post 语言规则",
    check: () => read("lib/builtin-preset.ts").includes("\\u3010\\u8bed\\u8a00\\u89c4\\u5219\\u3011"),
    apply: () => {
      const p = join(ROOT, "lib", "builtin-preset.ts");
      let c = readFileSync(p, "utf8");
      if (c.includes("\\u3010\\u8bed\\u8a00\\u89c4\\u5219\\u3011")) return;
      const anchor = '{{chatBilingualInstruction}}",';
      // 找到 moments_post 区域内的 chatBilingualInstruction（在 moments_post_instruction 标签内）
      const momentsPostStart = c.indexOf("<moments_post_instruction>");
      const momentsPostEnd = c.indexOf("</moments_post_instruction>");
      if (momentsPostStart < 0 || momentsPostEnd < 0) throw new Error("moments_post_instruction 标签未找到");
      const section = c.substring(momentsPostStart, momentsPostEnd);
      const bilingualIdx = section.indexOf(anchor);
      if (bilingualIdx < 0) throw new Error("moments_post 区域内 chatBilingualInstruction 未找到");
      const insertPos = momentsPostStart + bilingualIdx + anchor.length;
      const langRule = '\\n                    "\\u3010\\u8bed\\u8a00\\u89c4\\u5219\\u3011\\u4f60\\u8f93\\u51fa\\u7684\\u8bed\\u8a00\\u5fc5\\u987b\\u4e25\\u683c\\u8ddf\\u968f{{char}}\\u4eba\\u8bbe\\u4e2d\\u6307\\u5b9a\\u7684\\u6bcd\\u8bed\\u3002\\u5982\\u679c{{char}}\\u8bbe\\u5b9a\\u4e3a\\u82f1\\u8bed\\u6bcd\\u8bed\\uff0c\\u5219\\u6240\\u6709\\u5bf9\\u767d\\u5fc5\\u987b\\u7528\\u82f1\\u8bed\\uff1b\\u5982\\u679c\\u8bbe\\u5b9a\\u4e3a\\u65e5\\u8bed\\u6bcd\\u8bed\\uff0c\\u5219\\u6240\\u6709\\u5bf9\\u767d\\u5fc5\\u987b\\u7528\\u65e5\\u8bed\\u3002\\u4ec5\\u5728\\u89d2\\u8272\\u7684\\u5185\\u5fc3\\u72ec\\u767d\\u6216\\u52a8\\u4f5c\\u63cf\\u5199\\u4e2d\\u53ef\\u4f7f\\u7528\\u4e2d\\u6587\\uff08\\u7528\\u62ec\\u53f7\\u5305\\u88f9\\uff09\\u3002",\\n';
      c = c.substring(0, insertPos) + langRule + c.substring(insertPos);
      writeFileSync(p, c, "utf8");
    },
  },
  {
    id: "character-time.ts: 英文时间格式",
    check: () => read("lib/character-time.ts").includes("Sunday"),
    apply: () => {
      const p = join(ROOT, "lib", "character-time.ts");
      let c = readFileSync(p, "utf8");
      if (c.includes("Sunday")) return;
      // WEEKDAYS 中文 -> 英文
      c = c.replace(
        'const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];',
        'const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];'
      );
      // getZonedWeekday locale zh-CN -> en-US
      c = c.replace(
        'new Intl.DateTimeFormat("zh-CN", { timeZone, weekday: "long" }).format(date)',
        'new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(date)'
      );
      // timeContext 中文 -> 英文
      c = c.replaceAll("当前系统时间：，", "System time:  ");
      c = c.replaceAll("角色本地时间： ，", "Character local time:   ");
      writeFileSync(p, c, "utf8");
    },
  },

  // ── 世界隔离：社区贡献代码保护 ──
  {
    id: "chat-message-list.tsx: worldFilterActive",
    check: () => read("components/chat/chat-message-list.tsx").includes("worldFilterActive"),
    apply: () => {
      // 该文件由 .gitattributes merge=ours 保护，此检查仅作验证
      if (!read("components/chat/chat-message-list.tsx").includes("worldFilterActive")) {
        throw new Error("chat-message-list.tsx 缺少世界隔离代码，请检查 .gitattributes");
      }
    },
  },
  {
    id: "chat-contacts-list.tsx: worldFilterActive",
    check: () => read("components/chat/chat-contacts-list.tsx").includes("worldFilterActive"),
    apply: () => {
      if (!read("components/chat/chat-contacts-list.tsx").includes("worldFilterActive")) {
        throw new Error("chat-contacts-list.tsx 缺少世界隔离代码，请检查 .gitattributes");
      }
    },
  },
  {
    id: "phone-character-app.tsx: WorldTabStrip",
    check: () => read("components/phone-character-app.tsx").includes("WorldTabStrip"),
    apply: () => {
      if (!read("components/phone-character-app.tsx").includes("WorldTabStrip")) {
        throw new Error("phone-character-app.tsx 缺少世界管理代码，请检查 .gitattributes");
      }
    },
  },
  // ── 插件 API：暴露角色世界分组数据 ──
  {
    id: "chat-plugin-runtime.ts: import loadCharacterWorldGroups",
    check: () => read("lib/chat-plugin-runtime.ts").includes("import { loadCharacterWorldGroups } from"),
    apply: () => {
      let c = read("lib/chat-plugin-runtime.ts");
      if (!c.includes("loadCharacterWorldGroups")) {
        c = c.replace(
          /import \{ loadCharacters \} from "\.\/character-storage";/,
          'import { loadCharacters } from "./character-storage";\nimport { loadCharacterWorldGroups } from "./character-world-storage";'
        );
        write("lib/chat-plugin-runtime.ts", c);
      }
    },
  },
  {
    id: "chat-plugin-runtime.ts: characterWorlds API",
    check: () => read("lib/chat-plugin-runtime.ts").includes("characterWorlds:"),
    apply: () => {
      let c = read("lib/chat-plugin-runtime.ts");
      if (!c.includes("characterWorlds:")) {
        c = c.replace(
          /characters: \{[\s\S]*?list: \(\) => loadCharacters\(\),[\s\S]*?get: \(id\) => loadCharacters\(\)\.find\(c => c\.id === id\) \?\? null,[\s\S]*?\},/,
          `characters: {
                    list: () => loadCharacters(),
                    get: (id) => loadCharacters().find(c => c.id === id) ?? null,
                },
                characterWorlds: {
                    list: () => loadCharacterWorldGroups(),
                    get: (id) => loadCharacterWorldGroups().find(g => g.id === id) ?? null,
                    getByCharacterId: (characterId) => loadCharacterWorldGroups().find(g => g.memberIds.includes(characterId)) ?? null,
                },`
        );
        write("lib/chat-plugin-runtime.ts", c);
      }
    },
  },];

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