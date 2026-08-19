// custom/splash-tap.tsx
// 独立增强：启动页整屏点击进入（点任意位置都可进入，不必只点按钮）。
// 用法：<SplashTap ready={ready} onEnter={onEnter}>{children}</SplashTap>
// 独立文件，作者更新时不会动到它。

import type { ReactNode } from "react";

export function SplashTap({
  ready = false,
  onEnter,
  children,
}: {
  ready?: boolean;
  onEnter?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="custom-splash-tap"
      style={{ cursor: "pointer" }}
      onClick={() => {
        if (ready) onEnter?.();
      }}
    >
      {children}
    </div>
  );
}
