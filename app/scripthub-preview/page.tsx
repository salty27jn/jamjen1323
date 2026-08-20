"use client";

// 剧本工坊 · 界面预览页（独立路由，不经过账号校验，不动主应用）
// 三屏均复用真实源码组件与样式：
//   · 屏1/屏2 复用 MapLobby 的 S 样式体系（深色冒险主题，真实文件 components/map/map-lobby.tsx）
//   · 屏3    复用 ChatPageHeader / StateValuesPanel / MessageBubble / chat-app 容器（真实聊天应用）
// 纯静态预览，内容为假数据，无真实功能。

import { useState, useRef, useEffect } from "react";
import { ArrowLeft, ChevronLeft, MoreHorizontal, Plus, Play, Trash2 } from "lucide-react";
import { ChatPageHeader } from "@/components/chat/chat-page-header";
import { MessageBubble } from "@/components/chat/message-bubble";
import type { ChatMessage } from "@/lib/chat-storage";

type View = "home" | "setup" | "playing";

const SCRIPTS = [
  {
    id: "xianggang",
    emoji: "🏮",
    name: "香港灵异模拟器",
    desc: "经营委讬店 · 回合制 · 粤语NPC",
    lore: "孤儿主角继承爷爷的委讬店，一边维持店租与助理小玲的工资，一边处理灵异委讬。属性：好感值/生命值/理智值/混乱值。",
    mode: "模式A · 全结构化",
    status: "进行中",
    statusAt: "第1天 · 上午",
    cover: "linear-gradient(135deg,#3a2a4a,#0a0a0f)",
  },
  {
    id: "zuke",
    emoji: "🎮",
    name: "租客模拟器 v2.1",
    desc: "隐藏数值 · 每周行动点 · D20事件表 · 6结局",
    lore: "经济拮据的留学生，房租快交不上，脑海里闪过一个念头——如果能和房东住一起……",
    mode: "模式A · 全结构化",
    status: "未开始",
    cover: "linear-gradient(135deg,#4a3a6a,#2a2050)",
  },
  {
    id: "nvpei",
    emoji: "👑",
    name: "恶毒女配模拟器",
    desc: "角色创建 · 好感/厌恶值 · 感情阶段控制",
    lore: "玩家扮演恶毒女配，从角色创建开始，由 DM 生成剧情，结算好感值与厌恶值。",
    mode: "模式A · 全结构化",
    status: "未开始",
    cover: "linear-gradient(135deg,#5a2a4a,#1a1020)",
  },
  {
    id: "yisheng",
    emoji: "🩺",
    name: "NCT机智的医生生活",
    desc: "群像型 · 六位医生 · 自由演",
    lore: "六位男主角色设定 + 玩家角色创建，群像自由演，无数值系统。",
    mode: "模式B · 有角色无数值",
    status: "未开始",
    cover: "linear-gradient(135deg,#2a4a6a,#102030)",
  },
  {
    id: "huochang",
    emoji: "🔥",
    name: "追妻火葬场模拟器",
    desc: "原创角色 · 后日谈 · 番外",
    lore: "玩家可要求后日谈、番外、多年后、某角色视角、不原谅后的TA近况等。",
    mode: "模式A · 全结构化",
    status: "未开始",
    cover: "linear-gradient(135deg,#6a2a2a,#201010)",
  },
  {
    id: "xianhou",
    emoji: "💍",
    name: "先婚后爱模拟器",
    desc: "登记表开局 · 角色与隐藏层 · 动态回合",
    lore: "全部角色与事件均属平行世界虚构设定，第一回合依据登记内容动态生成。",
    mode: "模式A · 全结构化",
    status: "未开始",
    cover: "linear-gradient(135deg,#4a2a6a,#201030)",
  },
  {
    id: "backroom",
    emoji: "⬜",
    name: "Backroom模拟器",
    desc: "生存逃脱 · 角色死亡转NPC · 遗产继承",
    lore: "角色死亡後会成为NPC，玩家可在同一对话开启新游戏，寻找上一任主角的屍体与物品。",
    mode: "模式A · 全结构化",
    status: "未开始",
    cover: "linear-gradient(135deg,#2a2a3a,#101018)",
  },
];

