import Dexie from "dexie";
import { createCharacter, loadCharacters, saveCharacters } from "./character-storage";
import { addChatContact, createOrGetSession, loadChatSessions } from "./chat-storage";
import {
  createWorldBook,
  loadWorldBooks,
  saveWorldBooks,
  loadBindingConfig,
  getCharacterBinding,
  setCharacterBinding,
  saveBindingConfig,
} from "./settings-storage";

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

  // 模式启发：剧本含结构化属性/系统关键词 → 模式A（全结构化）；否则模式B（有角色无数值）
  const attrKeywords = /好感值|好感度|生命值|理智值|混乱值|行动点|金钱|修为|体力|魅力|信任值|心情值|体力值|厌恶值|剧情进度|好感度区间|好感度系统|关系网|状态栏格式|判定系统|回合|SP|SAN|HP/;
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

/** 从剧本原文启发式提取 NPC 角色（支持多种剧本格式，原文搬运零改编）。 */
export function extractNpcCandidates(content: string): NpcCandidate[] {
  const lines = content.split(/\r?\n/);
  const out: NpcCandidate[] = [];
  const seen = new Set<string>();
  const push = (name: string, persona: string) => {
    const n = name.trim();
    const p = persona.replace(/【|】/g, "").trim();
    if (!n || seen.has(n)) return;
    seen.add(n);
    if (p) out.push({ name: n, persona: p });
  };

  // 章节/号码标题，用于跳过
  const isSectionHeading = (l: string) => /^(第|步骤|一、|二、|三、|四、|五、|六、|七、|八、|九、|十、|\d+[\.、])/.test(l)
    || /^##?\s*[一二三四五六七八九十\d]+[、.．]/.test(l)
    || /^(系统指令|主要数值|回覆格式|严格补充|语言规则|世界观|核心|感情|判定)/.test(l);

  // 剧本是否包含"角色卡定义"特征（有角色卡段落的剧本才启用格式1/2，
  // 避免把世界书/DM底座剧本里的【输出格式】块误当角色）
  const hasRoleCardSection = /角色创建|相关角色|角色卡|NPC角色|【玩家】|【主角】|姓名\s*[:：]?\s*【[^】]+】/.test(content);

  if (hasRoleCardSection) {
    // ── 格式1：姓名：【X】列表（如香港灵异/恶毒女配的角色创建段） ──
    const blockStart = lines.findIndex(l => /相关角色|角色创建|角色卡|NPC(角色|列表|设定)?|角色设定/.test(l));
    if (blockStart !== -1) {
      let cur: { name: string; rows: string[] } | null = null;
      const flush = () => {
        if (!cur) return;
        push(cur.name, cur.rows.join("\n"));
        cur = null;
      };
      for (let i = blockStart; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (isSectionHeading(line) && !/姓名/.test(line)) {
          if (cur) flush();
          if (/^(4|5|6|7|8|9)\.|^第|^主要数值|^系统指令|^回覆格式|^严格补充/.test(line)) break;
          continue;
        }
        const nm = line.match(/姓名\s*[:：]?\s*【([^】]+)】/);
        if (nm) {
          if (cur) flush();
          const raw = nm[1].trim();
          if (!raw) continue;
          cur = { name: raw, rows: [line.replace(/^\s*[·•-]\s*/, "")] };
          continue;
        }
        if (cur) cur.rows.push(line.replace(/^\s*[·•-]\s*/, ""));
      }
      if (cur) flush();
    }

    // ── 格式2：【角色名】方括号块（如租客模拟器的【房东】） ──
    const bracketRe = /^【([^】\s]{1,12})】\s*$/;
    const bracketBlockWords = /玩家|主角|你|我|系统|DM|通用|共用|机制|处理|补充|提醒|设置|信息|状态|规则|指令|格式|流程|边界|适用|当前|原文|附件|备注|示例|协议|面板|操作|登记|初始化|确认|剧情|正文|行动|观测|数据|局势|方向|场景|设定|名|类型|回声|方向|字段|大纲|章节|草案|版本|更新|提示|说明|图片|圖片|描述|提示词|企划|复盘|里程碑|判定/;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const bm = line.match(bracketRe);
      if (!bm) continue;
      const name = bm[1];
      if (bracketBlockWords.test(name)) continue;
      // 收集该块下直到下一个【 或 章节标题 的内容
      const rows: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const nl = lines[j].trim();
        if (!nl) continue;
        if (bracketRe.test(nl) || isSectionHeading(nl)) break;
        rows.push(nl);
      }
      if (rows.length) push(name, [line, ...rows].join("\n"));
    }
  }

  // ── 格式3：# 角色名（外文原名）markdown 标题角色卡（如李帝努（Lee Jeno））。
  // 特征：括号里含拉丁字母（英文/韩文原名），且不是 CP 组合名（×/&/和）。
  const mdRoleWords = /角色卡|模拟器|剧本|标题|定位|信息|设定|世界|故事|核心|机制|规则|指令|格式|附录|目录|大纲|模型|公开|关系|引擎/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!/^#\s/.test(line)) continue;
    const m = line.match(/^#\s*(.+)$/);
    if (!m) continue;
    const raw = m[1].trim();
    if (isSectionHeading(raw)) continue;
    // 括号内容必须含拉丁字母（英文/韩文原名），排除纯中文说明与 CP 组合
    const paren = raw.match(/[（(]([^（）()]{1,40})[）)]/);
    if (!paren) continue;
    const inside = paren[1];
    if (!/[A-Za-z가-힣]/.test(inside)) continue;
    if (/[×x×&和+＋]/.test(inside)) continue;
    const name = raw.replace(/[（(][^）)]*[）)]/g, "").trim();
    if (!name || mdRoleWords.test(name)) continue;
    const rows: string[] = [line];
    for (let j = i + 1; j < Math.min(lines.length, i + 25); j++) {
      const nl = lines[j].trim();
      if (/^#\s/.test(nl)) break;
      if (nl) rows.push(nl);
    }
    push(name, rows.join("\n"));
  }

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
    bindScriptWorldBooks(scriptId);
  }
  return { created: npcIds.length, chars: npcIds };
}

