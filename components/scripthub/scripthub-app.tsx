"use client";

// 剧本工坊 · 正式版应用（桌面入口注册于 desktop-shell）
// 屏1 主页：真实剧本数据（空状态 + 导入入口 + 卡片列表）
// 屏2 准备工作：剧本信息真实化，NPC/面具/绑定链路逐步接入
// 屏3 游戏进行中：后续接引擎（暂占位）

import { useState, useRef, useEffect, useCallback } from "react";
import { ArrowLeft, Plus, Play, Trash2, MoreHorizontal, LoaderCircle, Check, ChevronLeft } from "lucide-react";
import {
  loadScripts,
  createScript,
  updateScript,
  deleteScript,
  getScript,
  parseScriptText,
  hydrateScripthubStorage,
  nextAvailableEmoji,
  ensureScriptNpcs,
  ensureScriptSessions,
  cleanupScriptWorldBooks,
  type ScripthubScript,
  type ScriptTurnMessage,
} from "@/lib/scripthub-storage";
import { decodeTxtArrayBuffer } from "@/lib/reading-parser";
import { loadUserIdentities } from "@/lib/settings-storage";
import type { UserIdentity } from "@/components/settings/user-identity";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { runScriptTurn, applyStateChanges, formatScriptStats, deliverLinkedMessages, deliverLinkedPosts, deliverLinkedCalendar, deliverLinkedDiary, rollD20 } from "@/lib/scripthub-engine";
import { ChatPageHeader } from "@/components/chat/chat-page-header";
import { MessageBubble } from "@/components/chat/message-bubble";
import type { ChatMessage } from "@/lib/chat-storage";

type View = "home" | "setup" | "playing";

/* ── 正文字号（剧本工坊局部，独立于全局，持久化到本地） ── */
const FONT_SCALE_KEY = "scripthub-font-scale";
const FONT_SCALE_MIN = 0.85;
const FONT_SCALE_MAX = 1.6;

function clampFontScale(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(v * 100) / 100));
}

function loadFontScale(): number {
  if (typeof window === "undefined") return 1;
  try {
    const v = parseFloat(window.localStorage.getItem(FONT_SCALE_KEY) || "");
    return Number.isFinite(v) && v >= FONT_SCALE_MIN && v <= FONT_SCALE_MAX ? v : 1;
  } catch { return 1; }
}

function saveFontScale(v: number) {
  try { window.localStorage.setItem(FONT_SCALE_KEY, String(v)); } catch { /* 存储不可用时静默降级为会话内生效 */ }
}

