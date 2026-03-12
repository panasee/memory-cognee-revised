# HUMAN Guide

这份文档面向人类用户，而不是 agent。

目标只有两个：

1. 让你在 OpenClaw 对话中更高效地发挥 `memory-cognee-revised` 的能力
2. 让你知道什么时候该用 `vestige`，什么时候该用 `cognee`，以及两者如何协作

---

## 1. 先记住三层职责

在这个仓库的设计里，记忆不是一个系统包办，而是三层协作：

- `lossless-claw`：当前会话上下文
- `cognee`：文件型、可审计、可追溯的长期记忆和资料库
- `vestige`：抽象化、可强化/衰减的认知型长期记忆

一句话判断：

- 你想找原文、原始笔记、论文、证据、长期资料文件：优先 `cognee`
- 你想让系统记住你的偏好、习惯、决策、提醒、稳定做法：优先 `vestige`
- 你既想要抽象记忆，又想保留证据：`vestige` + `cognee` 一起用

---

## 2. 用户如何在对话中最大化使用 Cognee

最重要的是：说清楚你要的是哪一种记忆操作。

### 2.1 查询现有记忆

如果你要查长期笔记、原始记录、资料，请直接说：

- “查一下我之前关于 X 的笔记”
- “打开原始记忆，不要摘要”
- “找一下那篇论文/那份参考资料”
- “在 `library` 里查 X”
- “把这条记忆打开给我看”

如果你知道你要的是资料库而不是普通记忆，最好明确说：

- “在 cognee `library` 里找”
- “这是参考资料，不是普通 memory”

### 2.2 新增 durable memory

如果你希望内容进入 `cognee memory`，最好直接说：

- “把这个存成长期笔记”
- “把这段整理成 durable note 存进 cognee memory”
- “把这个写到 memory，不要只留在当前会话”

适合放进 `cognee memory` 的内容：

- 你未来会回头查的原始过程记录
- 有审计价值的技术说明
- 纠错记录
- 需要保留来源关系的笔记

不太适合直接塞进 `cognee memory` 的内容：

- 只在当前会话里临时有用的话
- 纯提醒
- 抽象偏好，但没有必要保留原始文件证据

### 2.3 导入 `library`

如果是外部文档、论文、长参考资料，不要让 agent 当普通 `memory` 存。

最好直接说：

- “把这个导入 cognee library”
- “这是参考资料，走 library retained import”
- “请作为 library 资料导入，不要当普通 note”

适合 `library` 的内容：

- 论文
- 文档
- 手册
- 规范
- 外部网页摘录整理成 markdown

### 2.4 压缩原始笔记

如果你有日报、工作日志、scratch note，不要长期直接拿原始文件检索。

你可以说：

- “把这条日报 compact 成 durable memory”
- “压缩这条 worklog，但保留原文件”
- “把这个 daily-log 压缩后删除原始源文件”

当前设计下：

- `daily-log` 更适合压缩后删源
- `worklog` 更适合压缩但保留源
- `reference-note` 更适合转去 `library`，而不是普通 compact

### 2.5 删除、降权、强化

现在你已经可以显式要求：

- “删除这条托管记忆”
- “把这条记忆 deprioritize”
- “强化这条记忆”
- “确认这条记忆对我有用”

推荐语义：

- `deprioritize`：这条还可能有用，但现在不该排太前
- `reinforce`：这是我明确确认要长期更容易被想起的记忆
- `confirm-useful`：这次召回是有用的，但先只记确认，不自动强化逻辑闭环

---

## 3. 用户如何正确搭配 Vestige 和 Cognee

这是最重要的使用守则。

### 3.1 什么时候只用 Vestige

适合只进 `vestige`：

- 偏好
- 习惯
- 风格
- 长期决策
- 提醒
- “以后记得……”
- 复用型经验

你可以这样说：

- “记住我以后更喜欢……”
- “以后提醒我……”
- “这个做法下次优先考虑”

### 3.2 什么时候只用 Cognee

适合只进 `cognee`：

- 原始笔记
- 文件型长期记录
- 论文/文档/资料
- 可审计纠错记录
- 你以后会想打开原文的东西

你可以这样说：

- “把这个存成文件型长期记忆”
- “我以后要查原始内容，存到 cognee”
- “这是一份资料，不是偏好”

### 3.3 什么时候两者一起用

最推荐的双写场景不是“写同一份东西两遍”，而是：

- `vestige` 存抽象 takeaway
- `cognee` 存原始来源/原始笔记

例如：

- 论文结论
- 稳定工作决策
- 可复用修复方案
- 长期研究偏好，但你又想保留来源依据

