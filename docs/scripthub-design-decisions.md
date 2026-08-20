# 剧本工坊 · 设计决策记录

> 本文件记录与用户逐轮确认的产品/引擎设计决策。正式开发时以此为准。
> 记录日期：2026-08-20（预览阶段）

## 一、总体方向（已确认）

- **剧本均为用户原创剧本**，与任何外部站点（如 ChelizAI 等）无关：不参考、不涉及、不内置，全部来自用户本地剧本文件（`D:\ChromeDownload\idm文档\模拟器小手机\模拟器剧本们\`）。
- **方向一：通用规则引擎**，独立入口「剧本工坊」。
- 引擎底座：**拷贝 `map-rpg-engine` 作起点**（原跑团代码零改动，拷贝一份再改）。
- 联动模式：**A 真实联动 + 全自动引擎操盘**。
- 联动功能：私聊 / 群聊 / 朋友圈 / 日历 / 购物金钱 / 角色库 / 手记 七项全通；AI 图片生成延后。
- 属性更新：**全自动**（LLM 回复附带 `<<STATE>>{"属性名":±n}<<END>>` 由引擎解析，clamp 校验，解析失败跳过 + 手动兜底）。
- 试点剧本：**香港灵异模拟器**。
- 范围只做两种模式：
  - 模式A 全结构化（香港灵异 / 租客 / 恶毒女配 / 追妻 / 先婚后爱 / backroom）
  - 模式B 有角色无数值（NCT机智的医生生活，只建角色卡、属性面板留空、LLM 自由演）
- **韩娱职业模拟器：永久忽略，不参考、不实现、不入列表**（用户明确不玩）。

## 二、剧本工坊 = 启动器（已确认）

非剧本状态手机保持原样。导入剧本后流程：

1. 导入剧本（支持 .txt / .json / .png）
2. 引擎按剧本原文自动生成 NPC 角色卡并建联系人（**原文搬运，零 AI 改编**）
3. 面具（UserIdentity）由玩家建/选，弹窗直达设置页
4. 会话绑定（记录面具 id + 角色卡 ids）
5. 全部就绪才亮「开始游戏」

## 三、AI 解析防翻车机制（已确认）

- 剧本原文 / NPC 人设：**永远原文搬运，不走 AI 改编**。
- 只有 schema 翻译走 AI，且为**草稿制**：AI 翻译结果给用户逐项确认后才生效。
- 格式校验不合格拒收重试；完全解析不动可退回纯原文模式。
- 剧本文件**一字不改**。

## 四、每回合行动选项规则（本轮确认，重点）

用户逐条修订后的最终规则，写入引擎提示词（promptTemplate）强制生效：

1. **数量固定**：A/B/C/D 四个，不多不少。
2. **禁止"自定义行动"占位**：严厉禁止"自定义行动 / 自由发挥 / 其他"这类把选择权抛回给玩家的选项（玩家自由输入走自己的输入框）。
   但允许"按兵不动 / 静观其变"这类**有意义的保守选择**——它是真实决策，不算占位。
3. **全部可行**：每个选项必须是当前剧情下真实可行的具体行动，含明确动作和目标。
4. **方向不重叠**：4 个选项导向 4 个不同方向，按剧情灵活覆盖：推进主线 / 探索调查 / 社交互动 / 经营准备 / 冒险豪赌（明示风险）/ 稳妥保守（安全但收益小）。
5. **机制挂钩**：每个选项末尾用括号标注触发效果，如（行动点-1）（D20判定）（金钱-200）（好感+2）（理智-5）。
6. **风险透明**：有风险的选项必须把代价写进括号，不藏不哄；选项间风险差异要明显，让玩家真正权衡。
7. **事件来源优先级**：优先看剧本原文——若剧本定义了事件表/触发规则（如租客的 D20 日常事件表、特殊触发事件），严格按剧本预设触发，选项围绕被触发事件展开；剧本只给机制未写具体事件（如香港灵异），由 AI 基于上一段剧情即时生成事件，再围绕它出选项。
8. **贴合当前**：选项内容由"本剧本设定 + 上一回合剧情 + 玩家当前处境"推导，禁止套用通用模板。

### 选项生成性能方案（已确认）

- 真实瓶颈在**剧情正文**（每回合 ≥600 字，800–1500 token，30s+），选项本身仅 100–200 token（几秒）。
- 时序方案：先流式输出剧情叙述（打字机效果），**玩家读剧情时选项请求并行发出**，读完时选项已就绪，几乎感知不到额外等待。
- 加速手段：剧本预设事件表（租客 D20）输入更短更快；选项短可流式显示；历史回合选项缓存（回看秒开）。

## 五、界面方案（预览阶段确认）

- 独立预览路由 `/scripthub-preview`（middleware PUBLIC_ROUTE_PREFIXES 已加白名单，绕过账号门；dev 端口 3001）。
- 三屏结构：① 剧本工坊主页 ② 准备工作 ③ 游戏进行中。
- 三屏复用真实源码组件：MapLobby 的 S 样式体系（屏1/2）、ChatPageHeader / StateValuesPanel / MessageBubble / chat-app 容器（屏3）。
- **状态栏（属性面板）排版 = 方案A 文字清单型**（最终确认）：
  - 无进度条，纯数字。
  - 可折叠：平时收起，输入框左侧 `＋` 圆形按钮点开才展开（展开时按钮变 `×`），面板出现在输入框上方。
  - 两列网格，格式 `标签 值/上限`，等宽数字字体，如：生命 100/100 · 理智 86/100 · 混乱 8/100 · 好感 35/100 · 金钱 $3,200 · 行动点 2/5。
- **行动选项**：只显示 AI 生成的选项，不包含"自订行动"项。
- **游戏正文不出现装饰性 emoji**：消息正文、行动选项一律纯文字，不用 ☯✔ 等符号开头（已确认，预览已改）。
- **剧本封面 emoji 保留但可编辑**：主页剧本卡片保留封面 emoji，且必须满足：
  - 不同剧本默认配不同 emoji（作为剧本元数据 `emoji` 字段，导入时按剧本类型自动分配默认值）；
  - 玩家可以自己修改（正式版提供编辑入口，改完持久化到剧本元数据）。
- 顶部仅保留一行会话信息（第X天 · 上午 · 委托：…）+ 回合制标记。
- **剧本工坊主页初始为空**：正式版**不内置任何剧本**，主页默认 0 个剧本（空状态：提示 + 导入按钮），所有剧本均需玩家手动导入。预览页的 7 个假剧本仅为排版展示，正式版不存在。

## 六、正式版实现记录（本轮已完成，2026-08-20）

- **桌面入口**：`desktop-config.ts` 新增 `scripthub` 图标（label「剧本工坊」，tone violet，默认页3），`icon-glyph.tsx` 加 mdiDramaMasks，`desktop-shell.tsx` renderAppBody 注册 `<ScriptHubApp>` + hydrate 调用。
- **存储层** `lib/scripthub-storage.ts`：Dexie `AiPhoneScriptHubDB` 表 scripts 持久化剧本（含原文 content），内存缓存；CRUD + 启发式解析 `parseScriptText`（标题/模式A/B） + NPC 提取 `extractNpcCandidates` + 角色卡生成 `ensureScriptNpcs`。
- **应用层** `components/scripthub/scripthub-app.tsx` 三屏：
  - 主页：空状态（0 剧本）+ 导入 .txt/.json（复用 reading-parser 编码检测）+ 卡片列表 + 删除。
  - 准备工作：首次进入自动 `ensureScriptNpcs`（原文搬运 → createCharacter → addChatContact → createOrGetSession），列出真实角色卡；面具从 loadUserIdentities 选择（写 script.userIdentityId）；全部就绪才亮「开始游戏」。
  - 游戏进行中：跑团正文（真实消息流 + ChatPageHeader/MessageBubble）+ 输入框 + 4 行动选项 + 状态栏（＋折叠）+ 西幻分割线 + 绿宝石呼吸灯；回合引擎驱动。
- **回合引擎** `lib/scripthub-engine.ts`：`runScriptTurn` 组装 DM 提示（剧本原文 + 8条选项规则 + 状态栏 + 面具 + 历史 + 联动聊天）→ simpleLLMCall → 解析 JSON（narration/choices/state_changes/status_notes/linked_messages）→ `applyStateChanges` 结算属性生成状态栏注释。复用 resolveBinding/resolveUserIdentity/loadApiConfigs 取 API。
- **跑团联动开关**：聊天 `+` 菜单新增「跑团联动」（照抄番外指令模式，`active` 高亮），per-session kv `chat-scripthub-mode:<sessionId>`，chat-room.tsx 经 props 传入 ChatTextInputBar。
- **私聊/群聊双向打通（本轮核心）**：
  - 读取：回合生成时 `buildLinkedChatContext` 扫描剧本绑定的私聊/群聊中「跑团联动」开启的会话，读最近消息注入 DM 上下文影响后文。
  - 推送：DM 回合 JSON 生成 `linked_messages`（NPC 发私聊），`deliverLinkedMessages` 按 NPC 名匹配角色卡 → `pushChatMessage` 真实推送到私聊/群聊会话（置未读，出现在聊天界面，可点进去回复）。
- **API 配置**：回合引擎需 `settings-storage` 有可用 API 配置（resolveBinding 的 scripthub slot 或 configs[0]），未配置时报错提示用户去设置添加。

## 七、开发环境备忘
- 项目根：`C:\Users\win\AppData\Local\Temp\opencode\repos\ai-virtual-phone`
- dev server：端口 3001（`scripts/local-next-server.mjs` 默认），日志 `C:\Users\win\AppData\Local\Temp\opencode\dev-server.log`。
- PowerShell 执行策略禁 npm.ps1，须用 `C:\Program Files\nodejs\npm.cmd`。
- 重启：`Get-CimInstance Win32_Process -Filter "Name='node.exe'"` 匹配 local-next-server 后 Stop-Process。
- 剧本源文件：`D:\ChromeDownload\idm文档\模拟器小手机\模拟器剧本们\`（18 个文件，已全部读完）。
- 手机壳类：`phone-shell-wrap / phone-case / phone-frame / phone-shell / phone-wallpaper / phone-app-pane`（styles/phone-shell.css）。
- 可复用组件：`components/chat/chat-page-header.tsx`（ChatPageHeader）、`components/chat/state-values-panel.tsx`（StateValuesPanel，带进度条，本轮已弃用改纯数字清单）、`components/chat/message-bubble.tsx`（MessageBubble）、`components/map/map-lobby.tsx`（MapLobby S 样式体系）。