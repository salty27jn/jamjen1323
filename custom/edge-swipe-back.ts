// custom/edge-swipe-back.ts
// 独立增强：手机壳左边缘向右滑动 = 返回手势（与左上角返回箭头行为一致）。
//
// 设计（系统性覆盖所有 app 的返回按钮）：
// 1. 选择器覆盖所有已知"返回按钮"class（chat/日历/checkphone/小红书/共创/宅邸/游戏/自定义APP/设置弹层/音乐/VN/故事/阅读/应用市场…）
// 2. 语义过滤：有 aria-label/title 的按钮必须命中返回语义词（返回/back/关闭/close/退出），
//    避免点到同 class 的"更多/刷新/设置/情节控制"等非返回按钮
// 3. 无说明文字的纯图标返回按钮按 class 白名单通过
// 4. elementFromPoint 验证按钮中心点真的在最上层可见（聊天界面里被窗口盖住的列表返回键不算）
// 5. 找不到返回按钮时才关闭 app 回桌面
//
// 用法：useEdgeSwipeBack({ containerRef, activeAppRef, onCloseApp })
// 独立文件，作者更新时不会动到它。

import { useEffect, useRef } from "react";

const BACK_SELECTOR = [
  ".page-back-btn",
  ".calendar-back-btn",
  ".cp-float-back",
  ".cp-douban-nav-btn",
  ".cp-instagram-nav-btn",
  ".cp-reddit-back-button",
  ".cp-telegram-chat-back",
  ".cp-xhs-detail-back",
  ".cocreate-back-button",
  ".dw-back",
  ".dw2-listback",
  ".game-runtime-floating-back",
  ".cap-btn",
  ".modal-header-btn-muted",
  ".app-market-icon-btn",
  ".story-top-btn",
  ".vns-back",
  ".vnc-btn",
  ".vn-topbar-btn",
  ".vn-history-close",
  ".vn-end-btn",
  ".reading-shelf-back",
  ".music-player-close",
  ".music-settings-close",
  ".music-header-action",
  ".mini-app-btn",
].join(",");

const BACK_WORDS = ["返回", "back", "关闭", "close", "退出"];

// 纯图标返回按钮（无 aria/title/文字说明）：按 class 白名单通过。
// 注意：这些 class 若被"非返回"按钮复用（如 page-back-btn 也被"更多"用），
// 那个复用按钮通常带 aria-label/title，会先被语义规则排除，落不到这里。
const PURE_ICON_BACK_CLASSES = [
  "page-back-btn",
  "calendar-back-btn",
  "cp-float-back",
  "vns-back",
  "vnc-btn",
  "vn-topbar-btn",
  "vn-history-close",
  "dw-back",
  "music-player-close",
  "music-settings-close",
  "music-header-action",
  "game-runtime-floating-back",
];

function isLikelyBackButton(el: HTMLElement): boolean {
  const aria = (el.getAttribute("aria-label") || "").toLowerCase();
  const title = (el.getAttribute("title") || "").toLowerCase();
  const text = (el.textContent || "").trim().toLowerCase();
  const meta = `${aria} ${title}`.trim();
  if (meta) {
    return BACK_WORDS.some((w) => meta.includes(w));
  }
  if (text) {
    return BACK_WORDS.some((w) => text.includes(w));
  }
  return PURE_ICON_BACK_CLASSES.some((c) => el.classList.contains(c));
}

export function useEdgeSwipeBack(options: {
  containerRef: React.RefObject<HTMLElement | null>;
  activeAppRef: React.RefObject<string | null>;
  onCloseApp: () => void;
}) {
  const stateRef = useRef<{ x: number; y: number; done: boolean } | null>(null);
  const { containerRef, activeAppRef, onCloseApp } = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (t.clientX > 24) return; // 只响应左边缘
      stateRef.current = { x: t.clientX, y: t.clientY, done: false };
    };

    const handleTouchMove = (e: TouchEvent) => {
      const s = stateRef.current;
      if (!s || s.done) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (dx > 60 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        s.done = true;
        // 找当前"真正可见"的返回按钮（与左上角箭头行为一致）
        const visibleBack = Array.from(
          document.querySelectorAll<HTMLElement>(BACK_SELECTOR),
        ).find((el) => {
          if (!isLikelyBackButton(el)) return false;
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return false;
          if (r.bottom <= 0 || r.top >= window.innerHeight) return false;
          if (r.right <= 0 || r.left >= window.innerWidth) return false;
          // 中心点必须真的命中该按钮（未被上层遮挡）
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const topEl = document.elementFromPoint(cx, cy);
          return !!topEl && (topEl === el || el.contains(topEl));
        });
        if (visibleBack) {
          visibleBack.click();
        } else if (activeAppRef.current) {
          onCloseApp();
        }
      }
    };

    const handleTouchEnd = () => {
      stateRef.current = null;
    };

    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: true });
    container.addEventListener("touchend", handleTouchEnd);
    container.addEventListener("touchcancel", handleTouchEnd);
    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [containerRef, activeAppRef, onCloseApp]);
}