export default function ScriptHubPreviewPage() {
  const [view, setView] = useState<View>("home");

  return (
    <main className="app-root" style={{ background: "var(--c-input)" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>
          剧本工坊 · 界面预览
        </h1>
        <p style={{ fontSize: 13, color: "var(--c-text)", marginBottom: 16 }}>
          独立预览路由 · 三屏均复用真实源码组件（MapLobby / ChatPageHeader / StateValuesPanel / MessageBubble）· 仅外观预览
        </p>
        <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
          <button onClick={() => setView("home")} style={tabStyle(view === "home")}>① 剧本工坊主页</button>
          <button onClick={() => setView("setup")} style={tabStyle(view === "setup")}>② 准备工作</button>
          <button onClick={() => setView("playing")} style={tabStyle(view === "playing")}>③ 游戏进行中</button>
        </div>

        <div className="phone-shell-wrap" style={{ margin: "0 auto" }}>
          <div className="phone-case">
            <div className="phone-frame">
              <div className="phone-shell app-open-shell">
                <div className="phone-wallpaper" />
                <div className="phone-workspace app-open">
                  <section className="phone-app-pane">
                    {view === "home" && <HomeScreen onStart={() => setView("setup")} />}
                    {view === "setup" && <SetupScreen onStart={() => setView("playing")} />}
                    {view === "playing" && <PlayingScreen />}
                  </section>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: "8px 16px",
    borderRadius: 20,
    border: active ? "none" : "1px solid var(--c-card-border)",
    background: active ? "#1f2329" : "rgba(255,255,255,0.6)",
    color: active ? "#fff" : "var(--c-text-title)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  };
}

/* ── 屏1 · 剧本工坊主页（复用 MapLobby 的 S 样式体系） ── */
function HomeScreen({ onStart }: { onStart: () => void }) {
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
  };

  return (
    <div style={S.root}>
      <div style={S.header}>
        <button style={S.btn}><ArrowLeft size={20} /></button>
        <span style={{ fontSize: "calc(13px*var(--app-text-scale,1))", letterSpacing: "0.2em", color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
          剧本工坊
        </span>
        <button style={S.btn} onClick={onStart}><Plus size={20} /></button>
      </div>

      <div style={S.body}>
        {SCRIPTS.map(w => (
          <div key={w.id} style={S.card}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: "calc(20px*var(--app-text-scale,1))" }}>{w.emoji}</span>
              <div style={{ fontSize: "calc(15px*var(--app-text-scale,1))", fontWeight: 600, flex: 1 }}>
                {w.name}
                {w.status === "进行中" && <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(200,255,180,0.7)", marginLeft: 8, fontWeight: 400 }}>{w.status} · {w.statusAt}</span>}
              </div>
              <span style={{ fontSize: "calc(10px*var(--app-text-scale,1))", color: "rgba(200,160,100,0.6)", border: "1px solid rgba(200,160,100,0.25)", borderRadius: 20, padding: "2px 8px", flexShrink: 0 }}>{w.mode}</span>
            </div>
            <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.35)", marginBottom: 10, lineHeight: 1.6 }}>{w.lore.slice(0, 88)}...</div>
            <div style={{ display: "flex", gap: 8 }}>
              {w.status === "进行中" && (
                <button onClick={onStart} style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", color: "#e0dcd5", fontSize: "calc(12px*var(--app-text-scale,1))", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, fontFamily: "inherit" }}>
                  <Play size={12} /> 继续
                </button>
              )}
              {w.status !== "进行中" && (
                <button onClick={onStart} style={{ flex: 1, padding: "8px 0", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.06)", color: "#e0dcd5", fontSize: "calc(12px*var(--app-text-scale,1))", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, fontFamily: "inherit" }}>
                  <Play size={12} /> 进入
                </button>
              )}
              <button style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(255,100,80,0.2)", background: "transparent", color: "rgba(255,100,80,0.6)", fontSize: "calc(12px*var(--app-text-scale,1))", cursor: "pointer" }}>
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}

        <div onClick={onStart} style={{ ...S.card, border: "1.5px dashed rgba(255,255,255,0.15)", background: "transparent", textAlign: "center", cursor: "pointer", padding: "18px 16px" }}>
          <div style={{ fontSize: "calc(13px*var(--app-text-scale,1))", color: "rgba(200,160,100,0.8)", fontWeight: 500 }}>＋ 导入新剧本</div>
          <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.3)", marginTop: 4 }}>支持 .txt / .json（ChelizAI 剧本 / 角色卡）</div>
        </div>
      </div>
    </div>
  );
}

/* ── 屏2 · 准备工作（复用 MapLobby create 模式的卡片风格） ── */
function SetupScreen({ onStart }: { onStart: () => void }) {
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
    primaryBtn: { width: "100%", padding: "14px 0", borderRadius: 10, border: "none", background: "rgba(200,160,100,0.2)", color: "#e8d0a0", fontSize: "calc(15px*var(--app-text-scale,1))", fontWeight: 500, letterSpacing: "0.1em", cursor: "pointer", fontFamily: "inherit" },
    readyBtn: { width: "100%", padding: "14px 0", borderRadius: 10, border: "none", background: "rgba(140,220,160,0.25)", color: "#c8f0d0", fontSize: "calc(15px*var(--app-text-scale,1))", fontWeight: 500, letterSpacing: "0.1em", cursor: "pointer", fontFamily: "inherit" },
  };

  return (
    <div style={S.root}>
      <div style={S.header}>
        <button style={S.btn}><ArrowLeft size={20} /></button>
        <span style={{ fontSize: "calc(13px*var(--app-text-scale,1))", letterSpacing: "0.2em", color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
          准备工作
        </span>
        <button style={S.btn}><MoreHorizontal size={20} /></button>
      </div>

      <div style={S.body}>
        {/* ── 剧本 ── */}
        <div style={{ marginBottom: 14 }}>
          <div style={S.label}>剧 本</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: "calc(22px*var(--app-text-scale,1))" }}>🏮</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "calc(15px*var(--app-text-scale,1))", fontWeight: 600 }}>香港灵异模拟器</div>
              <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.35)" }}>模式A · 全结构化 · 回合制 · 粤语NPC</div>
            </div>
            <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(140,220,160,0.8)" }}>✓ 已导入</span>
          </div>
        </div>

        {/* ── NPC 角色卡（引擎自动生成） ── */}
        <div style={S.card}>
          <div style={S.label}>NPC 角色卡（引擎自动生成 · 原文搬运零改编）</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, background: "rgba(0,0,0,0.3)", marginBottom: 6 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg,#45A8A0,#2a6a64)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>👧</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "calc(13px*var(--app-text-scale,1))", fontWeight: 600 }}>金小玲（小玲）</div>
              <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.4)" }}>爷爷聘请的助理 · 粤语对话 · 慢热感情线</div>
            </div>
            <span style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(140,220,160,0.8)" }}>✓ 已入联系人</span>
          </div>
          <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.3)", lineHeight: 1.6 }}>
            其余 NPC 由引擎按剧本原文在剧情中自然生成，均走「原文搬运 → 角色卡 → 联系人」流程。
          </div>
        </div>

        {/* ── 面具 ── */}
        <div style={S.card}>
          <div style={S.label}>你的面具（你是谁）</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, background: "rgba(0,0,0,0.3)", marginBottom: 6 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg,#7B6BB8,#5a4a90)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>👤</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "calc(13px*var(--app-text-scale,1))", fontWeight: 600 }}>「高冷港风青年」</div>
              <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.4)" }}>25岁 · 男 · 道士（剧本要求主角是道士）</div>
            </div>
            <span style={{ border: "1px solid rgba(200,160,100,0.3)", background: "transparent", color: "#e8d0a0", borderRadius: 20, padding: "6px 12px", fontSize: "calc(12px*var(--app-text-scale,1))", cursor: "pointer" }}>跳去设置</span>
          </div>
          <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "rgba(255,255,255,0.3)", lineHeight: 1.6 }}>
            面具决定你在剧本里的口吻与人设。未设置面具时，开始游戏按钮保持禁用。
          </div>
        </div>

        {/* ── 绑定 ── */}
        <div style={S.card}>
          <div style={S.label}>会话绑定</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <BindRow ok label="面具" value="高冷港风青年（id: identity-01）" />
            <BindRow ok label="NPC 角色卡" value="金小玲（id: char-xianggang-01）" />
            <BindRow ok label="剧本引擎" value="模式A · 属性/回合/判定/好感全自动" />
          </div>
        </div>

        <button onClick={onStart} style={S.readyBtn}>
          ✓ 全部就绪 · 开始游戏
        </button>
      </div>
    </div>
  );
}

