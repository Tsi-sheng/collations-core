# collations-core

## 定位与状态

Collations（秩笺）核心逻辑库。**活跃开发，保留现有名称。**

核实日期：2026-11-06。以下能力对应 [`4866927`](https://github.com/Tsi-sheng/collations-core/tree/4866927187e5bcaca4c76238ac12e41a37a922f9)（`feat/knowledge-workspace-v0.3`）；[链接解析 PR #5](https://github.com/Tsi-sheng/collations-core/pull/5) 尚待审查。版本号 0.3.0 不代表桌面 v0.3 已完整交付，main 也尚未包含全部开发分支成果。

## 职责边界

核心包通过注入接口读取工作区、提交身份清单与产生索引记录。文件系统、监听、锁、原子替换和 SQLite 由平台适配器负责。

Document ID 标识文档；Block ID 与 Document ID 联合定位块；SHA-256 标识原始字节；Revision ID 属于未来显式版本提交。扫描不创建 Revision。身份持久保存在 Manifest，不能只保存在 SQLite；删除派生索引后应从 Manifest 和源文件恢复，丢失全部身份元数据则无法仅凭正文恢复旧 UUID。

扫描保留原始 Markdown 字节，包括 BOM、换行与未知元数据；相同内容不合并不同文档身份。知识库编辑、索引及未来出版能力以离线可用为原则。

## 现有能力

- 工作区扫描、SHA-256、文档记录、Manifest v1/v2 兼容升级至 v3。
- 重复扫描、文件身份匹配、歧义诊断；持久化绑定、新身份、暂缓和补偿撤销。
- CommonMark 索引解析；用于预览的 GFM 与数学语法树入口。
- 标准链接、引用式链接、标题、显式锚点及常见 WikiLink 的基础提取与解析，包含缺失、锚点缺失和同名歧义状态。
- 数学样例、作品清单和协议测试。

完整汇编器、不可变内容版本仓库、桌面反链 UI、路径修复确认与完整迁移工具尚未交付。不要把协议样例当作这些功能的实现。

## 开发与验证

在本仓库根目录使用 Node.js 22.20 或经验证的兼容 Node 22 版本：

```sh
npm ci
npm run check
npm test
node --test tests/protocol.test.mjs
```

`npm test` 使用 Node 内置测试运行器及 TypeScript 类型剥离；部分集成测试需要该 Node 版本的 SQLite 能力。数学样例位于 [examples/analysis](examples/analysis)，协议测试位于 [tests/protocol.test.mjs](tests/protocol.test.mjs)。

验证记录：2026-11-06，提交 `4866927` 类型检查及测试 12/12 通过，见 [PR #5](https://github.com/Tsi-sheng/collations-core/pull/5)。这是该提交的记录，新提交须重新验证。

## 云端工作方式

工作流为：Codex 云端准备依赖与修改代码 → 功能分支与 PR → CI 验证 → 人工审查。开发环境的联网安装不改变应用离线工作的要求。不得直接修改 main、自动合并 PR、强制推送或将凭据写入仓库。

云端优先同时纳入 core、desktop、docs，并明确每仓起始分支。desktop 当前固定依赖 [core `026644d`](https://github.com/Tsi-sheng/collations-core/tree/026644d0d398b722020ede2186973d4b9cf8d30e)，尚未接入本分支的全部链接能力。联调可使用临时组合；交付时必须固定已上传的 core SHA、更新 desktop 锁文件并验证干净安装，不能依赖个人目录。

## 关联文档和后续工作

- [架构与平台边界](https://github.com/Tsi-sheng/collations-docs/blob/ab913b063437d9ba31ba19f9029167ecbd16626d/docs/ARCHITECTURE.md)
- [数据、链接、版本与汇编协议](https://github.com/Tsi-sheng/collations-docs/blob/ab913b063437d9ba31ba19f9029167ecbd16626d/docs/PROTOCOL.md)
- [Manifest v3 协调与恢复](https://github.com/Tsi-sheng/collations-docs/blob/ab913b063437d9ba31ba19f9029167ecbd16626d/docs/adr/0004-file-reconciliation.md)
- [路线图](https://github.com/Tsi-sheng/collations-docs/blob/ab913b063437d9ba31ba19f9029167ecbd16626d/docs/ROADMAP.md)

下一步验证链接边界用例、接入 desktop 的可重建关系索引与导航；历史版本及内容汇编按后续里程碑实施。
