// custom/reasoning-copy.ts
// 独立增强：给聊天「思考过程」（思维链）底部弹窗加一个"复制"按钮，
// 方便把模型思维链原文复制出来贴给别人诊断。
//
// 设计：
// - 通过 apply-custom.mjs 注入到 components/chat/chat-room.tsx（最小挂载点）。
// - 独立文件，作者更新时不会动到它；Sync fork 后 apply-custom.mjs 自动重放。
// - 用 MutationObserver 监听 .chat-reasoning-sheet 弹窗出现/重建，注入复制按钮并守住。
// - 复制逻辑优先取"原文"（splitBilingual 第一个 section），避免把中文翻译一起复制。
// - 用 kv 存一个开关（默认开启），可随时关闭。

import { kvGet, kvSet } from "@/lib/kv-db";

const COPY_TOGGLE_KEY = "ai_phone_reasoning_copy_v1";

export function isReasoningCopyEnabled(): boolean {
    return kvGet(COPY_TOGGLE_KEY) !== "false";
}

export function setReasoningCopyEnabled(value: boolean): void {
    kvSet(COPY_TOGGLE_KEY, value ? "1" : "false");
}

// 从弹窗里提取要复制的思维链文本
function grabText(sheet: HTMLElement): string {
    const body = sheet.querySelector<HTMLElement>(".chat-reasoning-sheet-body");
    if (!body) return "";
    // 有 splitBilingual 结构时，优先第一个原文区；否则整段剥掉 UI 控件取正文
    const firstSection = body.querySelector<HTMLElement>(".chat-bilingual-section");
    if (firstSection) {
        const content = firstSection.querySelector<HTMLElement>(".chat-bilingual-content");
        return (content ? content.innerText : firstSection.innerText).trim();
    }
    const clone = body.cloneNode(true) as HTMLElement;
    clone
        .querySelectorAll(".chat-bilingual-toggle, .chat-reasoning-view-switch, .chat-reasoning-translate-error")
        .forEach((n) => n.remove());
    return clone.innerText.trim();
}

function copyText(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    return fallbackCopy(text);
}

function fallbackCopy(text: string): Promise<void> {
    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        return Promise.resolve();
    } catch {
        return Promise.reject(new Error("copy failed"));
    }
}

const COPY_ICON_SVG =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const CHECK_ICON_SVG =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

const BTN_CLASS = "reasoning-copy-btn";

function injectStyle() {
    if (document.getElementById("reasoning-copy-style")) return;
    const style = document.createElement("style");
    style.id = "reasoning-copy-style";
    style.textContent = `
      .${BTN_CLASS} {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        border: none;
        background: transparent;
        color: var(--c-icon, rgba(0,0,0,0.6));
        cursor: pointer;
        flex: none;
      }
      .${BTN_CLASS}:active { opacity: 0.5; }
      .${BTN_CLASS}.reasoning-copy-copied { color: #16a34a; }
    `;
    document.head.appendChild(style);
}

function decorateSheet(sheet: HTMLElement): void {
    if (sheet.querySelector(`.${BTN_CLASS}`)) return;
    if (!isReasoningCopyEnabled()) return;

    const header = sheet.querySelector<HTMLElement>(".chat-reasoning-sheet-header");
    if (!header) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN_CLASS;
    btn.setAttribute("aria-label", "复制思维链");
    btn.title = "复制思维链";
    btn.innerHTML = COPY_ICON_SVG;

    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const text = grabText(sheet);
        if (!text) {
            toast("没有可复制的思维链内容");
            return;
        }
        copyText(text)
            .then(() => {
                btn.classList.add("reasoning-copy-copied");
                btn.innerHTML = CHECK_ICON_SVG;
                toast("思维链已复制");
                setTimeout(() => {
                    btn.classList.remove("reasoning-copy-copied");
                    btn.innerHTML = COPY_ICON_SVG;
                }, 1500);
            })
            .catch(() => toast("复制失败，请手动选择文本复制"));
    });

    // 放在关闭按钮(X)前面，与翻译/关闭并列
    const closeBtn = header.querySelector<HTMLElement>(".chat-reasoning-sheet-close");
    if (closeBtn && closeBtn.parentNode === header) {
        header.insertBefore(btn, closeBtn);
    } else {
        header.appendChild(btn);
    }
}

// 复用聊天已有的 toast UI（chat-room 监听 CHAT_PLUGIN_TOAST_EVENT = "chat-plugin-toast"，
// 播放 detail.text，缺省 2400ms）。事件名是硬编码的宿主常量，避免跨模块 import。
function toast(msg: string): void {
    try {
        window.dispatchEvent(new CustomEvent("chat-plugin-toast", { detail: { text: msg } }));
    } catch {
        /* 静默失败，不影响复制 */
    }
}

/**
 * 挂载思维链复制功能（在 chat-room 里调用一次）。
 * 返回清理函数：卸载时断开观察器并移除按钮。
 */
export function mountReasoningCopy(): () => void {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
        return () => {};
    }
    injectStyle();

    const scan = () => {
        if (!isReasoningCopyEnabled()) return;
        document.querySelectorAll<HTMLElement>(".chat-reasoning-sheet").forEach(decorateSheet);
    };
    scan();

    const mo = new MutationObserver(scan);
    mo.observe(document.documentElement, { childList: true, subtree: true });

    return () => {
        mo.disconnect();
        document.querySelectorAll(`.${BTN_CLASS}`).forEach((n) => n.remove());
    };
}