正确做法：

- `vestige`：存“结论/偏好/可复用规律”
- `cognee`：存“来源 note / reference / correction trail”

错误做法：

- 把完全相同的大段内容同时塞进 `vestige` 和 `cognee memory`

---

## 4. 你在对话里最好怎么表达，agent 最容易做对

### 4.1 一开始就给任务类型

开场时尽量告诉 agent：

- 这是当前会话临时问题
- 这是长期偏好/长期决策
- 这是要保存的 durable note
- 这是 library 资料

比如：

- “这是长期偏好，请记到 vestige”
- “这是原始研究记录，请存到 cognee memory”
- “这是参考资料，请导入 cognee library”

### 4.2 需要原文时明确说“原始”

如果你说“查一下”，agent 可能先给摘要。

如果你要原文，直接说：

- “给我原始 note”
- “打开原始记忆”
- “不要摘要，直接给我文件内容”

### 4.3 需要证据时明确说“证据/来源”

如果你要的不只是抽象结论，请明确说：

- “给我对应来源”
- “给我原始文档/原始笔记”
- “这个结论对应哪条 cognee note / 哪篇 library 文档”

### 4.4 纠错时要同时说“旧的错了，新的是什么”

最好这样说：

- “之前关于 X 的记忆不对，正确的是 Y，请做 correction”
- “把旧记忆降权，并写一条 correction note”

这样 agent 更容易同时处理：

- `vestige` 的抽象纠错
- `cognee` 的文件型纠错

---

## 5. 推荐的人类操作习惯

### 5.1 每类信息只问一个明确目标

不要混着说：

- “帮我记住这个，同时查一下那篇论文，再提醒我明天做……”

更好的做法是拆成三句：

1. “把这个存到 cognee memory”
2. “在 library 里找那篇论文”
3. “把这件事记成提醒”

### 5.2 定期把 raw note 转成 durable artifact

如果你经常写：

- 日报
- worklog
- scratch note
- 会议流水记要

建议周期性让 agent 做：

- `compact-memory`
- reference note -> `import-library`

否则长期检索会越来越偏向噪声。

### 5.3 对高价值记忆做显式确认

现在还没有完整的“3 轮内再次提及自动强化”闭环。

所以你如果真的觉得某条记忆重要，最好直接说：

- “强化这条记忆”
- “确认这条记忆对我有用”

不要指望系统短期内完全自动判断。

### 5.4 手动改 memory 文件后，提醒 agent 重新 cognify

如果你直接编辑了已有的 `memory/*.md` 文件，最好告诉 agent：

- “这个 memory 文件我手改过了，请重新 cognify memory dataset”

原因是：

- 新增条目会自动 dispatch `cognify`
- 但编辑已有 memory 文件不会自动 dispatch

---

## 6. 高价值的对话模板

### 存 durable memory

“把下面这段存成 cognee memory 的长期笔记，保留可追溯性，不要只留在当前会话。”

### 导入 library

“把这个 markdown 文档导入 cognee library，作为 retained reference 保存。”

### 压缩日报

“把这条 daily-log compact 成 durable memory，并删除原始源文件。”

### 保留 worklog

“把这条 worklog compact 成 durable memory，但保留原文件。”

### 纠错

“之前关于 X 的记忆是错的，正确版本是 Y。请把旧记忆降权，并写入 correction note。”

### 强化

“这条记忆以后应该更容易被想起，请强化它。”

### 确认有用

“刚才召回的这条记忆确实有用，请记录为 confirmed useful。”

### 查原始来源

“不要给我摘要，直接打开对应的 cognee 原始 note / library 原文。”

---

## 7. 当前系统的已知边界

你最好知道这些限制：

- `cognee` 不是 prompt context engine
- `autoRecall` 在这个插件里只是 metadata，不会自动把内容塞进上下文
- `memory_confirm_useful` 目前只记录信号，不会自动形成强化闭环
- 完整的“recall + adopted + 3 轮内再次提及 -> 自动强化”还没实现
- 低信号过滤当前只做了很保守的版本：greeting 和过短文本
- duplicate suppression 目前是保守规则，不是向量级 MMR

---

## 8. 最简使用原则

如果你只想记住最核心的做法，记这 6 条：

1. 要原文、资料、证据，用 `cognee`
2. 要偏好、习惯、提醒、抽象规律，用 `vestige`
3. 要同时保留结论和证据，就 `vestige + cognee`
4. 日报/worklog 不要长期裸存，尽量 compact
5. 参考资料不要塞进普通 memory，尽量进 `library`
6. 真正重要的记忆，显式说“强化”或“确认有用”