function BindRow({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "calc(12px*var(--app-text-scale,1))" }}>
      <span style={{ color: ok ? "rgba(140,220,160,0.8)" : "rgba(255,180,120,0.8)", width: 18, textAlign: "center" }}>{ok ? "✓" : "…"}</span>
      <span style={{ color: "rgba(255,255,255,0.5)", width: 72, flexShrink: 0 }}>{label}</span>
      <span style={{ color: "rgba(255,255,255,0.7)", fontFamily: "monospace", fontSize: "calc(11px*var(--app-text-scale,1))" }}>{value}</span>
    </div>
  );
}

/* ── 屏3 · 游戏进行中（复用真实聊天应用：ChatPageHeader + MessageBubble） ── */
const PLAYING_STATS: { label: string; value: number | string; max?: number }[] = [
  { label: "生命", value: 100, max: 100 },
  { label: "理智", value: 86, max: 100 },
  { label: "混乱", value: 8, max: 100 },
  { label: "好感", value: 35, max: 100 },
  { label: "金钱", value: "$3,200" },
  { label: "行动点", value: 2, max: 5 },
];

function makeMsg(id: string, role: ChatMessage["role"], content: string, charName?: string): ChatMessage {
  return {
    id,
    sessionId: "session-xianggang-01",
    role,
    content,
    status: "sent",
    createdAt: new Date().toISOString(),
  };
}

