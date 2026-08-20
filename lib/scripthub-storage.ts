import Dexie from "dexie";
import { createCharacter, loadCharacters, saveCharacters } from "./character-storage";
import { addChatContact, createOrGetSession } from "./chat-storage";

// ── 剧本工坊数据模型 ─────────────────────────────
export type ScripthubMode = "A" | "B";

export type ScripthubScriptStatus = "not_started" | "preparing" | "playing" | "finished";

export type ScripthubScript = {
  id: string;
  name: string;            // 剧本名（标题）
  fileName: string;        // 原始文件名
  emoji: string;           // 封面 emoji（玩家可改）
  content: string;         // 剧本原文
  mode: ScripthubMode;     // A 全结构化 / B 有角色无数值
  status: ScripthubScriptStatus;
  npcIds: string[];        // 生成的角色卡 id（联系人）
  privateSessionIds: string[]; // 私聊会话 id
  groupSessionIds: string[];   // 群聊会话 id
  userIdentityId?: string;     // 面具 id
  round: number;           // 当前回合
  stats: Record<string, number>;    // 属性快照（当前值）
  statsMax: Record<string, number>;  // 属性上限
  messages: ScriptTurnMessage[];   // 跑团正文历史（DM叙述 + 玩家行动）
  importedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type ScriptTurnMessage = {
  role: "user" | "assistant";
  content: string;
  choices?: string[];      // assistant 回合的可选行动（4 个）
  stateNotes?: string[];   // 状态变化注释（状态栏内容）
  createdAt: string;
};

class ScriptHubDatabase extends Dexie {
  scripts!: Dexie.Table<ScripthubScript, string>;

  constructor() {
    super("AiPhoneScriptHubDB");
    this.version(1).stores({
      scripts: "id, importedAt",
    });
  }
}

const scriptHubDb = new ScriptHubDatabase();

let _hydrated = false;
let _scriptsCache: ScripthubScript[] = [];

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeScripts(scripts: ScripthubScript[]): ScripthubScript[] {
  const normalized: ScripthubScript[] = [];
  const seen = new Set<string>();
  for (const script of scripts) {
    const id = script.id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push({
      ...script,
      npcIds: Array.isArray(script.npcIds) ? script.npcIds : [],
      privateSessionIds: Array.isArray(script.privateSessionIds) ? script.privateSessionIds : [],
      groupSessionIds: Array.isArray(script.groupSessionIds) ? script.groupSessionIds : [],
      stats: script.stats || {},
      statsMax: script.statsMax || {},
      messages: Array.isArray(script.messages) ? script.messages : [],
      round: typeof script.round === "number" ? script.round : 1,
      mode: script.mode === "B" ? "B" : "A",
      status: script.status || "not_started",
    });
  }
  return normalized;
}

function persistScriptsSnapshot(scripts: ScripthubScript[]): void {
  scriptHubDb.transaction("rw", scriptHubDb.scripts, async () => {
    await scriptHubDb.scripts.clear();
    await scriptHubDb.scripts.bulkPut(scripts);
  }).catch(() => undefined);
}

export async function hydrateScripthubStorage(): Promise<void> {
  if (_hydrated || typeof window === "undefined") return;
  const scripts = await scriptHubDb.scripts.toArray().catch(() => []);
  _scriptsCache = normalizeScripts(scripts);
  _hydrated = true;
}

export function loadScripts(): ScripthubScript[] {
  return [..._scriptsCache].sort((a, b) => (b.importedAt || "").localeCompare(a.importedAt || ""));
}

export function getScript(id: string): ScripthubScript | null {
  return _scriptsCache.find(s => s.id === id) ?? null;
}

export function createScript(
  input: Pick<ScripthubScript, "name" | "fileName" | "content" | "mode" | "emoji">
): ScripthubScript {
  const now = new Date().toISOString();
  const script: ScripthubScript = {
    id: generateId("script"),
    name: input.name,
    fileName: input.fileName,
    emoji: input.emoji,
    content: input.content,
    mode: input.mode,
    status: "not_started",
    npcIds: [],
    privateSessionIds: [],
    groupSessionIds: [],
    round: 1,
    stats: {},
    statsMax: {},
    messages: [],
    importedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  _scriptsCache.unshift(script);
  scriptHubDb.scripts.put(script).catch(() => undefined);
  return script;
}

export function updateScript(id: string, updates: Partial<ScripthubScript>): ScripthubScript | null {
  const idx = _scriptsCache.findIndex(s => s.id === id);
  if (idx === -1) return null;
  const next: ScripthubScript = {
    ..._scriptsCache[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  _scriptsCache[idx] = next;
  scriptHubDb.scripts.put(next).catch(() => undefined);
  return next;
}

export function deleteScript(id: string): void {
  _scriptsCache = _scriptsCache.filter(s => s.id !== id);
  scriptHubDb.scripts.delete(id).catch(() => undefined);
}

// ── 剧本文本解析（导入用，启发式） ──────────────────
export type ParsedScriptInfo = {
  title: string;
  mode: ScripthubMode;
  emoji: string;
};

const EMOJI_OPTIONS = ["🎭", "🕯️", "🎮", "👻", "🏠", "💍", "❤️", "🌙", "🎬", "📜"];

export function pickDefaultEmoji(mode: ScripthubMode): string {
  return mode === "B" ? "🎬" : "🎭";
}

/** 从剧本原文启发式提取标题与模式。 */
export function parseScriptText(content: string, fileName: string): ParsedScriptInfo {
  const lines = content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  let title = "";
  // 优先取「剧本名：xxx」「标题：xxx」「# xxx」这类显式标记
  for (const line of lines.slice(0, 30)) {
    const m = line.match(/^(?:剧本名|标题|剧本标题|名称)\s*[:：]\s*(.+)$/);
    if (m) { title = m[1].trim(); break; }
    const h = line.match(/^#\s*(.+)$/);
    if (h) { title = h[1].trim(); break; }
  }
  // 否则取文件名（去扩展名），再兜底第一行
  if (!title) title = fileName.replace(/\.(txt|json|png)$/i, "").trim();
  if (!title) title = lines[0]?.slice(0, 30) ?? "未命名剧本";
  title = title.replace(/^["「『【\s]+|["」』】\s]+$/g, "");

  // 模式启发：文本含结构化属性关键词 → 模式A；否则模式B
  const attrKeywords = /好感值|好感度|生命值|理智值|混乱值|行动点|金钱|修为|体力|魅力|信任值|心情值|体力值/;
  const mode: ScripthubMode = attrKeywords.test(content) ? "A" : "B";

  return { title, mode, emoji: pickDefaultEmoji(mode) };
}

/** 生成唯一 emoji（若默认被占用则换一个）。 */
export function nextAvailableEmoji(): string {
  const used = new Set(_scriptsCache.map(s => s.emoji));
  for (const e of EMOJI_OPTIONS) if (!used.has(e)) return e;
  return `📄${_scriptsCache.length + 1}`;
}

// ── NPC 角色卡生成（原文搬运，零 AI 改编） ──────────────
export type NpcCandidate = {
  name: string;
  persona: string;
};

/** 从剧本原文启发式提取「相关角色」段落中的 NPC 块。 */
export function extractNpcCandidates(content: string): NpcCandidate[] {
  const lines = content.split(/\r?\n/);
  const startIdx = lines.findIndex(l => /相关角色|角色创建|NPC(角色|列表|设定)?|角色设定/.test(l));
  if (startIdx === -1) return [];

  const out: NpcCandidate[] = [];
  let current: { name: string; rows: string[] } | null = null;

  const push = () => {
    if (!current) return;
    const persona = current.rows.join("\n").replace(/【|】/g, "").trim();
    if (persona) out.push({ name: current.name, persona });
    current = null;
  };

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // 下一个段落标题（数值/系统/语言规则等）终止当前块
    if (/^(4|5|6|7|8|9)\.|^第|^主要数值|^系统指令|^回覆格式|^严格补充|^【/.test(line)) {
      if (current) push();
      break;
    }
    const nameMatch = line.match(/姓名\s*[:：]?\s*【([^】]+)】/);
    if (nameMatch) {
      if (current) push();
      const raw = nameMatch[1].trim();
      if (!raw) continue;
      current = { name: raw, rows: [line.replace(/^\s*[·•-]\s*/, "")] };
      continue;
    }
    if (current) {
      current.rows.push(line.replace(/^\s*[·•-]\s*/, ""));
    }
  }
  if (current) push();
  return out;
}

/**
 * 为剧本生成 NPC 角色卡：原文搬运 → createCharacter → 建联系人 → 建私聊会话。
 * 幂等：已生成的剧本直接返回，不重复建卡。返回本次新建数量。
 */
export function ensureScriptNpcs(scriptId: string): { created: number; chars: string[] } {
  const script = getScript(scriptId);
  if (!script) return { created: 0, chars: [] };
  if (script.npcIds.length > 0) return { created: 0, chars: script.npcIds };

  const candidates = extractNpcCandidates(script.content);
  const chars = loadCharacters();
  const npcIds: string[] = [];
  const privateSessionIds: string[] = [];

  for (const c of candidates) {
    const existing = chars.find(ch => ch.name === c.name);
    const char = existing ?? createCharacter({
      name: c.name,
      persona: c.persona,
      personality: c.name.includes("小玲") ? "慢热自然，不强推感情线，关系进展取决于日常互动累积" : undefined,
      avatar: null,
    });
    if (!existing) chars.push(char);
    npcIds.push(char.id);
    const contact = addChatContact(char.id);
    if (contact) {
      const session = createOrGetSession(char.id);
      privateSessionIds.push(session.id);
    }
  }

  if (npcIds.length > 0) {
    saveCharacters(chars);
    updateScript(scriptId, {
      npcIds: [...script.npcIds, ...npcIds],
      privateSessionIds: [...script.privateSessionIds, ...privateSessionIds],
    });
  }
  return { created: npcIds.length, chars: npcIds };
}