const S: Record<string, React.CSSProperties> = {
  root: { position: "absolute", inset: 0, background: "#0a0a0f", display: "flex", flexDirection: "column", fontFamily: "'PingFang SC', system-ui, sans-serif", color: "#e0dcd5", overflow: "hidden" },
  header: {
    height: "var(--page-header-content-height, 42px)",
    marginTop: "var(--page-header-safe-top, 48px)",
    padding: "1px 20px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexShrink: 0,
  },
  btn: { width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer" },
  body: { flex: 1, overflow: "auto", padding: "0 20px 96px" },
  card: { padding: "14px 16px", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", marginBottom: 10 },
  label: { fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(200,160,100,0.5)", marginBottom: 6, letterSpacing: "0.08em" },
};

export function ScriptHubApp({ onClose, onOpenSettings }: { onClose: () => void; onOpenSettings: () => void }) {
  const [view, setView] = useState<View>("home");
  const [scripts, setScripts] = useState<ScripthubScript[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [fontScale, setFontScale] = useState<number>(() => loadFontScale());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const changeFontScale = useCallback((v: number) => {
    const clamped = clampFontScale(v);
    setFontScale(clamped);
    saveFontScale(clamped);
  }, []);

  useEffect(() => {
    let cancelled = false;
    hydrateScripthubStorage().then(() => {
      if (cancelled) return;
      setScripts(loadScripts());
    });
    return () => { cancelled = true; };
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setImportError(null);
    if (!/\.(txt|json)$/i.test(file.name)) {
      setImportError("暂只支持 .txt / .json 剧本文件");
      return;
    }
    setImporting(true);
    try {
      if (/\.json$/i.test(file.name)) {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const name = typeof parsed?.name === "string" ? parsed.name : file.name.replace(/\.json$/i, "");
        const content = typeof parsed?.content === "string" ? parsed.content : text;
        const info = parseScriptText(content, file.name);
        const existing = loadScripts().find(s => s.fileName === file.name);
        if (existing) {
          updateScript(existing.id, { name: name || info.title, content, mode: info.mode, status: "not_started", round: 1, stats: {}, statsMax: {} });
          setSelectedId(existing.id);
        } else {
          const script = createScript({ name: name || info.title, fileName: file.name, content, mode: info.mode, emoji: nextAvailableEmoji() });
          setSelectedId(script.id);
        }
      } else {
        const buffer = await file.arrayBuffer();
        const { text } = decodeTxtArrayBuffer(buffer);
        if (!text.trim()) {
          setImportError("文件内容为空或无法解码");
          return;
        }
        const info = parseScriptText(text, file.name);
        const existing = loadScripts().find(s => s.fileName === file.name);
        if (existing) {
          updateScript(existing.id, { name: info.title, content: text, mode: info.mode, status: "not_started", round: 1, stats: {}, statsMax: {} });
          setSelectedId(existing.id);
        } else {
          const script = createScript({ name: info.title, fileName: file.name, content: text, mode: info.mode, emoji: nextAvailableEmoji() });
          setSelectedId(script.id);
        }
      }
      setScripts(loadScripts());
      setView("setup");
    } catch (err) {
      console.warn("[ScriptHub] import failed:", err);
      setImportError(err instanceof Error ? err.message : "导入失败");
    } finally {
      setImporting(false);
    }
  }, []);

  const handleDelete = useCallback((id: string) => {
    if (!window.confirm("删除剧本将解除全部绑定（不影响已创建的联系人）。确定删除？")) return;
    deleteScript(id);
    cleanupScriptWorldBooks(id);
    setScripts(loadScripts());
  }, []);

  if (view === "playing" && selectedId) {
    return <PlayingScreen scriptId={selectedId} onBack={() => { setView("setup"); }} onClose={onClose} fontScale={fontScale} onFontScale={changeFontScale} />;
  }

  if (view === "setup" && selectedId) {
    return (
      <SetupScreen
        scriptId={selectedId}
        onBack={() => { setView("home"); setScripts(loadScripts()); }}
        onClose={onClose}
        onStart={() => setView("playing")}
        onOpenSettings={onOpenSettings}
      />
    );
  }

  return (
    <HomeScreen
      scripts={scripts}
      importing={importing}
      importError={importError}
      onPickFile={() => fileInputRef.current?.click()}
      onEnter={id => {
        setSelectedId(id);
        // 首次准备已完成（NPC 角色卡 + 面具齐备）→ 直接续玩游戏，跳过准备工作
        const s = getScript(id);
        if (s && s.npcIds.length > 0 && s.userIdentityId) setView("playing");
        else setView("setup");
      }}
      onDelete={handleDelete}
      onClose={onClose}
      fileInputRef={fileInputRef}
      onFile={handleFile}
    />
  );
}

/* ── 屏1 · 剧本工坊主页（真实数据） ── */
function HomeScreen({
  scripts, importing, importError, onPickFile, onEnter, onDelete, onClose, fileInputRef, onFile,
}: {
  scripts: ScripthubScript[];
  importing: boolean;
  importError: string | null;
  onPickFile: () => void;
  onEnter: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
}) {
  return (
    <div style={S.root}>
      <div style={S.header}>
        <button style={S.btn} onClick={onClose}><ArrowLeft size={20} /></button>
        <span style={{ fontSize: "calc(13px*var(--app-text-scale,1))", letterSpacing: "0.2em", color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
          剧本工坊
        </span>
        <button style={S.btn} onClick={onPickFile}><Plus size={20} /></button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.json"
        style={{ display: "none" }}
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />

      <div style={S.body}>
        {scripts.length === 0 && (
          <div style={{ textAlign: "center", padding: "72px 24px 40px" }}>
            <div style={{ fontSize: "calc(34px*var(--app-text-scale,1))", marginBottom: 14, opacity: 0.6 }}>🎭</div>
            <div style={{ fontSize: "calc(15px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.75)", fontWeight: 500 }}>还没有剧本</div>
            <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.35)", marginTop: 6, lineHeight: 1.7 }}>
              导入你的原创剧本（.txt / .json）
              <br />引擎会自动解析角色卡并接入聊天联动
            </div>
          </div>
        )}

        {importError && (
          <div style={{ ...S.card, border: "1px solid rgba(255,100,80,0.35)", color: "rgba(255,140,120,0.9)", fontSize: "calc(12px*var(--app-text-scale,1))" }}>
            {importError}
          </div>
        )}

        {scripts.map(w => (
          <div key={w.id} style={S.card}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: "calc(20px*var(--app-text-scale,1))" }}>{w.emoji}</span>
              <div style={{ fontSize: "calc(15px*var(--app-text-scale,1))", fontWeight: 600, flex: 1, minWidth: 0 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{w.name}</span>
                {w.status === "playing" && <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(200,255,180,0.7)", marginLeft: 0, fontWeight: 400 }}>进行中 · 第{w.round}回合</span>}
                {w.status === "preparing" && <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,220,160,0.7)", marginLeft: 0, fontWeight: 400 }}>准备中</span>}
              </div>
            </div>
            <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.35)", marginBottom: 10, lineHeight: 1.6, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
              {w.content.replace(/\s+/g, " ").trim().slice(0, 120)}...
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => onEnter(w.id)} style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", color: "#e0dcd5", fontSize: "calc(12px*var(--app-text-scale,1))", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, fontFamily: "inherit" }}>
                <Play size={12} /> {w.status === "playing" ? "继续" : "进入"}
              </button>
              <button onClick={() => onDelete(w.id)} style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(255,100,80,0.2)", background: "transparent", color: "rgba(255,100,80,0.6)", fontSize: "calc(12px*var(--app-text-scale,1))", cursor: "pointer" }}>
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}

        <div onClick={onPickFile} style={{ ...S.card, border: "1.5px dashed rgba(255,255,255,0.15)", background: "transparent", textAlign: "center", cursor: "pointer", padding: "18px 16px" }}>
          {importing ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "rgba(255,255,255,0.6)", fontSize: "calc(13px*var(--app-text-scale,1))" }}>
              <LoaderCircle size={16} style={{ animation: "spin 1s linear infinite" }} /> 正在解析…
            </div>
          ) : (
            <>
              <div style={{ fontSize: "calc(13px*var(--app-text-scale,1))", color: "rgba(200,160,100,0.8)", fontWeight: 500 }}>＋ 导入新剧本</div>
              <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.3)", marginTop: 4 }}>支持 .txt / .json 原创剧本文件</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── 屏2 · 准备工作（真实剧本数据，NPC/面具/绑定链路） ── */
function SetupScreen({ scriptId, onBack, onClose, onStart, onOpenSettings }: { scriptId: string; onBack: () => void; onClose: () => void; onStart: () => void; onOpenSettings: () => void }) {
  const [script, setScript] = useState<ScripthubScript | null>(() => getScript(scriptId));
  const [npcs, setNpcs] = useState<Character[]>([]);
  const [identities, setIdentities] = useState<UserIdentity[]>([]);
  const [generatingNpcs, setGeneratingNpcs] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const refresh = useCallback(() => {
    const s = getScript(scriptId);
    setScript(s ? { ...s } : null);
    if (s && s.npcIds.length) {
      const chars = loadCharacters();
      setNpcs(s.npcIds.map(id => chars.find(c => c.id === id)).filter((c): c is Character => Boolean(c)));
    }
    setIdentities(loadUserIdentities());
  }, [scriptId]);

  useEffect(() => {
    refresh();
    // 首次进入：若剧本尚未生成 NPC 卡，自动生成（原文搬运）
    const s = getScript(scriptId);
    if (s && s.npcIds.length === 0) {
      setGeneratingNpcs(true);
      ensureScriptNpcs(scriptId);
      setGeneratingNpcs(false);
      refresh();
    }
    // 无面具不自动跳走：准备页已有内联引导（用户主动点「前往设置创建面具」），不强制打断
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptId]);

  if (!script) return null;

  const npcReady = script.npcIds.length > 0;
  const maskReady = Boolean(script.userIdentityId);
  const allReady = npcReady && maskReady;

  const pickMask = (id: string) => {
    updateScript(scriptId, { userIdentityId: id });
    refresh();
  };

  return (
    <div style={S.root}>
      <div style={S.header}>
        <button style={S.btn} onClick={onBack}><ArrowLeft size={20} /></button>
        <span style={{ fontSize: "calc(13px*var(--app-text-scale,1))", letterSpacing: "0.2em", color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
          准备工作
        </span>
        <button style={S.btn} onClick={() => setMenuOpen(true)} aria-label="更多"><MoreHorizontal size={20} /></button>
      </div>

      {menuOpen && (
        <ScriptHubMenu
          onClose={() => setMenuOpen(false)}
          actions={[
            { label: "返回剧本列表", onClick: onBack },
            { label: "退出剧本工坊", onClick: onClose, danger: true },
          ]}
        />
      )}

      <div style={S.body}>
        {/* ── 剧本 ── */}
        <div style={{ marginBottom: 14 }}>
          <div style={S.label}>剧 本</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: "calc(22px*var(--app-text-scale,1))" }}>{script.emoji}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "calc(15px*var(--app-text-scale,1))", fontWeight: 600 }}>{script.name}</div>
              <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.35)" }}>
                {script.fileName}
              </div>
            </div>
            <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(140,220,160,0.8)" }}>✓ 已导入</span>
          </div>
        </div>

        {/* ── NPC 角色卡 ── */}
        <div style={S.card}>
          <div style={S.label}>NPC 角色卡（引擎自动生成 · 原文搬运零改编）</div>
          {generatingNpcs ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "rgba(255,255,255,0.5)", fontSize: "calc(12px*var(--app-text-scale,1))" }}>
              <LoaderCircle size={15} style={{ animation: "spin 1s linear infinite" }} /> 正在按剧本原文生成角色卡…
            </div>
          ) : npcReady ? (
            npcs.map(npc => (
              <div key={npc.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, background: "rgba(0,0,0,0.3)", marginBottom: 6 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg,#45A8A0,#2a6a64)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
                  {npc.name.slice(0, 1)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "calc(13px*var(--app-text-scale,1))", fontWeight: 600 }}>{npc.name}</div>
                  <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {npc.persona.split("\n")[1]?.replace(/^(性别|职业\/身分|外貌|MBTI\/性格|年龄)\s*[:：]?\s*/, "") || npc.persona.split("\n").slice(1).join(" ").slice(0, 60) || "已按原文生成"}
                  </div>
                </div>
                <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(140,220,160,0.8)" }}>✓ 已入联系人</span>
              </div>
            ))
          ) : (
            <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.3)", lineHeight: 1.7 }}>
              首次进入游戏时，引擎将按剧本原文自动生成 NPC 角色卡并加入联系人。
            </div>
          )}
        </div>

        {/* ── 面具 ── */}
        <div style={S.card}>
          <div style={S.label}>你的面具（你是谁）</div>
          {identities.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.3)", lineHeight: 1.7 }}>
                首次进入需要先创建一个面具（你在剧本里的身份）。点击下方前往系统设置创建，完成后返回即可在此选择。
              </div>
              <button onClick={onOpenSettings} style={S_primaryBtn}>
                前往设置创建面具
              </button>
            </div>
          ) : (
            identities.map(id => {
              const selected = script.userIdentityId === id.id;
              return (
                <div
                  key={id.id}
                  onClick={() => pickMask(id.id)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, background: selected ? "rgba(140,220,160,0.08)" : "rgba(0,0,0,0.3)", border: selected ? "1px solid rgba(140,220,160,0.5)" : "1px solid transparent", marginBottom: 6, cursor: "pointer" }}
                >
                  {id.avatarUrl ? (
                    <img src={id.avatarUrl} alt={id.name} style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg,#7B6BB8,#5a4a90)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{id.name.slice(0, 1)}</div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "calc(13px*var(--app-text-scale,1))", fontWeight: 600 }}>{id.name}</div>
                    <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.4)" }}>{id.gender || ""}{id.age ? ` · ${id.age}岁` : ""}{id.occupation ? ` · ${id.occupation}` : ""}</div>
                  </div>
                  {selected && <Check size={16} color="rgba(140,220,160,0.9)" />}
                </div>
              );
            })
          )}
        </div>

        {/* ── 绑定 ── */}
        <div style={S.card}>
          <div style={S.label}>会话绑定</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <BindRow ok={maskReady} label="面具" value={maskReady ? (script.userIdentityId || "") : "未绑定"} />
            <BindRow ok={npcReady} label="NPC 角色卡" value={npcReady ? `${script.npcIds.length} 张` : "未生成"} />
            <BindRow ok={script.privateSessionIds.length > 0} label="私聊会话" value={script.privateSessionIds.length > 0 ? `${script.privateSessionIds.length} 个` : "未建立"} />
            <BindRow ok={allReady} label="剧本引擎" value="属性 / 回合 / 判定 / 好感 全自动" />
          </div>
        </div>

        <button
          disabled={!allReady}
          onClick={onStart}
          style={allReady ? S_readyBtn : { ...S_primaryBtn, opacity: 0.4, cursor: "not-allowed" }}
        >
          {allReady ? "✓ 全部就绪 · 开始游戏" : "⏳ 准备中 · 完成角色卡与面具后开始"}
        </button>
      </div>
    </div>
  );
}

