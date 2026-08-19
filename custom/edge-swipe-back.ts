// custom/edge-swipe-back.ts
// 独立增强：手机壳左边缘向右滑动 = 返回手势。
// - 优先点击当前可见的"返回"按钮（.page-back-btn / .calendar-back-btn）→ 返回 app 内上一级
// - 没有可见返回按钮且 app 开着 → 关闭 app 回桌面
// 用法：useEdgeSwipeBack({ containerRef, activeAppRef, onCloseApp })
// 独立文件，作者更新时不会动到它。

import { useEffect, useRef } from "react";

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
        // 返回上一级：优先点击当前可见的"返回"按钮
        const visibleBack = Array.from(
          document.querySelectorAll<HTMLElement>(".page-back-btn, .calendar-back-btn"),
        ).find((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
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
