import { simpleLLMCall } from "./api-helpers";
import { loadApiConfigs, loadBindingConfig, loadUserIdentities, resolveBinding, resolveUserIdentity } from "./settings-storage";
import type { UserIdentity } from "@/components/settings/user-identity";
import type { ScripthubScript, PlayerCardField } from "./scripthub-storage";
import { kvGet } from "./kv-db";
import { loadChatSessions, loadChatMessages, pushChatMessage } from "./chat-storage";
import { loadCharacters } from "./character-storage";
import { addMomentPost, loadMomentPosts } from "./moments-storage";
import { upsertCalendarScheduleItem, buildCalendarScheduleMarker } from "./calendar-storage";
import { getWeekStartIso } from "./calendar-utils";
import { createDiaryEntry, loadDiaryEntries } from "./diary-entry-storage";

export const SCRIPTHUB_BINDING_APP_ID = "scripthub";
export const CHAT_SCRIPTHUB_MODE_PREFIX = "chat-scripthub-mode:";

/** 从 LLM 输出中提取 JSON 对象/数组文本（容忍 markdown 围栏等噪音）。 */
function extractJSON(text: string): string {
  const fence = String.fromCharCode(96).repeat(3);
  const fenced = text.match(new RegExp(fence + "(?:json)?\\s*([\\s\\S]*?)" + fence));
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[{[]/);
  if (start === -1) return candidate.trim();
  const open = candidate[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return candidate.slice(start);
}

// ── 骰子 · 选项清洗 · NPC 精准匹配（剧本工坊独立增强，不碰原 map-rpg-engine） ──
/** 真掷骰子：返回 1~sides 整数（代码层真实随机，非 AI 嘴上说）。 */
export function rollDice(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

/** 真掷 D20（1~20）。 */
export function rollD20(): number {
  return rollDice(20);
}

/** 代码层清洗 AI 输出的 4 个选项：剔除"自定义行动"类占位、去重、保底恰好 4 个。 */
function sanitizeChoices(raw: unknown): string[] {
  const placeholders = /自定义行动|自由发挥|自行输入|自己输入|其他方式|其它选项|玩家自定义|让玩家自行决定/;
  let list = (Array.isArray(raw) ? raw : [])
    .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    .filter((c) => !placeholders.test(c))
    .map((c) => c.trim());
  const seen = new Set<string>();
  list = list.filter((c) => (seen.has(c) ? false : (seen.add(c), true)));
  list = list.slice(0, 4);
  const FALLBACK = [
    "静观其变，观察局势变化",
    "环顾四周，寻找线索与细节",
    "与身边的人攀谈，试探虚实",
    "回顾目前的线索与处境，斟酌下一步",
    "按兵不动，稳妥应对眼前局面",
    "主动推进，向对方试探底线",
  ];
  let fi = 0;
  while (list.length < 4 && fi < FALLBACK.length) {
    const f = FALLBACK[fi++];
    if (!seen.has(f)) {
      list.push(f);
      seen.add(f);
    }
  }
  return list;
}

/** NPC 名字精准匹配：精确相等优先，去空格/括号归一化次之；避免"医生"误中"法医医生"这类双向子串误判。 */
function findNpcByName(chars: { id: string; name: string }[], name: string): { id: string; name: string } | undefined {
  if (!name) return undefined;
  const exact = chars.find((c) => c.name === name);
  if (exact) return exact;
  const norm = (s: string) => s.replace(/[【】()（）\s]/g, "");
  const n = norm(name);
  const ne = chars.find((c) => norm(c.name) === n);
  if (ne) return ne;
  if (n.length >= 3) {
    const part = chars.find((c) => c.name.includes(name) || norm(c.name).includes(n));
    if (part) return part;
  }
  return undefined;
}

// ── 每回合行动选项规则（已确认，写入 DM 提示词强制生效） ──
const CHOICE_RULES = [
  "每回合的行动选项必须严格遵守以下规则：",
  "1. 数量固定：A/B/C/D 恰好四个，不多不少。",
  "2. 禁止'自定义行动'占位：禁止出现'自定义行动/自由发挥/其他'这类把选择权抛回给玩家的选项（玩家自由输入走输入框）。但允许'按兵不动/静观其变'这类有意义的保守选择。",
  "3. 全部可行：每个选项必须是当前剧情下真实可行的具体行动，含明确动作和目标。",
  "4. 方向不重叠：4 个选项导向 4 个不同方向，按剧情灵活覆盖：推进主线 / 探索调查 / 社交互动 / 经营准备 / 冒险豪赌（明示风险）/ 稳妥保守（安全但收益小）。",
  "5. 机制挂钩：每个选项末尾用括号标注触发效果，如（行动点-1）（D20判定）（金钱-200）（好感+2）（理智-5）。",
  "6. 风险透明：有风险的选项必须把代价写进括号，不藏不哄；选项间风险差异要明显，让玩家真正权衡。",
  "7. 事件来源优先级：优先看剧本原文——若剧本定义了事件表/触发规则（如租客的 D20 日常事件表、特殊触发事件），严格按剧本预设触发，选项围绕被触发事件展开；剧本只给机制未写具体事件（如香港灵异），由你基于上一段剧情即时生成事件，再围绕它出选项。",
  "8. 贴合当前：选项内容由'本剧本设定 + 上一回合剧情 + 玩家当前处境'推导，禁止套用通用模板。",
].join("\n");

// ── 回覆格式（结算播报进状态栏，正文只留叙述与对话） ──
const REPLY_FORMAT = [
  "请严格按以下 JSON 格式回复（不要输出任何其他文字）：",
  "{",
  '  "narration": "本回合的场景叙述与剧情正文（简体中文；香港NPC对白可用粤语繁体）。只写叙述与对话，不写状态变化播报。",',
  '  "choices": ["选项A（效果）", "选项B（效果）", "选项C（效果）", "选项D（效果）"],',
  '  "state_changes": { "好感值": 2, "理智值": -5 },',
  '  "status_notes": ["剧情播报/结算条目，如：新委讬登记完成", "酬劳 3200（先付一半）"],',
  '  "linked_messages": [{"sender_name": "NPC名", "content": "NPC发给玩家的私聊内容（粤语可繁体）"}],',
  '  "linked_posts": [{"author_name": "NPC名", "content": "NPC发的朋友圈正文"}],',
  '  "linked_calendar": [{"date": "2026-08-21", "start_time": "10:00", "end_time": "11:00", "title": "事件标题", "location": "地点", "owner_name": "归属NPC名"}],',
  '  "linked_diary": [{"author_name": "NPC名", "title": "手记标题", "body": "手记正文"}]',
  "}",
  "state_changes：本回合发生的属性增减（可为空 {}）。status_notes：本回合的剧情播报/结算条目（可为空 []）。",
  "linked_messages：本回合若有 NPC 通过聊天软件给玩家发消息（真实出现在私聊/群聊界面），就列出；没有则为空数组 []。sender_name 必须是剧本 NPC 的角色卡名字。",
  "linked_posts：本回合 NPC 发的朋友圈（真实出现在朋友圈）；author_name 必须是剧本 NPC 名字；没有为空 []。",
  "linked_calendar：本回合新增到日历的剧情事件（真实写入对应 NPC 或玩家的日历）；owner_name 可为 NPC 名或「玩家」；date 为 YYYY-MM-DD；没有为空 []。",
  "linked_diary：本回合 NPC 写的手记/日记（真实写入手记应用）；author_name 必须是剧本 NPC 名字；没有为空 []。",
].join("\n");

export type ScriptTurnResult = {
  narration: string;
  choices: string[];
  stateNotes: string[];
  stateChanges: Record<string, number>;
  linkedMessages: { senderName: string; content: string }[];
  linkedPosts: { authorName: string; content: string }[];
  linkedCalendar: { date: string; startTime: string; endTime: string; title: string; location?: string; ownerName: string }[];
  linkedDiary: { authorName: string; title: string; body: string }[];
};

export function formatScriptStats(script: ScripthubScript): string {
  const labels = Object.keys(script.stats);
  if (labels.length === 0) return "（尚无属性数据）";
  return labels.map((k) => {
    const v = script.stats[k];
    const max = script.statsMax[k];
    return max != null ? k + " " + v + "/" + max : k + " " + v;
  }).join(" · ");
}

function resolveApiConfig(): ReturnType<typeof loadApiConfigs>[number] | null {
  const configs = loadApiConfigs();
  if (configs.length === 0) return null;
  try {
    const bindings = loadBindingConfig();
    const slot = resolveBinding(bindings, undefined, SCRIPTHUB_BINDING_APP_ID);
    return configs.find((c) => c.id === slot.apiConfigId) ?? configs[0];
  } catch {
    return configs[0];
  }
}

function buildMaskText(identity: UserIdentity | null): string {
  if (!identity) return "玩家面具：未设置（使用默认玩家视角）";
  let out = "玩家面具：姓名「" + identity.name + "」";
  if (identity.gender) out += "，性别" + identity.gender;
  if (identity.age) out += "，" + identity.age + "岁";
  if (identity.occupation) out += "，" + identity.occupation;
  if (identity.bio) out += "\n玩家自述：" + identity.bio;
  return out;
}

/** 玩家角色卡文本（已确认的字段注入 DM 提示词；未确认不注入）。 */
function buildPlayerCardText(script: ScripthubScript): string {
  const card = script.playerCard;
  if (!card || card.status !== "confirmed" || card.fields.length === 0) return "";
  return card.fields.map((f) => f.label + "：" + (f.value.trim() || "（玩家未填）")).join("\n");
}

/**
 * AI 草稿制：读剧本原文，产出「游戏开始前需玩家本人填写/确认」的角色卡字段草稿。
 * 剧本已给出的值原文预填；留白项 value 置空串、由 hint 提示填法（hint 拼进 label 展示）。
 */
export async function draftPlayerCard(script: ScripthubScript): Promise<PlayerCardField[]> {
  const apiConfig = resolveApiConfig();
  if (!apiConfig) throw new Error("尚未配置 API。请先到 设置 → API 配置 添加一个可用的接口。");

  const system = [
    "你是剧本解析助手。阅读下面这个玩家原创剧本，找出游戏正式开始前需要【玩家本人】填写或确认的角色信息字段。",
    "规则：",
    "1. 只列与玩家（主控）角色相关的字段；NPC 的信息不要列为待填项。",
    "2. 剧本已明确给出的值直接预填进 value（原文搬运，零改编）；剧本留白或标注「请补充/随机/可选」的，value 置为空字符串，并在 hint 里写清填法（如：请补充3~5个词 / 困难、勉强度日、普通三选一 / 可填「随机」）。",
    "3. 字段名 label 保持剧本原文的叫法（如：姓名、性别、年级/专业、性格倾向、经济紧张程度）。",
    "4. 字段数量控制在 3~12 个；没有需要玩家填写的字段时返回空数组。",
    "5. 严格只输出 JSON，不要任何其他文字：{\"fields\":[{\"label\":\"字段名\",\"value\":\"预填值或空串\",\"hint\":\"填法提示或空串\"}]}",
  ].join("\n");
  const messages = [
    { role: "system", content: system },
    { role: "user", content: "# 剧本原文\n" + script.content },
  ];
  const result = await simpleLLMCall(apiConfig, messages, { temperature: 0.2 });
  if (!result.content) throw new Error("AI 解析失败：" + (result.error || "返回空内容"));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let p: any;
  try {
    p = JSON.parse(extractJSON(result.content));
  } catch (err) {
    throw new Error("AI 返回格式错误，无法解析：" + (err as Error).message);
  }
  const fields: PlayerCardField[] = Array.isArray(p.fields)
    ? p.fields
        .filter((f: unknown) => f && typeof (f as { label?: unknown }).label === "string")
        .map((f: { label: string; value?: unknown; hint?: unknown }): PlayerCardField => ({
          label: String(f.label).trim(),
          value: typeof f.value === "string" ? f.value : "",
          ...(typeof f.hint === "string" && f.hint.trim() ? { hint: f.hint.trim() } : {}),
        }))
        .filter((f: PlayerCardField) => f.label && !/npc|房东|房東|对方角色/.test(f.label))
    : [];
  return fields;
}

/** 组装剧本 DM 系统提示（注入剧本原文 + 玩家角色卡 + 选项规则 + 状态栏 + 面具 + 历史）。 */
export function buildScriptSystemPrompt(script: ScripthubScript, identity: UserIdentity | null): string {
  const parts: string[] = [];
  parts.push("你是本剧本的 DM（主持人），负责剧情推进、NPC 扮演、事件生成、属性结算、感情阶段控制。请完全遵循下面这个玩家原创剧本，不要参考或引入任何其他剧本。");
  parts.push("");
  parts.push("# 剧本原文");
  parts.push(script.content);
  parts.push("");
  const playerCard = buildPlayerCardText(script);
  if (playerCard) {
    parts.push("# 玩家角色卡（游戏开始前已由玩家确认，直接采用，禁止再向玩家索要这些信息）");
    parts.push(playerCard);
    parts.push("");
  }
  parts.push("# 当前状态栏");
  parts.push(formatScriptStats(script));
  parts.push("");
  parts.push("# 当前回合");
  parts.push("第 " + script.round + " 回合");
  parts.push("");
  parts.push("# 面具");
  parts.push(buildMaskText(identity));
  parts.push("");
  parts.push(CHOICE_RULES);
  parts.push("");
  parts.push(REPLY_FORMAT);
  return parts.join("\n");
}

/**
 * 读取剧本绑定的私聊/群聊会话中「跑团联动」开启者，返回最近聊天内容摘要。
 * 这些消息会被视为"剧情期间玩家与 NPC 在聊天里说的话"，注入回合上下文影响后文。
 */
export function buildLinkedChatContext(script: ScripthubScript, maxPerSession = 8): string {
  const linkedSessionIds = [...script.privateSessionIds, ...script.groupSessionIds].filter(id =>
    kvGet(CHAT_SCRIPTHUB_MODE_PREFIX + id) === "1",
  );
  if (linkedSessionIds.length === 0) return "";

  const chars = loadCharacters();
  const nameOf = (characterId: string): string => {
    const c = chars.find(ch => ch.id === characterId);
    return c ? c.name : characterId;
  };

  const sessions = loadChatSessions();
  const blocks: string[] = [];

  for (const sessionId of linkedSessionIds) {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) continue;
    const messages = loadChatMessages(sessionId, maxPerSession);
    if (messages.length === 0) continue;

    const lines: string[] = [];
    for (const m of messages) {
      if (m.role === "user") {
        lines.push("玩家：" + m.content);
      } else if (m.role === "assistant") {
        const speaker = session.isGroup ? (m.senderCharacterId ? nameOf(m.senderCharacterId) : m.senderName || "对方") : nameOf(session.contactId);
        lines.push(speaker + "：" + m.content);
      }
    }
    if (lines.length) {
      blocks.push("【聊天会话】\n" + lines.join("\n"));
    }
  }

  return blocks.join("\n\n");
}

/**
 * 读取剧本绑定的朋友圈 / 日历 / 手记最近内容，注入回合上下文，
 * 让 DM 的剧情与这些联动应用呼应（玩家在应用里的互动影响后文）。
 */
export function buildLinkedAppsContext(script: ScripthubScript): string {
  const chars = loadCharacters();
  const npcNames = new Set(script.npcIds.map(id => chars.find(c => c.id === id)?.name).filter(Boolean) as string[]);
  const blocks: string[] = [];

  // 朋友圈：剧本 NPC 最近发的帖（按角色过滤）
  try {
    const posts = loadMomentPosts().slice(0, 12);
    const npcPosts = posts.filter(p => p.authorType === "character" && npcNames.has(p.authorId));
    if (npcPosts.length) {
      const lines = npcPosts.map(p => {
        const author = chars.find(c => c.id === p.authorId)?.name || p.authorId;
        return author + "：" + p.content;
      });
      blocks.push("【朋友圈】\n" + lines.join("\n"));
    }
  } catch {
    // ignore
  }

  // 日历：本周剧本 NPC 的日程
  try {
    for (const charId of script.npcIds.slice(0, 5)) {
      const marker = buildCalendarScheduleMarker("character", charId, getWeekStartIso(new Date()));
      if (marker) blocks.push("【日历】" + marker);
    }
  } catch {
    // ignore
  }

  // 手记：剧本 NPC 最近写的手记
  try {
    const entries = loadDiaryEntries()
      .filter(e => script.npcIds.includes(e.characterId))
      .slice(0, 8);
    if (entries.length) {
      const lines = entries.map(e => e.characterName + "《" + e.title + "》：" + e.body.slice(0, 120));
      blocks.push("【手记】\n" + lines.join("\n"));
    }
  } catch {
    // ignore
  }

  return blocks.join("\n\n");
}

/**
 * 运行一个剧本回合：把玩家行动 + 历史喂给 DM，生成正文、4 个选项与属性结算。
 * 成功后由调用方把 narration push 进 script.messages 并更新 stats。
 */
export async function runScriptTurn(
  script: ScripthubScript,
  userText: string,
  opts?: { signal?: AbortSignal; opening?: boolean },
): Promise<ScriptTurnResult> {
  const apiConfig = resolveApiConfig();
  if (!apiConfig) {
    throw new Error("尚未配置 API。请先到 设置 → API 配置 添加一个可用的接口。");
  }

  let identity: UserIdentity | null = null;
  try {
    const identities = loadUserIdentities();
    identity = script.userIdentityId
      ? identities.find((i) => i.id === script.userIdentityId) ?? null
      : resolveUserIdentity();
  } catch {
    identity = resolveUserIdentity();
  }

  const system = buildScriptSystemPrompt(script, identity);

  // 历史：最近若干条消息（用户行动 + DM 正文交替）
  const history = script.messages
    .slice(-14)
    .map((m) => (m.role === "user" ? "玩家：" : "DM：") + m.content)
    .join("\n\n");

  // 联动聊天：跑团联动开启的私聊/群聊里玩家与 NPC 的对话，作为剧情期间的社交行为
  const linkedChat = buildLinkedChatContext(script);
  // 联动应用：朋友圈/日历/手记最近内容
  const linkedApps = buildLinkedAppsContext(script);

  const parts: string[] = [];
  if (history) parts.push("# 剧情历史\n" + history);
  if (linkedChat) parts.push("# 剧情期间玩家与 NPC 的聊天记录\n" + linkedChat + "\n（以上聊天发生在剧情推进期间，请据此自然回应并计入剧情影响）");
  if (linkedApps) parts.push("# 联动应用动态\n" + linkedApps + "\n（以上来自朋友圈/日历/手记，请据此保持剧情连贯）");
  if (opts?.opening) {
    parts.push(
      "# 系统指令（开场回合）",
      "这是本剧本的第一回合。请直接根据剧本原文" + (buildPlayerCardText(script) ? "与玩家角色卡" : "") + "生成本剧本的开场剧情（第一幕）：",
      "- 交代开场场景、时间、玩家身份处境与出场 NPC；",
      "- 剧情正文自然推进到一个需要玩家决策的点，并以 4 个行动选项收尾；",
      "- 禁止在正文里向玩家索要任何角色卡/设定信息（这些已在准备工作确认完毕）；",
      "- 其余规则（选项规则、回覆格式）照常执行。",
    );
  } else {
    parts.push("# 玩家本轮行动\n" + userText);
  }
  const userMsg = parts.join("\n\n");

  const messages = [
    { role: "system", content: system },
    { role: "user", content: userMsg },
  ];

  const result = await simpleLLMCall(apiConfig, messages, { temperature: 0.8, signal: opts?.signal });

  if (!result.content) {
    throw new Error("DM 调用失败：" + (result.error || "返回空内容") + "（模型 " + apiConfig.defaultModel + "）");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let p: any;
  try {
    p = JSON.parse(extractJSON(result.content));
  } catch (err) {
    throw new Error("DM 返回格式错误，无法解析：" + (err as Error).message);
  }

  const narration = typeof p.narration === "string" ? p.narration : "";
  if (!narration) throw new Error("DM 返回内容为空");

  const choices: string[] = sanitizeChoices(p.choices);
  const stateChanges: Record<string, number> = {};
  if (p.state_changes && typeof p.state_changes === "object") {
    for (const [k, v] of Object.entries(p.state_changes)) {
      if (typeof v === "number") stateChanges[k] = v;
    }
  }
  const stateNotes: string[] = Array.isArray(p.status_notes) ? p.status_notes.filter((n: unknown) => typeof n === "string") : [];
  const linkedMessages: { senderName: string; content: string }[] = Array.isArray(p.linked_messages)
    ? p.linked_messages
        .filter((m: unknown) => m && typeof m === "object" && typeof (m as { sender_name?: unknown }).sender_name === "string" && typeof (m as { content?: unknown }).content === "string")
        .map((m: Record<string, unknown>) => ({ senderName: m.sender_name as string, content: m.content as string }))
    : [];

  const linkedPosts: { authorName: string; content: string }[] = Array.isArray(p.linked_posts)
    ? p.linked_posts
        .filter((m: unknown) => m && typeof m === "object" && typeof (m as { author_name?: unknown }).author_name === "string" && typeof (m as { content?: unknown }).content === "string")
        .map((m: Record<string, unknown>) => ({ authorName: m.author_name as string, content: m.content as string }))
    : [];

  const linkedCalendar: ScriptTurnResult["linkedCalendar"] = Array.isArray(p.linked_calendar)
    ? p.linked_calendar
        .filter((m: unknown) => m && typeof m === "object" && typeof (m as { title?: unknown }).title === "string" && typeof (m as { date?: unknown }).date === "string")
        .map((m: Record<string, unknown>) => ({
          date: m.date as string,
          startTime: typeof m.start_time === "string" ? m.start_time : "10:00",
          endTime: typeof m.end_time === "string" ? m.end_time : "11:00",
          title: m.title as string,
          location: typeof m.location === "string" ? m.location : undefined,
          ownerName: typeof m.owner_name === "string" ? m.owner_name : "玩家",
        }))
    : [];

  const linkedDiary: ScriptTurnResult["linkedDiary"] = Array.isArray(p.linked_diary)
    ? p.linked_diary
        .filter((m: unknown) => m && typeof m === "object" && typeof (m as { author_name?: unknown }).author_name === "string" && typeof (m as { body?: unknown }).body === "string")
        .map((m: Record<string, unknown>) => ({
          authorName: m.author_name as string,
          title: typeof m.title === "string" ? m.title : "无题",
          body: m.body as string,
        }))
    : [];

  return { narration, choices, stateNotes, stateChanges, linkedMessages, linkedPosts, linkedCalendar, linkedDiary };
}

/**
 * 把回合里 NPC 要发的私聊/群聊消息真实推送到聊天会话（置未读，出现在聊天界面）。
 * 按 sender_name 匹配剧本 NPC 角色卡，发到对应的私聊会话；群聊会话按包含该 NPC 匹配。
 */
export function deliverLinkedMessages(script: ScripthubScript, messages: { senderName: string; content: string }[]): number {
  if (messages.length === 0) return 0;
  const chars = loadCharacters();
  const sessions = loadChatSessions();
  let delivered = 0;

  for (const lm of messages) {
    const npc = findNpcByName(chars, lm.senderName);
    if (!npc) continue;
    // 优先发到该 NPC 的私聊会话
    const sessionId = script.privateSessionIds.find(sid => {
      const s = sessions.find(x => x.id === sid);
      return s && s.contactId === npc.id;
    });
    const targetSessionId = sessionId
      ?? script.groupSessionIds.find(sid => {
        const s = sessions.find(x => x.id === sid);
        return s && Array.isArray(s.participantIds) && s.participantIds.includes(npc.id);
      });
    if (!targetSessionId) continue;
    pushChatMessage({
      sessionId: targetSessionId,
      role: "assistant",
      content: lm.content,
      senderCharacterId: npc.id,
      senderName: npc.name,
    });
    delivered += 1;
  }
  return delivered;
}

/**
 * 把回合里 NPC 发的朋友圈真实写入朋友圈（所有联系人可见），并刷新 UI。
 * 按 author_name 匹配剧本 NPC 角色卡；找不到作者则跳过。
 */
export function deliverLinkedPosts(script: ScripthubScript, posts: { authorName: string; content: string }[]): number {
  if (posts.length === 0) return 0;
  const chars = loadCharacters();
  const contacts = loadChatSessions();
  let delivered = 0;
  for (const p of posts) {
    const npc = findNpcByName(chars, p.authorName);
    if (!npc) continue;
    const visibility = contacts.map(c => c.contactId).filter(Boolean);
    const post = addMomentPost({
      authorType: "character",
      authorId: npc.id,
      content: p.content,
      visibility,
    });
    if (post) delivered += 1;
  }
  if (delivered > 0 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("moments-updated"));
  }
  return delivered;
}

/**
 * 把回合里的剧情事件写入对应归属方（NPC 或玩家）的日历，并刷新 UI。
 */
export function deliverLinkedCalendar(script: ScripthubScript, events: ScriptTurnResult["linkedCalendar"]): number {
  if (events.length === 0) return 0;
  const chars = loadCharacters();
  let delivered = 0;
  for (const ev of events) {
    let ownerId: string | null = null;
    let ownerType: "character" | "user" = "character";
    if (ev.ownerName === "玩家" || ev.ownerName === "player" || ev.ownerName === "我") {
      ownerType = "user";
      ownerId = "user";
    } else {
      const npc = findNpcByName(chars, ev.ownerName);
      if (!npc) continue;
      ownerId = npc.id;
    }
    if (!ownerId) continue;
    try {
      upsertCalendarScheduleItem(ownerType, ownerId, getWeekStartIso(new Date(ev.date)), {
        date: ev.date,
        startTime: ev.startTime,
        endTime: ev.endTime,
        title: ev.title,
        location: ev.location ?? "",
        emoji: "📋",
        source: "generated",
      });
      delivered += 1;
    } catch {
      // 日期格式异常跳过
    }
  }
  if (delivered > 0 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("calendar-updated"));
  }
  return delivered;
}

/**
 * 把回合里 NPC 写的手记真实写入日记应用，并刷新 UI。
 */
export function deliverLinkedDiary(script: ScripthubScript, entries: ScriptTurnResult["linkedDiary"]): number {
  if (entries.length === 0) return 0;
  const chars = loadCharacters();
  let delivered = 0;
  for (const e of entries) {
    const npc = findNpcByName(chars, e.authorName);
    if (!npc) continue;
    createDiaryEntry({
      characterId: npc.id,
      characterName: npc.name,
      title: e.title,
      body: e.body,
      blocks: [{ type: "paragraph", text: e.body }],
      trigger: "manual",
    });
    delivered += 1;
  }
  if (delivered > 0 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("diary-entries-updated"));
  }
  return delivered;
}

/** 应用属性增减并生成状态栏注释（含播报合并）。 */
export function applyStateChanges(
  script: ScripthubScript,
  stateChanges: Record<string, number>,
  statusNotes: string[],
): { stats: Record<string, number>; statsMax: Record<string, number>; stateNotes: string[] } {
  const stats = { ...script.stats };
  const statsMax = { ...script.statsMax };
  const notes: string[] = [];

  for (const [k, delta] of Object.entries(stateChanges)) {
    const prev = stats[k] ?? 0;
    const next = Math.max(0, prev + delta);
    // 上限初始化：首次出现的属性默认上限 100；数值超过上限时按 50 一档向上扩容（如金钱 3200 不会被硬砍在 100）
    let max = statsMax[k];
    if (max == null) max = 100;
    if (next > max) max = Math.ceil(next / 50) * 50;
    statsMax[k] = max;
    stats[k] = next;
    const actualDelta = next - prev;
    if (actualDelta !== 0) notes.push(k + " " + (actualDelta > 0 ? "+" : "") + actualDelta);
  }

  return { stats, statsMax, stateNotes: [...notes, ...statusNotes] };
}