const S_primaryBtn: React.CSSProperties = {
  width: "100%", padding: "14px 0", borderRadius: 10, border: "none", background: "rgba(200,160,100,0.2)", color: "#e8d0a0",
  fontSize: "calc(15px*var(--app-text-scale,1))", fontWeight: 500, letterSpacing: "0.1em", cursor: "pointer", fontFamily: "inherit",
};

const S_readyBtn: React.CSSProperties = {
  ...S_primaryBtn,
  background: "rgba(140,220,160,0.25)", color: "#c8f0d0",
};

function BindRow({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "calc(12px*var(--app-text-scale,1))" }}>
      <span style={{ color: ok ? "rgba(140,220,160,0.8)" : "rgba(255,180,120,0.8)", width: 18, textAlign: "center" }}>{ok ? "✓" : "…"}</span>
      <span style={{ color: "rgba(255,255,255,0.5)", width: 72, flexShrink: 0 }}>{label}</span>
      <span style={{ color: "rgba(255,255,255,0.7)", fontFamily: "monospace", fontSize: "calc(11px*var(--app-text-scale,1))" }}>{value}</span>
    </div>
  );
}

/* ── 屏3 · 游戏进行中（跑团正文 + 回合引擎） ── */
function toChatMessage(t: ScriptTurnMessage, idx: number): ChatMessage {
  return {
    id: `turn_${t.createdAt}_${idx}`,
    sessionId: "scripthub-play",
    role: t.role,
    content: t.content,
    status: "sent",
    createdAt: t.createdAt,
  };
}

