import { simpleLLMCall } from "./api-helpers";
import { loadApiConfigs, loadBindingConfig, loadUserIdentities, resolveBinding, resolveUserIdentity } from "./settings-storage";
import type { UserIdentity } from "@/components/settings/user-identity";
import type { ScripthubScript } from "./scripthub-storage";
import { kvGet } from "./kv-db";
import { loadChatSessions, loadChatMessages, pushChatMessage } from "./chat-storage";
import { loadCharacters } from "./character-storage";

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
  '  "linked_messages": [{"sender_name": "NPC名", "content": "NPC发给玩家的私聊内容（粤语可繁体）"}]',
  "}",
  "state_changes：本回合发生的属性增减（可为空 {}）。status_notes：本回合的剧情播报/结算条目（可为空 []）。",
  "linked_messages：本回合若有 NPC 通过聊天软件给玩家发消息（真实出现在私聊/群聊界面），就列出；没有则为空数组 []。sender_name 必须是剧本 NPC 的角色卡名字。",
].join("\n");

export type ScriptTurnResult = {
  narration: string;
  choices: string[];
  stateNotes: string[];
  stateChanges: Record<string, number>;
  linkedMessages: { senderName: string; content: string }[];
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

/** 组装剧本 DM 系统提示（注入剧本原文 + 选项规则 + 状态栏 + 面具 + 历史）。 */
export function buildScriptSystemPrompt(script: ScripthubScript, identity: UserIdentity | null): string {
  const parts: string[] = [];
  parts.push("你是本剧本的 DM（主持人），负责剧情推进、NPC 扮演、事件生成、属性结算、感情阶段控制。请完全遵循下面这个玩家原创剧本，不要参考或引入任何其他剧本。");
  parts.push("");
  parts.push("# 剧本原文");
  parts.push(script.content);
  parts.push("");
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
 * 运行一个剧本回合：把玩家行动 + 历史喂给 DM，生成正文、4 个选项与属性结算。
 * 成功后由调用方把 narration push 进 script.messages 并更新 stats。
 */
export async function runScriptTurn(
  script: ScripthubScript,
  userText: string,
  opts?: { signal?: AbortSignal },
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

  const parts: string[] = [];
  if (history) parts.push("# 剧情历史\n" + history);
  if (linkedChat) parts.push("# 剧情期间玩家与 NPC 的聊天记录\n" + linkedChat + "\n（以上聊天发生在剧情推进期间，请据此自然回应并计入剧情影响）");
  parts.push("# 玩家本轮行动\n" + userText);
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

  const choices: string[] = Array.isArray(p.choices) ? p.choices.filter((c: unknown) => typeof c === "string").slice(0, 4) : [];
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

  return { narration, choices, stateNotes, stateChanges, linkedMessages };
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
    const npc = chars.find(c => c.name === lm.senderName || c.name.includes(lm.senderName) || lm.senderName.includes(c.name));
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

/** 应用属性增减并生成状态栏注释（含播报合并）。 */
export function applyStateChanges(
  script: ScripthubScript,
  stateChanges: Record<string, number>,
  statusNotes: string[],
): { stats: Record<string, number>; stateNotes: string[] } {
  const stats = { ...script.stats };
  const notes: string[] = [];

  for (const [k, delta] of Object.entries(stateChanges)) {
    const max = script.statsMax[k];
    const next = max != null
      ? Math.max(0, Math.min(max, (stats[k] ?? 0) + delta))
      : Math.max(0, (stats[k] ?? 0) + delta);
    const actualDelta = next - (stats[k] ?? 0);
    stats[k] = next;
    if (actualDelta !== 0) notes.push(k + " " + (actualDelta > 0 ? "+" : "") + actualDelta);
  }
  // 首次出现且无变化的值也登记进 stats（保持状态栏显示）
  for (const k of Object.keys(stateChanges)) {
    if (!(k in stats)) stats[k] = stateChanges[k];
  }

  return { stats, stateNotes: [...notes, ...statusNotes] };
}