const PLAYING_MESSAGES: ChatMessage[] = [
  makeMsg("m1", "assistant", "委讬店 · 第1天 · 上午\n\n店铺刚开门，一阵穿堂风把卷帘门吹得哗哗响。你站在柜台后面，面前是爷爷留下的法器，还有他留下的三个锦囊。\n\n门口传来敲门声——一个面色苍白的阿伯站在门外，手里捏着一张皱巴巴的纸条：「后生仔……我间屋，最近夜晚有怪声。」\n\n小玲也从里屋探出头来。"),
  makeMsg("m2", "assistant", "老板，佢面色好差哦，我哋帮唔帮手？\n\n（老板，他脸色很差，我们要不要帮他？）", "小玲"),
  makeMsg("m3", "user", "接。先让阿伯进来坐，我去给他倒杯水。小玲你把今天预约的委讬单拿过来。"),
  makeMsg("m4", "assistant", "小玲：你倒是挺会照顾人。\n\n阿伯坐下后缓了口气，把纸条推过来：「呢度系地址……我哋栋楼，最近成晚有怪声，好似……有嘢喺度。」", "小玲"),
];

// 同一回合的状态变化 + 剧情播报合并为一个状态栏，放在该回合最后一条消息后
const STATUS_NOTES: Record<string, string[]> = {
  m4: [
    "好感值 +2",
    "新委讬登记完成 · 旺角旧唐楼 3F 302 室",
    "酬劳 $3,200（先付一半）",
    "店租剩余 28 天",
  ],
};