function PlayingScreen({ scriptId, onBack, onClose, fontScale, onFontScale }: { scriptId: string; onBack: () => void; onClose: () => void; fontScale: number; onFontScale: (v: number) => void }) {
  const [script, setScript] = useState<ScripthubScript | null>(() => getScript(scriptId));
  const [messages, setMessages] = useState<ScriptTurnMessage[]>(() => (getScript(scriptId)?.messages || []));
  const [currentChoices, setCurrentChoices] = useState<string[]>([]);
  const [currentNotes, setCurrentNotes] = useState<string[]>([]);
  const [inputText, setInputText] = useState("");
  const [generating, setGenerating] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentDice, setCurrentDice] = useState<{ sides: number; value: number; label: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const genTokenRef = useRef<number>(0);

  useEffect(() => {
    const s = getScript(scriptId);
    if (s) {
      setScript({ ...s });
      setMessages(s.messages || []);
      // 恢复上一轮尚未消费的行动选项：从最新往回找，若最后一条有效消息是带选项的 DM 叙述则恢复其选项；
      // 若其后已有玩家行动（user 消息），说明选项已被消费，不再恢复。
      const msgs = s.messages || [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m.role === "assistant" && Array.isArray(m.choices) && m.choices.length > 0) {
          setCurrentChoices(m.choices);
          setCurrentNotes(m.stateNotes || []);
          break;
        }
        if (m.role === "user") break;
      }
      updateScript(scriptId, { status: "playing" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, generating]);

  if (!script) return null;

  const sendTurn = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || generating) return;
    setError(null);

    // 剧本选项含 D20 判定标注 → 代码层真掷骰，把真实点数交给 DM 据实结算并展示
    let dice: { sides: number; value: number; label: string } | null = null;
    const diceMatch = trimmed.match(/[（(]?\s*D\s*(\d+)\s*判定\s*[）)]?/i) || trimmed.match(/D(\d+)\b/i);
    if (diceMatch) {
      const sides = parseInt(diceMatch[1] || "20", 10) || 20;
      const value = rollD20();
      dice = { sides, value, label: `D${sides}` };
      setCurrentDice(dice);
    } else {
      setCurrentDice(null);
    }
    const token = ++genTokenRef.current;
    setGenerating(true);
    setInputText("");
    setCurrentChoices([]);
    setCurrentNotes([]);

    // 立即落一条玩家消息
    const userMsg: ScriptTurnMessage = { role: "user", content: trimmed, createdAt: new Date().toISOString() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    updateScript(scriptId, { messages: nextMessages });

    try {
      const userTextForEngine = dice
        ? `${trimmed}\n（系统真实掷骰：${dice.label} = ${dice.value}，请严格依据此骰点判定本次成败，并在正文中如实播报「骰点 ${dice.value} / 难度 DC」）`
        : trimmed;
      const result = await runScriptTurn(getScript(scriptId)!, userTextForEngine);
      if (token !== genTokenRef.current) return; // 已被新回合取代
      const { stats, statsMax, stateNotes } = applyStateChanges(getScript(scriptId)!, result.stateChanges, result.stateNotes);
      const assistantMsg: ScriptTurnMessage = {
        role: "assistant",
        content: result.narration,
        choices: result.choices,
        stateNotes,
        createdAt: new Date().toISOString(),
      };
      const finalMessages = [...nextMessages, assistantMsg];
      setMessages(finalMessages);
      setCurrentChoices(result.choices);
      setCurrentNotes(stateNotes);
      const s = getScript(scriptId)!;
      updateScript(scriptId, {
        messages: finalMessages,
        stats,
        statsMax,
        round: s.round + 1,
      });
      setScript({ ...getScript(scriptId)! });
      // NPC 回合内发的私聊/群聊消息 → 真实推送到聊天会话
      if (result.linkedMessages.length > 0) {
        ensureScriptSessions(scriptId);
        deliverLinkedMessages(getScript(scriptId)!, result.linkedMessages);
      }
      // 联动应用：朋友圈 / 日历 / 手记 真实写入
      if (result.linkedPosts.length > 0) deliverLinkedPosts(getScript(scriptId)!, result.linkedPosts);
      if (result.linkedCalendar.length > 0) deliverLinkedCalendar(getScript(scriptId)!, result.linkedCalendar);
      if (result.linkedDiary.length > 0) deliverLinkedDiary(getScript(scriptId)!, result.linkedDiary);
    } catch (err) {
      if (token !== genTokenRef.current) return;
      setError(err instanceof Error ? err.message : "生成失败，请重试");
    } finally {
      setGenerating(false);
    }
  };

  const handleChoice = (choice: string) => {
    void sendTurn(choice);
  };

  const statsList = Object.entries(script.stats).map(([label, value]) => ({
    label,
    value,
    max: script.statsMax[label],
  }));

  return (
    <div
      className="chat-app absolute inset-0 flex flex-col overflow-hidden z-10"
      style={{ background: "var(--c-page-body-bg)", "--app-text-scale": String(fontScale) } as React.CSSProperties}
    >
      <ChatPageHeader
        title={script.name}
        left={<button className="page-back-btn" aria-label="返回" onClick={onBack}><ChevronLeft size={22} /></button>}
        right={<button className="page-back-btn" aria-label="更多" onClick={() => setMenuOpen(true)}><MoreHorizontal size={22} /></button>}
      />

      {/* 会话信息行 */}
      <div style={{ padding: "4px 16px 6px", background: "var(--c-page-body-bg)" }}>
        <span style={{ fontSize: "calc(10px*var(--app-text-scale,1))", color: "var(--c-text)", fontWeight: 500 }}>
          第 {script.round} 回合
        </span>
      </div>

      {/* 消息流 */}
      <div ref={scrollRef} className="chat-message-scroll flex-1 overflow-y-auto" style={{ padding: "10px 12px" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "48px 24px", fontSize: "calc(12px*var(--app-text-scale,1))", color: "var(--c-text)", lineHeight: 1.8 }}>
            委讬店 · 第1天 · 上午
            <br />
            游戏已开始。在下方输入你的第一个行动，DM 将推进剧情。
          </div>
        )}
        {messages.map((m, i) => (
          <div key={toChatMessage(m, i).id}>
            <MessageBubble
              msg={toChatMessage(m, i)}
              userName={script.userIdentityId ? undefined : "玩家"}
            />
            {m.role === "assistant" && m.stateNotes && m.stateNotes.length > 0 && (
              <StatusDivider notes={m.stateNotes} />
            )}
          </div>
        ))}
        {generating && (
          <div style={{ textAlign: "center", padding: "12px 0", fontSize: "calc(12px*var(--app-text-scale,1))", color: "var(--c-text)", opacity: 0.7 }}>
            DM 正在书写剧情…
          </div>
        )}
        {error && (
          <div style={{ margin: "8px 0", padding: "10px 12px", borderRadius: 8, background: "rgba(255,100,80,0.08)", border: "1px solid rgba(255,100,80,0.3)", color: "rgba(255,140,120,0.95)", fontSize: "calc(12px*var(--app-text-scale,1))" }}>
            {error}
          </div>
        )}
      </div>

      {/* 真实骰点播报（D20 等判定由代码层真掷，非 AI 嘴上说） */}
      {currentDice && !generating && (
        <div style={{ padding: "4px 14px 2px", fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,210,140,0.92)", letterSpacing: "0.05em" }}>
          🎲 系统真实掷骰：{currentDice.label} = <b>{currentDice.value}</b>
        </div>
      )}

      {/* 行动选项（上一回合生成） */}
      {currentChoices.length > 0 && !generating && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 14px 10px" }}>
          {currentChoices.map(c => <ActionChoice key={c} text={c} onSelect={() => handleChoice(c)} />)}
        </div>
      )}

      {/* 状态栏面板（＋ 开关）：属性进度条 + 最近状态播报 */}
      {statsOpen && (
        <div style={{ margin: "0 12px 8px", padding: "12px 14px", background: "var(--c-card)", border: "1px solid var(--c-card-border)", borderRadius: 12, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", letterSpacing: "0.08em", color: "var(--c-text)", fontWeight: 500 }}>
              状态栏 · 第 {script.round} 回合
            </span>
            <button
              onClick={() => setStatsOpen(false)}
              aria-label="收起状态栏"
              style={{ border: "none", background: "transparent", color: "var(--c-text)", fontSize: "calc(12px*var(--app-text-scale,1))", cursor: "pointer", padding: "2px 6px", fontFamily: "inherit" }}
            >收起 ×</button>
          </div>
          {statsList.length === 0 ? (
            <div style={{ fontSize: "calc(12px*var(--app-text-scale,1))", color: "var(--c-text)", lineHeight: 1.7 }}>
              剧情属性尚未产生变化。DM 每回合结算后，好感、理智等数值会显示在这里。
            </div>
          ) : (
            statsList.map(s => (
              <div key={s.label} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "calc(12px*var(--app-text-scale,1))", marginBottom: 4 }}>
                  <span style={{ color: "var(--c-text)" }}>{s.label}</span>
                  <span style={{ color: "var(--c-text-title)", fontWeight: 600, fontFamily: "monospace", fontSize: "calc(13px*var(--app-text-scale,1))" }}>
                    {s.max != null && s.max > 0 ? `${s.value} / ${s.max}` : String(s.value)}
                  </span>
                </div>
                {s.max != null && s.max > 0 && (
                  <div style={{ height: 4, borderRadius: 2, background: "var(--c-input)", overflow: "hidden" }}>
                    <div style={{
                      width: `${Math.max(2, Math.min(100, Math.round((s.value / s.max) * 100)))}%`,
                      height: "100%", borderRadius: 2,
                      background: "linear-gradient(90deg, rgba(134,239,172,0.55), rgba(34,197,94,0.9))",
                    }} />
                  </div>
                )}
              </div>
            ))
          )}
          {currentNotes.length > 0 && (
            <div style={{ borderTop: "1px solid var(--c-card-border)", marginTop: 4, paddingTop: 8 }}>
              {currentNotes.slice(-5).map(n => (
                <div key={n} style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "var(--c-text)", lineHeight: 1.7 }}>· {n}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 输入栏 */}
      <div className="chat-input-bar" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px calc(10px + env(safe-area-inset-bottom, 0px))", background: "var(--c-card)", borderTop: "1px solid var(--c-card-border)" }}>
        <button
          onClick={() => setStatsOpen(o => !o)}
          aria-label="状态清单"
          title="状态清单"
          style={{
            width: 32, height: 32, borderRadius: "50%", flexShrink: 0, cursor: "pointer",
            border: "1px solid var(--c-card-border)",
            background: statsOpen ? "var(--c-icon-active)" : "var(--c-input)",
            color: statsOpen ? "#fff" : "var(--c-icon)",
            fontSize: 18, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
            transition: "transform 0.15s ease, background 0.15s ease",
          }}
        >
          {statsOpen ? "×" : "＋"}
        </button>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0, background: "var(--c-input)", border: "1px solid var(--c-card-border)", borderRadius: 13, padding: "2px 12px" }}>
          <input
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) sendTurn(inputText); }}
            placeholder="输入你的行动…"
            disabled={generating}
            style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: "var(--c-text-title)", fontSize: "calc(12px*var(--app-text-scale,1))", lineHeight: 1.5, fontFamily: "inherit" }}
          />
          <span aria-hidden title={generating ? "剧情生成中…" : "生成就绪"} style={{
            width: 6, height: 6, borderRadius: "50%", flexShrink: 0, position: "relative",
            background: "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.95), rgba(134,239,172,0.85) 25%, rgba(34,197,94,0.7) 55%, rgba(22,163,74,0.55) 100%)",
            boxShadow: "0 0 4px rgba(74,222,128,0.55), 0 0 10px rgba(74,222,128,0.28), inset -1px -1px 2px rgba(20,83,45,0.35)",
            opacity: generating ? undefined : 0.9,
            animation: generating ? "breathe 2.2s ease-in-out infinite" : undefined,
          }} />
        </div>
        <button
          onClick={() => sendTurn(inputText)}
          disabled={generating || !inputText.trim()}
          aria-label="发送"
          style={{
            width: 34, height: 34, borderRadius: "50%", flexShrink: 0, cursor: generating ? "default" : "pointer",
            background: "var(--c-icon-active)", display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 700, fontSize: 15, border: "none", opacity: generating || !inputText.trim() ? 0.5 : 1,
          }}
        >➤</button>
      </div>
      {/* 右上角「三个点」菜单（覆盖层：点遮罩关闭，不打断游戏、不丢选项） */}
      {menuOpen && (
        <ScriptHubMenu
          fontScale={fontScale}
          onFontScale={onFontScale}
          onClose={() => setMenuOpen(false)}
          actions={[
            { label: "返回准备工作", onClick: onBack },
            { label: "退出剧本工坊", onClick: onClose, danger: true },
          ]}
        />
      )}
      <style>{`
        @keyframes breathe {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.15); }
        }
      `}</style>
    </div>
  );
}