/**
 * 补建剧本 NPC 的私聊会话：若 privateSessionIds 中某会话已失效/被删，
 * 按原私聊通道自动重建，避免联动消息静默丢失。幂等。
 */
export function ensureScriptSessions(scriptId: string): void {
  const script = getScript(scriptId);
  if (!script || script.npcIds.length === 0) return;
  const sessions = loadChatSessions();
  const validPrivate: string[] = [];
  let changed = false;
  for (const npcId of script.npcIds) {
    const sid = script.privateSessionIds.find((id) => {
      const s = sessions.find((x) => x.id === id);
      return s && s.contactId === npcId;
    });
    if (sid) {
      validPrivate.push(sid);
      continue;
    }
    // 会话失效 → 按原私聊通道补建
    const contact = addChatContact(npcId);
    if (contact) {
      const session = createOrGetSession(npcId);
      validPrivate.push(session.id);
      changed = true;
    }
  }
  if (changed) {
    updateScript(scriptId, { privateSessionIds: validPrivate });
  }
}

/**
 * 剧本即世界书：把剧本原文注入为一个恒激活（constant）世界书条目，
 * 并绑定到该剧本的所有 NPC 角色（私聊 chat + 群聊 group_chat），
 * 让聊天引擎在扮演这些 NPC 时始终读取剧本约束，避免"乱聊"。
 * 幂等：同名剧本世界书已存在则复用，不重复创建。
 */
export function bindScriptWorldBooks(scriptId: string): string | null {
  const script = getScript(scriptId);
  if (!script || script.npcIds.length === 0) return null;

  const worldBookName = `剧本·${script.name}`;
  const books = loadWorldBooks();
  const existing = books.find(b => b.name === worldBookName);
  if (existing) return existing.id;

  const book = createWorldBook(worldBookName);
  book.description = `导入剧本「${script.name}」时自动生成的世界书，约束角色扮演不偏离剧本设定。`;
  book.entries = [{
    uid: `wb-entry_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    key: script.npcIds.join(","),
    content: script.content,
    comment: "剧本原文（玩家原创，恒激活）",
    use_regex: false,
    disable: false,
    constant: true,
    position: "before_char",
    insertion_order: 50,
  }];
  saveWorldBooks([book, ...books]);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("settings-worldbooks-updated"));
  }

  // 绑定到该剧本所有 NPC 的私聊与群聊槽位（合并已有，避免覆盖用户手动绑的书）
  const config = loadBindingConfig();
  for (const charId of script.npcIds) {
    const binding = getCharacterBinding(config, charId);
    const next: typeof binding = {
      ...binding,
      appOverrides: { ...binding.appOverrides },
    };
    for (const appId of ["chat", "group_chat"] as const) {
      const slot = next.appOverrides[appId] ?? {};
      next.appOverrides[appId] = {
        ...slot,
        worldBookIds: [...new Set([...(slot.worldBookIds ?? []), book.id])],
      };
    }
    config.characterBindings = setCharacterBinding(config, next).characterBindings;
  }
  saveBindingConfig(config);

  return book.id;
}

/** 删除剧本时清理其世界书及绑定引用。 */
export function cleanupScriptWorldBooks(scriptId: string): void {
  const script = getScript(scriptId);
  if (!script) return;
  const worldBookName = `剧本·${script.name}`;
  const books = loadWorldBooks();
  const target = books.find(b => b.name === worldBookName);
  if (target) {
    saveWorldBooks(books.filter(b => b.id !== target.id));
  }
  // 从该剧本 NPC 的绑定中移除引用
  const config = loadBindingConfig();
  let changed = false;
  for (const charId of script.npcIds) {
    const binding = getCharacterBinding(config, charId);
    let dirty = false;
    const appOverrides: typeof binding.appOverrides = {};
    for (const [appId, slot] of Object.entries(binding.appOverrides)) {
      if (!slot) continue;
      const worldBookIds = slot.worldBookIds?.filter(id => id !== target?.id) ?? [];
      if (worldBookIds.length !== (slot.worldBookIds?.length ?? 0)) dirty = true;
      if (worldBookIds.length || slot.apiConfigId || slot.presetId || slot.userIdentityId || (slot.regexIds?.length ?? 0)) {
        appOverrides[appId] = { ...slot, worldBookIds };
      }
    }
    if (dirty) {
      config.characterBindings = setCharacterBinding(config, { ...binding, appOverrides }).characterBindings;
      changed = true;
    }
  }
  if (changed) saveBindingConfig(config);
}