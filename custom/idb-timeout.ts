// custom/idb-timeout.ts
// 独立增强：给 IndexedDB 初始化等异步步骤加超时兜底。
// 背景：iOS Safari（尤其 PWA/无痕模式）IndexedDB 偶发挂起，导致启动页一直卡在
// "加载中"、进入按钮永远不出现。加超时后即使 IDB 卡死也能继续进入应用。
// 本文件是独立文件，作者更新时不会动到它。

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn("[custom/idb-timeout] timed out:", message);
      reject(new Error(message));
    }, ms);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