/* ── 「三个点」下拉菜单：字号调节（小A—滑块—大A，参考 P 项目的交互设计，代码独立实现）+ 功能项 ── */
function ScriptHubMenu({ fontScale, onFontScale, onClose, actions }: {
  fontScale?: number;
  onFontScale?: (v: number) => void;
  onClose: () => void;
  actions: { label: string; onClick: () => void; danger?: boolean }[];
}) {
  const hasFont = typeof fontScale === "number" && typeof onFontScale === "function";
  return (
    <div
      onClick={onClose}
      aria-label="菜单遮罩"
      style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.25)", zIndex: 50 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: "absolute", top: "calc(var(--page-header-safe-top, 48px) + 46px)", right: 12,
          width: 236, background: "var(--c-card)", border: "1px solid var(--c-card-border)",
          borderRadius: 14, boxShadow: "0 10px 32px rgba(0,0,0,0.35)", padding: "4px 0", overflow: "hidden",
        }}
      >
        {hasFont && (
          <div style={{ padding: "10px 14px 12px", borderBottom: "1px solid var(--c-card-border)" }}>
            <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "var(--c-text)", letterSpacing: "0.08em", marginBottom: 8 }}>正文字号 · 即调即存</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                aria-label="缩小字号"
                title="缩小字号"
                onClick={() => onFontScale!(fontScale! - 0.05)}
                style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid var(--c-card-border)", background: "var(--c-input)", color: "var(--c-text-title)", fontSize: 13, fontWeight: 700, cursor: "pointer", flexShrink: 0, fontFamily: "Georgia, 'Times New Roman', serif", lineHeight: 1 }}
              >A</button>
              <input
                type="range"
                min={FONT_SCALE_MIN}
                max={FONT_SCALE_MAX}
                step={0.05}
                value={fontScale}
                onChange={e => onFontScale!(parseFloat(e.target.value))}
                aria-label="字号滑块"
                style={{ flex: 1, accentColor: "var(--c-icon-active)", cursor: "pointer" }}
              />
              <button
                aria-label="放大字号"
                title="放大字号"
                onClick={() => onFontScale!(fontScale! + 0.05)}
                style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid var(--c-card-border)", background: "var(--c-input)", color: "var(--c-text-title)", fontSize: 18, fontWeight: 700, cursor: "pointer", flexShrink: 0, fontFamily: "Georgia, 'Times New Roman', serif", lineHeight: 1 }}
              >A</button>
            </div>
            <div style={{ textAlign: "center", fontSize: "calc(10px*var(--app-text-scale,1))", color: "var(--c-text)", marginTop: 6, fontFamily: "monospace" }}>
              {Math.round(fontScale! * 100)}%
            </div>
          </div>
        )}
        {actions.map(a => (
          <button
            key={a.label}
            onClick={a.onClick}
            style={{
              display: "block", width: "100%", padding: "12px 16px", border: "none", background: "transparent",
              textAlign: "left", fontSize: "calc(13px*var(--app-text-scale,1))", cursor: "pointer", fontFamily: "inherit",
              color: a.danger ? "rgba(255,100,80,0.95)" : "var(--c-text-title)",
            }}
          >{a.label}</button>
        ))}
      </div>
    </div>
  );
}