function PlayingScreen() {
  const [statsOpen, setStatsOpen] = useState(false);
  const [choicesVisible, setChoicesVisible] = useState(false);
  const [generating, setGenerating] = useState(false);
  const genTimerRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || choicesVisible) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 60) {
      setChoicesVisible(true);
    }
  };

  const handleChoice = () => {
    setGenerating(true);
    if (genTimerRef.current) window.clearTimeout(genTimerRef.current);
    genTimerRef.current = window.setTimeout(() => setGenerating(false), 3500);
  };

  return (
    <div className="chat-app absolute inset-0 flex flex-col overflow-hidden z-10" style={{ background: "var(--c-page-body-bg)" }}>
      <ChatPageHeader
        title="香港灵异模拟器"
        left={<button className="page-back-btn" aria-label="返回"><ChevronLeft size={22} /></button>}
        right={<button className="page-back-btn" aria-label="更多"><MoreHorizontal size={22} /></button>}
      />

      {/* 会话信息行 */}
      <div style={{ padding: "4px 16px 6px", background: "var(--c-page-body-bg)" }}>
        <span style={{ fontSize: "calc(10px*var(--app-text-scale,1))", color: "var(--c-text)", fontWeight: 500 }}>第1天 · 上午 · 委托：旺角旧唐楼</span>
      </div>

      {/* 消息流 */}
      <div ref={scrollRef} onScroll={handleScroll} className="chat-message-scroll flex-1 overflow-y-auto" style={{ padding: "10px 12px" }}>
        {PLAYING_MESSAGES.map(m => (
          <div key={m.id}>
            <MessageBubble
              msg={m}
              charName={m.role === "user" ? undefined : (m.id === "m2" || m.id === "m4" ? "小玲" : undefined)}
              userName="高冷港风青年"
            />
            {STATUS_NOTES[m.id] && (
              <StatusDivider notes={STATUS_NOTES[m.id]} revealed={choicesVisible} auto={m.id === "m4"} />
            )}
          </div>
        ))}
      </div>

      {/* 行动选项（滚动到底部才出现） */}
      {choicesVisible && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 14px 10px" }}>
          <ActionChoice text="接这个委讬，去唐楼看看" sub="（行动点-1 · 出发前可先买符纸）" onSelect={handleChoice} />
          <ActionChoice text="先问阿伯多一点细节" sub="（聊天联动 · 可能触发暗骰）" onSelect={handleChoice} />
          <ActionChoice text="拆开爷爷留下的一个锦囊" sub="（一次性消耗 · 随机道具）" onSelect={handleChoice} />
          <ActionChoice text="让小玲留守店铺，你独自前往" sub="（理智-5 · 隐藏风险）" onSelect={handleChoice} />
        </div>
      )}

      {/* 输入栏 + 状态清单开关（＋） */}
      <div style={{ padding: "0 14px" }}>
        {statsOpen && (
          <div style={{ padding: "10px 14px", background: "var(--c-card)", border: "1px solid var(--c-card-border)", borderRadius: 12, marginBottom: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
              {PLAYING_STATS.map(s => (
                <div key={s.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, fontSize: "calc(12px*var(--app-text-scale,1))" }}>
                  <span style={{ color: "var(--c-text)" }}>{s.label}</span>
                  <span style={{ color: "var(--c-text-title)", fontWeight: 600, fontFamily: "monospace", fontSize: "calc(13px*var(--app-text-scale,1))" }}>
                    {s.max != null ? `${s.value} / ${s.max}` : String(s.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

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
        <div style={{ flex: 1, background: "var(--c-input)", border: "1px solid var(--c-card-border)", borderRadius: 13, padding: "2px 12px", fontSize: "calc(12px*var(--app-text-scale,1))", color: "var(--c-text-title)", lineHeight: 1.5, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>输入你的行动…</span>
          <span aria-hidden title={generating ? "剧情生成中…" : "生成就绪"} style={{
            width: 6, height: 6, borderRadius: "50%", flexShrink: 0, position: "relative",
            background: "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.95), rgba(134,239,172,0.85) 25%, rgba(34,197,94,0.7) 55%, rgba(22,163,74,0.55) 100%)",
            boxShadow: "0 0 4px rgba(74,222,128,0.55), 0 0 10px rgba(74,222,128,0.28), inset -1px -1px 2px rgba(20,83,45,0.35)",
            opacity: generating ? undefined : 0.9,
            animation: generating ? "breathe 2.2s ease-in-out infinite" : undefined,
          }} />
        </div>
        <div style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--c-icon-active)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 15 }}>➤</div>
      </div>
    </div>
  );
}

function ActionChoice({ text, sub, onSelect }: { text: string; sub?: string; onSelect?: () => void }) {
  return (
    <div onClick={onSelect} style={{ border: "1px solid var(--c-card-border)", background: "var(--c-card)", color: "var(--c-text-title)", borderRadius: 10, padding: "11px 14px", fontSize: "calc(13px*var(--app-text-scale,1))", cursor: "pointer" }}>
      {text}
      {sub ? <div style={{ fontSize: "calc(11px*var(--app-text-scale,1))", color: "var(--c-text)", marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}

/* ── 西幻风格状态分割线（抽屉） ── */
function StatusDivider({ notes, revealed, auto }: { notes: string[]; revealed: boolean; auto: boolean }) {
  const [open, setOpen] = useState(false);
  const [flashKey, setFlashKey] = useState(0);
  const timerRef = useRef<number | null>(null);

  // 回合有状态变动时：分割线柔光闪烁两下提示，不自动展开
  useEffect(() => {
    if (!revealed || !auto) return;
    setFlashKey(k => k + 1);
    timerRef.current = window.setTimeout(() => setFlashKey(0), 1800);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [revealed, auto]);

  const toggle = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setFlashKey(0);
    setOpen(o => !o);
  };

  return (
    <div style={{ margin: "4px 0 10px", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <style>{`
        @keyframes statusFlash {
          0%, 100% { opacity: 0.45; text-shadow: 0 0 4px rgba(150,120,210,0.25); }
          50% { opacity: 1; text-shadow: 0 0 14px rgba(150,120,210,1), 0 0 30px rgba(150,120,210,0.55); }
        }
        @keyframes breathe {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.15); }
        }
      `}</style>
      {/* 西幻分割线：魔法渐变光晕 + 星芒符文 */}
      <button
        onClick={toggle}
        aria-label={open ? "收起状态" : "展开状态"}
        title="状态变化"
        style={{
          width: "100%", border: "none", background: "transparent", cursor: "pointer",
          padding: "6px 0", display: "flex", alignItems: "center", gap: 10, fontFamily: "inherit",
        }}
      >
        <span style={{ flex: 1, height: 1, background: "linear-gradient(90deg, transparent, rgba(110,90,180,0.45), rgba(180,140,220,0.7), rgba(110,90,180,0.45), transparent)" }} />
        <span key={flashKey} style={{
          fontSize: "calc(13px*var(--app-text-scale,1))", lineHeight: 1, color: "rgba(150,120,210,0.9)",
          textShadow: "0 0 8px rgba(150,120,210,0.8), 0 0 16px rgba(150,120,210,0.4)",
          transform: open ? "rotate(90deg)" : undefined,
          transition: "transform 0.25s ease",
          animation: flashKey ? "statusFlash 0.7s ease 2" : undefined,
        }}>
          ✦
        </span>
        <span style={{ flex: 1, height: 1, background: "linear-gradient(90deg, transparent, rgba(110,90,180,0.45), rgba(180,140,220,0.7), rgba(110,90,180,0.45), transparent)" }} />
      </button>

      {/* 状态变化注释：灰色小字（手动展开才显示） */}
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