function ActionChoice({ text, onSelect }: { text: string; onSelect?: () => void }) {
  return (
    <div onClick={onSelect} style={{ border: "1px solid var(--c-card-border)", background: "var(--c-card)", color: "var(--c-text-title)", borderRadius: 10, padding: "11px 14px", fontSize: "calc(13px*var(--app-text-scale,1))", cursor: "pointer", fontFamily: "inherit" }}>
      {text}
    </div>
  );
}

/* ── 西幻风格状态分割线（抽屉） ── */
function StatusDivider({ notes }: { notes: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ margin: "4px 0 10px", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={open ? "收起状态" : "展开状态"}
        title="状态变化"
        style={{
          width: "100%", border: "none", background: "transparent", cursor: "pointer",
          padding: "6px 0", display: "flex", alignItems: "center", gap: 10, fontFamily: "inherit",
        }}
      >
        <span style={{ flex: 1, height: 1, background: "linear-gradient(90deg, transparent, rgba(110,90,180,0.45), rgba(180,140,220,0.7), rgba(110,90,180,0.45), transparent)" }} />
        <span style={{
          fontSize: "calc(13px*var(--app-text-scale,1))", lineHeight: 1, color: "rgba(150,120,210,0.9)",
          textShadow: "0 0 8px rgba(150,120,210,0.8), 0 0 16px rgba(150,120,210,0.4)",
          transform: open ? "rotate(90deg)" : undefined,
          transition: "transform 0.25s ease",
        }}>
          ✦
        </span>
        <span style={{ flex: 1, height: 1, background: "linear-gradient(90deg, transparent, rgba(110,90,180,0.45), rgba(180,140,220,0.7), rgba(110,90,180,0.45), transparent)" }} />
      </button>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, marginTop: 2 }}>
          {notes.map(n => (
            <span key={n} style={{ fontSize: "calc(10.5px*var(--app-text-scale,1))", color: "rgba(0,0,0,0.35)", fontFamily: "monospace", letterSpacing: "0.02em" }}>
              {n}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}