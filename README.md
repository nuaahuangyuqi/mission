# 任务规划系统（学习交流版）

> 说明：本项目仅用于前端、三维可视化、数据服务架构与交互设计的学习交流。
> 文中的红蓝对抗数据、单位名称、地理态势与推演场景均为虚构演示内容，不对应任何真实组织、装备、行动或地点。

## 项目概览

这是一个基于 `Vue 3 + Cesium + Express + SQLite` 的态势沙盘示范系统，当前已经形成以下主线：

- 总任务中心驱动的统一业务入口
- 信息资源接入与预览
- 六类核心能力指标评估与多算法融合
- 智能任务规划与任务流执行
- 情报 / 环境 / 态势要素管理
- 二维地图 / 三维地球联动展示
- 探测圈、命令线、区域标绘与导出
- 基础登录鉴权与角色区分

## 技术栈

- 前端：`Vue 3`、`Vite`、`Cesium`、`ECharts`
- 后端：`Node.js`、`Express`
- 数据：`SQLite`
- 运行方式：本地开发 / 本地离线部署

## 当前功能

### 0. 总任务中心与顶层入口

- 首页当前已调整为“任务中心优先”的工作台入口：
  - 顶部保留品牌、账号和核心数据摘要
  - 首页不再保留单独的 hero 说明框；主入口统一下沉到后续的 `任务与业务入口` 区域
  - `总任务中心` 仍作为首要入口展示
  - 其他业务模块作为并列工作区入口展示
- 前端现已正式接入总任务中心路由：
  - 任务列表：`/tasks`
  - 任务详情：`/tasks/:id`
- 任务中心支持：
  - 创建任务
  - 按模块 / 状态 / 关键字筛选任务
  - 在任务详情中维护共同任务上下文
  - 从任务详情直接跳转到规划执行、能力评估、行动计算、消耗计算
  - 从任务详情跳转进入业务页时，前端现在会优先消费当前任务的 `taskId`：规划页会选中对应任务实例，能力/行动/消耗页会同步同一条任务上下文，不再误用上一次本地残留任务编号
- 本轮已同步修复首页、登录页、品牌区、任务中心页及部分模块壳层的可见乱码，顶层入口页文案已恢复为正常中文

### 1. 数据信息服务

- 数据服务首页已进入第二阶段标杆页改造：
  - 原“数据服务工作台”总控摘要区已删除，避免重复显示无实际决策价值的信息
  - `多源数据接入` 与 `数据源与批量归档` 现已合并为同一张接入归档总卡，接入动作、待执行队列、已载入数据源和批量执行记录都在同一区域完成
  - 下方工作区现保持为 `空间主舞台 + 证据与编辑侧舱` 两段主结构，避免把高度相关的接入与归档信息拆成两块重复卡片
  - 三维预览区新增舞台焦点与图层开关，当前选中源和环境/红蓝/探测圈可见状态可以在主舞台直接确认
  - 右侧证据舱现在会持续显示当前源和当前主视图摘要，源预览、记录编辑、知识图谱三类工作不再是同权重并列关系
- 多源数据接入：支持数据库、API、遥感影像、Word、Excel、文本等演示数据源
- 数据源预览与删除：支持表格、JSON、影像、Word 文档、Excel 工作簿预览，可删除未被引用的数据源
- 批量导入任务视角：支持将多条导入项加入批量队列并一次执行，逐条记录状态、失败原因、重试次数与重试入口
- 导入结果任务关联：导入数据源、抽取条目和批量记录均可关联任务实例，便于后续按任务追溯输入来源
- 情报记录管理：新增、编辑、删除、筛选
- 环境记录管理：支持地形、气象、电磁等环境信息
- 知识图谱展示：基于情报、环境、数据源及文档关键内容抽取结果构建关系图

### 1.1 数据导入稳定性整改（T13）

导入链路已从“单次演示交互”升级为“可追踪批量导入”：

- 服务端新增 `import_batches / import_batch_items`，记录批次状态、成功数、失败数、失败原因、尝试次数和结果摘要
- 支持 `Word / PDF / Excel / CSV / 文本` 导入解析失败原因透明返回（含文件格式/解析失败上下文）
- `Word / PDF / Excel / CSV / TXT` 预览链路中的运行时提示、表格摘要、抽取草稿标题与格式校验错误已清理为可读中文，并补充了 `import-preview` 回归测试覆盖 CSV、仅表头 CSV、Word/TXT 文本预览和非法扩展提示
- 批量导入支持单条重试，并保留历史失败原因用于排障
- 导入数据源可关联任务实例，后续规划输入可按任务维度追溯来源

### 2. 专题态势子模块

- 二维地图 / 三维地球切换
- 离线底图 / 在线底图切换
- 数据信息服务中的地图配置为全局配置：视图模式、底图选择、地形模式、地形夸张和天地图 token 会应用到其他地图面板
- 平面 / 离线 DEM / 在线 DEM 切换
- 默认优先使用 `apps/web/public/dem` 中的离线底图；当未检测到本地离线底图时，前端会自动尝试使用已配置的天地图 token；天地图也不可用时再回退到内置网格演示底图，避免三维球只显示黑色背景
- 离线 DEM 模式下默认关闭 Cesium 时间光照，优先保证数据服务和专题态势工作台的可读性
- 左键重叠目标辅助选择
- 左键拖拽单位、命令线端点、区域顶点
- 右键元素编辑 / 删除 / 定位 / 快速创建
- 元素面板拖放到地图直接生成态势要素
- 红方 / 蓝方单位分层显示
- 多类型单位军标与命令线样式
- 探测圈三维体积显示与二维投影显示
- 探测圈支持四类传感器区分：
  - 雷达探测圈
  - 红外探测圈
  - 光电探测圈
  - 声学探测圈
- 探测圈支持不同包络线风格与更明显的内部填充效果
- 区域标绘支持矩形与多边形
- 三维地图支持多段距离测量与多边形面积测量
- 导出 `PNG / PDF / KML`

### 3. 能力计算子模块

- 建立六类核心能力评估指标体系：
  - 侦察情报
  - 指挥控制
  - 火力打击
  - 机动投送
  - 综合防护
  - 综合保障
- 每类核心能力下设不少于 3 个二级指标，每个二级指标下设不少于 3 个三级指标，形成完整指标树
- 支持指标权重设置和三级指标分值输入
- 支持 `AHP`、`模糊综合评价`、`TOPSIS` 三类多指标融合算法
- 支持多方案并行评估与排序
- 提供雷达图、柱状图、折线图等结果可视化
- 能力、行动、消耗三个子模块现在共用同一项“共同任务”：
  - 共同任务统一包含 `作战任务类型 / 我方装备输入 / 敌方装备输入 / 任务目标 / 任务说明`
  - 三个子模块现已回收到统一的“能力计算模块”框架里：顶部使用同一套指挥甲板与模块切换器，中部共享一块真正的 `全局作战上下文` 组件，下方再进入各自的步骤工作区
  - `全局作战上下文` 组件会持续展示 `任务目标 / 任务说明 / 作战类型 / 敌我装备规模 / 敌情火力强度 / 服务端任务绑定状态`，不再只是一个可有可无的折叠表单
  - 全局上下文默认可以折叠为摘要模式；展开后可直接编辑任务名称、目标、说明和敌我装备输入
  - 全局上下文的展开/折叠状态会保存在当前浏览器，且按登录账号隔离；本次收起后切换到能力、行动、消耗子模块时会继续保持
  - 全局上下文现已支持把当前参数保存到服务端任务库，并从服务端读取已有任务；原“恢复默认共同任务”按钮已替换为 `保存任务 / 读取任务`
  - 服务端读取列表默认只显示当前登录账号保存的能力/行动/消耗任务，可在三个计算子模块之间复用同一组任务参数
  - 如果当前上下文是从任务中心带入的 `planning` 任务，计算模块会把它当作只读上下文同步源；在能力/行动/消耗页点击 `保存任务` 时，会新建一条计算模块任务，而不是回写覆盖原规划任务
  - 三个子模块的顶层抬头现在统一为 `当前阶段 / 当前任务 / 作战类型` 这组关键信息，不再各自复制一套任务背景说明
- `行动计算子模块` 现在改成“共同任务驱动”：
  - 不再手动选择行动任务模板
  - 系统会根据共同任务里的 `作战任务类型` 自动生成固定作战功能链
  - 后续方案建模和结果预测都围绕这条固定功能链的节点展开，不再单独设置“校验节点逻辑关系”步骤
  - 行动计算相关前后端源码已统一为 `UTF-8 with BOM`，历史乱码在 Windows 编辑器 / 终端链路中不应再成片出现
- `消耗计算子模块` 现在会先从共同任务同步方案基线：
  - 我方装备输入会折算为方案投入规模
  - 敌方装备输入会映射为敌情火力强度
  - 作战任务类型会同步默认打击方式
  - 在共同任务基线生成后，才继续进入装备自然损耗和任务战损建模
- 能力评估流程现在压缩成 `指标库管理 / 构建指标树并录入 / 生成评估结果` 三步：
  - `指标库管理`：可增删改查一级、二级、三级指标，并显式维护 `一级 -> 二级 -> 三级` 父子关系
  - `构建指标树并录入`：直接从指标库构建当前任务树，并在树节点中录入权重和三级指标值
  - `生成评估结果`：在树结构和录入完成后选择算法生成排序、分项得分和图表结果
- 模块外层流程壳现在改成更轻的 `流程轨道 + 主编辑区` 结构：
  - 左侧只保留流程说明和步骤推进，不再显示“可录入状态”和“当前任务结构”这类重复摘要
  - 当前步骤 / 当前任务 / 评估对象数量只在模块顶部保留一处，步骤页内部不再重复铺设同类上下文卡片
- 第三阶段进一步把三个父级页面统一为同一套壳层：
  - `能力评估 / 行动计算 / 消耗计算` 三个入口都共用统一的模块英雄区、步骤轨道、主舞台容器和账户区
  - 模块差异现在主要只体现在步骤定义、状态提示和侧栏统计上，避免三套近似布局分别维护造成信息架构漂移
- 各步骤页顶部现在只保留简短标题和状态信息，不再展示解释布局思路的提示性导语
- 三个步骤的标题卡和树编辑主面板现在统一使用固定主题色，不再随步骤切换成不同色调
- `指标库管理` 页面现在作为独立步骤存在：
  - 左侧维护指标定义，支持在一级指标下新增对应二级指标、在二级指标下新增对应三级指标
  - 三级指标定义可直接维护名称、单位和说明
  - 任务页和树页后续只复用这里的指标定义，不再把指标定义维护混在任务编辑里
- `构建指标树并录入` 页面现在改成了合并式工作区：`左侧树形画布 + 右侧指标库列表 + 右侧工具台`
  - 左侧主区域是带网格背景的指标树画布；初始状态是空画布，需要用户从右侧指标库中选取一级 / 二级 / 三级指标逐步构建，不会一开始就预铺整棵树
  - 当树中已有节点后，一级、二级、三级指标之间会用更明显的分层级彩色连接线串起来，主干线和横向连线都带有更清晰的高亮与发光层次，整棵树不再是纵向卡片堆叠
  - 连线的竖向主干现在会对齐到各插槽中心，去掉了之前视觉上突出的“线头”
  - 画布现在会在首次进入、切换任务或树结构变化后自动按视口适配整棵树，同时保留 `滚轮缩放`、右上角 `Zoom +/-`、`适配`、`100%` 和空白区拖动画布平移，不再只能依赖浏览器滚动条查看整棵树
  - 树布局间距、节点宽度和连接线偏移已再次压缩调整，在常见桌面分辨率下更容易同时看到整棵树，并保持节点正文可读
  - 树节点正文现在围绕 `指标名 / 权重值 / 指标值` 组织；一级、二级节点会基于当前评估对象的三级分值按子节点权重递归汇总显示
  - 权重值现在直接在一级、二级、三级节点卡片里录入，输入范围只允许 `0-1`；权重编辑框已加宽并改为单列指标区，小数位可完整显示；输入时会先保留当前草稿，在失焦、回车或控件确认后提交；如果新输入值会让同层权重和超过 `1`，系统只会限制当前输入，使该层权重和保持 `<= 1`，不会自动补齐其他节点权重
  - 当指标树建立完成后，系统会检查每个分支下的权重和是否为 `1`；若未满足，只提示待修正分支，不会自动替用户赋值为 `1`
  - 三级指标值现在直接在三级节点卡片里录入，输入范围只允许 `0-100`；输入时同样先保留当前编辑值，失焦、回车或控件确认后立即写回当前评估对象；如果输入为空、非数字或超出范围，会自动回填为 `80`
  - 右侧指标库改为“平铺列表 + 选中添加”交互：一级、二级、三级指标统一按列表展示，先选中条目，再点击“添加选中指标”加入画布
  - 右侧工具台整合了 `任务 / 对象 / 版本 / 模板 / 导入导出`，不再单独保留“构建指标体系”和“设置权重与指标值”页面
  - 页头不再重复显示“当前任务 / 当前对象”摘要，对象切换只保留在录入相关的功能区里
  - 该页面历史残留的乱码文案已清理，画布标题、任务/对象/版本/模板标签、导入导出说明和按钮文案均为正常中文
  - `capabilityWorkflow.js` 中历史残留的任务名、模板名、确认框、导入导出提示、评估报错和评估对象默认名乱码也已清理，当前能力模块主链路不应再出现 `????` 或错码中文
- `构建指标树并录入` 页当前支持直接在画布中调整层级结构：
  - 已进入树中的一级、二级、三级指标都可以继续拖动调整同层级顺序
  - 二级指标只能在所属一级指标下调整顺序，三级指标只能在所属二级指标下调整顺序，不再允许跨父级重挂破坏指标库关系
  - 每个指标方块都提供 `上移 / 下移 / 拖动 / 删除` 操作，不再受“必须保留同级兄弟节点”的限制
- `生成评估结果` 页面现在进一步强化 `结果阅读主列 + 控制台侧栏`：
  - `算法与生成控制` 现在调整为横向工具条，放在 `融合结果` 模块正上方，算法勾选、结果生成和导出动作都在同一行工作区完成
  - 三种算法的复选卡现在会在控制区中占用独立一行并自适应换列，生成/导出按钮不再和它们争抢同一横排宽度，避免遮挡后续内容
  - 对象切换单独保留为侧栏次级区
  - 主列优先展示得分摘要、排序表和图表
  - 控制台不再重复铺设“当前任务 / 当前对象 / 当前算法 / 当前得分”四宫格，减少结果页噪声
- 新增三级指标、树导入和录入页展示不再把单位默认强制回填为 `分`；系统内置模板会恢复 `% / 秒 / 分钟 / 米 / 次 / 分` 等更合理的常用单位
- 当前浏览器里已经保存的系统模板任务在重新加载时，会自动把历史上被错误写成统一 `分` 的三级指标单位迁移回模板单位
- 当前算法引擎由 Node 服务内置实现，并预留按 `algorithms` 工程登记的外部算法服务接入扩展位

### 4. 智能任务规划子模块

- 顶层结构分为两个并列子模块：
  - `规划算法库`
  - `作战任务库`
- 规划执行页现已按算法结果拆分为 `执行总览 + 单算法结果页`：
  - `/planning/tasks/execute` 只保留“规划执行工作台”、执行记录、输出包和分算法结果入口，不再在同一页展开所有算法明细
  - `/planning/tasks/execute/step/:stepId` 用于回看单个算法的执行结果，只展示该步骤自己的指标、预览、产物、证据、三维标注和结构化表格
  - 单算法结果页支持 `上一算法 / 下一算法 / 执行总览` 切换，便于按任务流程逐项审查
  - `任务执行` 阶段入口卡片继续展示任务模板、任务实例、执行状态、结果时间和完成步骤摘要
- `规划算法库` 默认先展示精简算法列表；点击某个算法后，会切换进入该算法的完整卡片视图，不再与其他算法列表同时展示
- `作战任务库` 内部按 `任务模板 -> 流程编排 -> 任务执行` 的顺序组织和推进
- `作战任务库` 的 `任务模板 / 流程编排 / 任务执行` 页面头部统一使用 `上一步 / 下一步` 按钮提示阶段推进，首尾阶段会自动禁用不可用方向
- 当前提供 `6` 个内置规划算法：
  - `敌情威胁自动分析`
  - `作战力量智能编组`
  - `作战目标自动分配`
  - `机降地域优化选择`
  - `作战方法自动规划`
  - `作战保障自动规划`
- 上述 `6` 个算法当前均已有内置实现；其中 3 个算法额外登记了本地 Python 扩展实现，用户可在“流程编排 / 算法实现”下拉中切换；`作战目标自动分配` 另在内置方法列表中接入本地 Python `intelligent-allocation / 智能分配算法`，默认方法仍保持 `multi-objective`：
  - `敌情威胁自动分析`：`基于大模型分析算法`，来自 `algorithms/enemy-threat-analysis`
  - `作战力量智能编组`：`智能编组算法`，来自 `algorithms/force-grouping`
  - `机降地域优化选择`：`机降地域优化选择 Python 算法`，来自 `algorithms/airlanding_zone`
- 旧任务中如果仍保存了已移除的外部规划绑定，前后端会在找不到对应变体时自动回退到该算法的内置实现，避免历史任务无法打开或执行
- 当前内置 `2` 个任务模板：
  - `火力打击任务`
  - `机降突击任务`
- 规划运行时现在支持两类扩展执行：
  - HTTP 外部算法网关仍按 `algorithm-gateway-v1` 契约保留
  - 本地 Python runner 会在系统临时目录按 `runId / stepId` 隔离输入，把已勾选资源库数据、上传文件和上游结果落盘后调用 `algorithms/run-with-venv.mjs`；该启动器会在 `algorithms/.venv` 自动创建/复用 venv、同步 `requirements.txt` 依赖，并用该虚拟环境运行算法。可通过 `PLANNING_PYTHON_BIN` 或 `PLANNING_PYTHON_BOOTSTRAP_BIN` 指定创建 venv 时使用的基础 Python；只有显式设置 `PLANNING_PYTHON_USE_VENV=0` 时才会绕过自动 venv。
- 本地 Python 算法运行参数在算法配置页和流程编排页可见；LLM 配置遵循页面参数优先、环境变量兜底，并提供独立的 `大模型接口` 选择控件：
  - `外部 OpenAI 兼容 API`：需要填写 API Key、Base URL 和模型名称，服务端按 `/chat/completions` 契约发起测试和真实算法调用，结果归档会将 key 脱敏为 `configured`
  - `本地 Ollama（自动连接）`：前端只要求填写模型名称，不再显示 API Key、Base URL 或 Ollama 地址输入；后端默认连接 `http://localhost:11434`，也可用 `OLLAMA_HOST` 或算法环境变量覆盖；Ollama 与外部 OpenAI 兼容 API 共用同一套算法提示词，Python 算法的 Ollama 分支使用官方 `ollama` 包直接调用本地模型，不走 OpenAI SDK，并显式禁用环境代理读取以避免 localhost 请求被代理干扰；Ollama 请求会携带 `think:false` 关闭可关闭的 thinking 模式，并默认使用 `num_ctx=262144` 适配 256k 上下文模型；如本机模型显存/内存不足或模型支持不同上下文，可用 `OLLAMA_NUM_CTX` 或 `LLM_OLLAMA_NUM_CTX` 调整
- 算法配置页和流程编排页的 LLM 面板现在提供 `测试连接` 控件，调用 `POST /api/planning/llm/test` 发送一次最小化 chat 请求，成功时返回延迟、响应长度和预览；若页面提示测试接口未加载，需要重启后端服务使新路由生效
- `敌情威胁自动分析` 支持从资源库显式勾选数据源，也支持上传本地 `Word / PDF / Excel / CSV / TXT` 文件进行分析；未勾选资源库数据源时不会默认使用全部已有资源，若同时没有上传文件，执行前会提示补充输入
- `敌情威胁自动分析` 当前使用内置规则融合实现，会结合已勾选资源库的预览、抽取条目、敌方情报、环境要素和本地上传文件，提取敌方作战企图、部署态势、火力覆盖、防空体系、侦察预警和反机降设施等结构化节点
- `敌情威胁自动分析` 的大模型抽取结果会在 schema 校验前做安全归一化：例如模型把 `spatialContext.terrain / weather` 返回成字符串，或把 `equipment[].quantity` 返回成 `estimated / multiple / various` 等文本时，会自动转换为平台可校验的结构化字段；同时覆盖范围不再对所有目标兜底生成，指挥、机动、后勤、普通工事等点目标默认 `hasCoverage=false / radiusMeters=0`
- `敌情威胁自动分析` 单算法结果页仍保留通用三维威胁场展示能力：当内置算法或未来新算法在结构化结果中提供 `heatmapBase64 / heatmapGeojson / bounds / targetEntities / pointThreatEvaluation` 等字段时，三维球会叠加热力图、目标卡片、覆盖圈、部署区和采样统计；其中热力图不做前端实时网格渲染，而是读取 Python 算法生成的透明 PNG 和 `visualization.imageOverlays` / `heatmap.bounds` 地理边界，以 Cesium 单幅影像层贴地加载到底图之上、单位实体之下，并受结果页“威胁场”开关联动；Python 热力图会按当前威胁场峰值做可视化归一化，再通过重采样、高斯柔化和软透明度衰减生成连续贴图，避免因全局分值偏低而出现“已加载但肉眼不可见”、放大后被地形遮挡、缩小时中间被硬阈值挖空或低分辨率网格块割裂；历史结果若仍携带旧版或无 `displayVersion` 的 `heatmapBase64`，前端会基于已有 `heatmap.grid` 一次性生成增强静态贴图作为兼容兜底；若 Python 结果未单独提供 `targetEntities`，结果页会从 `targetAssessments`、`fireCoverage`、`airDefenseSystem`、`reconEarlyWarning` 和 `antiAirborneFacilities` 中提取坐标生成可定位目标，并按单位类型选择可视化形式：火力、防空、侦察/雷达、电子对抗默认可生成覆盖圈，指挥、机动、后勤、普通工事默认只生成点/符号，显式 `visualizationType / coverageTypes / hasCoverage` 可覆盖默认规则；页面不再依赖任何已移除的外部算法工程
- `作战力量智能编组` 会结合已勾选资源库对应的我方兵力、资源库文档、本地上传文件和敌情威胁结果，生成动态规则画像、群组蓝图和多方案编组结果
- `作战力量智能编组` 现在会让 `expectedGroupCount` 真正参与求解，并输出实际群组数、规则权重、证据条目、遗传优化迭代信息和推荐解释
- `作战力量智能编组` 单算法结果页现在会展示算法输出的全部候选方案，并以 `preferredSchemeId` 标记的最优解置顶和默认选中；点击不同方案卡片后，页面会切换对应评分、能力指标、约束状态、群组与单位构成
- 每套编组方案会逐组显示“第 i 个编组由 XXX 单位构成”，并展开单位名称、类别、角色、兵力、战备状态、能力摘要和坐标等可用信息；历史归档若方案只有 `methodLabel`、没有 `name`，结果页也会使用可读方案名称回显
- 规划执行结果现已提供证据溯源入口：关键结果可回看来源名称、来源类型、文件名、抽取时间和摘要
- `作战力量智能编组` 对本地 `CSV/Excel` 兵力文件支持按行拆解文档候选单元，即使没有结构化我方兵力，也能直接生成基础编组方案
- `作战力量智能编组` 已预留 `约束模型` 扩展接口，当前内置默认模型为 `基础编组约束`，会输出约束得分、约束满足状态和分方案约束评估结果
- `作战目标自动分配` 现已基于敌情威胁结果和编组结果构建平台级分配模型，不再只把编组整体当作单个平台使用
- `作战目标自动分配` 当前内置 `匈牙利算法分配 / 蚁群协同分配 / 多目标优化分配 / 智能分配算法` 四种方法，支持多平台、多目标、多波次打击包分配，并输出方案对比
- `作战目标自动分配` 的 `智能分配算法` 来自 `algorithms/target-allocation` Python 包；后端会把上游 `enemy-threat-analysis` 与 `force-grouping` 结构化结果写入临时 JSON，再调用 `python -m target_allocation.cli --upstream-threat ... --upstream-grouping ... --objective-preference ... --validation-mode ... --max-assignments-per-group ... --output ...`，输出仍保持平台字段 `candidateTargets / platforms / groups / comparedPlans / preferredPlan / systemBestPlan / validationFindings / adjustmentSuggestions`
- 当选择 `智能分配算法` 时，`comparedPlans` 会同时展示原三种 Node 内置方案和 Python 智能方案；`preferredPlanMethodKey` 指向 `intelligent-allocation`，`systemBestPlan` 仍按评分从全部方案中自动选择
- `作战目标自动分配` 会结合目标重要性、打击难度、平台能力、射程利用率、编组负荷和验证模式输出合理性校核、目标覆盖摘要和调整建议
- `作战目标自动分配` 单算法结果页现在会额外展示“作战目标分配态势”面板，复用三维球渲染蓝方编组、红方目标、部署区上下文和分配箭头，并同步展示分配清单和方案指标
- `作战方法自动规划` 支持 `A*`、`Dijkstra`、`RRT` 三类路径规划算法，当前会优先读取 `作战目标自动分配` 的实际群组-目标-波次结果生成路线任务，再在气象、地形、电磁和敌方火力约束下执行真实路径求解，而不是固定模板航点拼接
- `作战方法自动规划` 的输出现在包含每条路线的波次、平台上下文、检查点、时间窗、场代价和三维球约束叠加层；若上游目标分配样本未形成有效分配，则会回退到目标锚点生成基础路线任务，保证流程仍可联调
- `作战保障自动规划` 现在要求显式配置结构化战损预测输入：
  - 装备损失率
  - 人员伤亡率
  - 受损装备数
  - 伤员数
  - 关键窗口数
- `作战保障自动规划` 现在要求显式配置保障资源池：
  - 弹药 / 油料 / 维修 / 医疗 / 空域 / 通信库存
  - 运输架次 / 单架次载重 / 维修分队 / 医疗分队 / 空域协同席位 / 调度链路容量
- `作战保障自动规划` 会在库存、运输投送能力和保障节点容量三类约束下执行真实资源调度，不再按“需求乘固定系数”直接回填供给；结果页会显示资源池状态、瓶颈、分配说明和匹配分析
- `作战保障自动规划` 会在缺少有效作战编组结果、作战方法结果，或机降任务缺少机降地域结果时直接报错，避免继续输出缺少上游支撑的默认保障方案
- `机降地域优化选择` 会基于地形、威胁分布、目标锚点和直升机模型对候选机降点进行评分、排序、标注与流程联动分析
- `机降地域优化选择 Python 算法` 会默认读取 `apps/web/public/terrain` 的离线 Cesium terrain；若上游敌情 / 目标分配坐标不足，会生成演示目标边界兜底以保证流程可联调
- 规划执行接口在保留 `POST /api/planning/evaluate` 的基础上，新增 `POST /api/planning/evaluate/stream`，以 `text/event-stream` 返回 `run-start / validation / step-start / progress / terminal / llm-chunk / step-complete / final / error / done` 事件
- 规划执行页已增加执行监控面板：总进度条、当前步骤、步骤状态列表、终端日志区域和大模型片段区域会随流式接口实时更新；失败时保留已收到的终端日志和错误事件
- 规划执行工作台现在提供 `终止任务` 控件；任务运行中可主动中断当前流式执行请求，前端会立即标记为已终止，后端会在 SSE 响应流关闭后尝试终止正在运行的本地 Python 子进程，并把已创建的执行记录归档为失败/终止状态；正常点击开始执行不会因为请求体读取完成而误触发终止
- 任务执行结果现在按 `服务端归档 + 3 类导出 + 本地快照` 组织输出：
  - 主归档：每次执行都会写入服务端 `task_runs + task_results`，同一任务支持多次执行并保留独立历史记录
  - 导出一：`HTML` 分析报告
  - 导出二：`GeoJSON` 空间成果包，可用于地图/三维态势二次展示
  - 导出三：`CSV` 多方案对比表，便于离线比选与汇报整理
  - 本地快照：可选将当前结构化结果另存为浏览器本地快照（按登录账号隔离）用于快速回看，也可直接导出为 `JSON` 文件
- `敌情威胁自动分析` 单算法结果页顶部现在提供 `导出分析文件` 控件：优先导出 Python 算法生成的 `DOCX` 研判报告；内置算法、关闭二次研判或历史结果没有 DOCX 时，自动回退为结构化 `JSON` 分析文件。
- 单算法结果页的“生成文件与阶段产物”会识别已有 `DOCX / PNG / GeoJSON` 文件，并为每个生成文件和每项阶段产物单独提供 `导出文件` 控件；各算法的完整结构化输出也可独立导出为 `JSON`，历史归档无需重新执行即可使用。
- 结果页仍会输出阶段产物、摘要、结构化规划结果和三维球可视化实体，并会额外展示目标分配态势、规划方法对比、推荐航路表、检查点表、阶段时序以及三维威胁 / 环境约束层
- 前端已增加规划模块懒加载路由的自动恢复：如果生产环境前端刚完成重建而浏览器仍持有旧页面，点击某个规划子页面时遇到过期 chunk，会自动整页刷新一次以恢复进入
- 作战任务库已切换为“模板实例化 + 服务端持久化编辑”：模板选择、流程步骤、算法绑定、输入配置都会绑定到任务实例并保存到服务端；再次进入同一任务实例时可恢复上述状态
- 规划任务中的本地上传文件现已从任务配置正文中拆分为服务端任务附件：
  - `GET /api/tasks` 只返回任务摘要，不再把 `planningTaskDefinition / planningBindings / planningAlgorithmInputs` 整包回传到任务列表
  - 进入具体任务详情或执行规划时，服务端会再把附件内容回填到对应算法输入，保持现有执行链路兼容
  - 旧任务里历史内嵌的上传文件会在服务端启动时自动迁移到附件表，避免任务主表继续携带大体积 `base64`
- 主链路已增加前置校验与统一错误结构：`/api/planning/validate`、`/api/planning/evaluate` 与 `/api/planning/evaluate/stream` 会返回或流式发送 `error.code / error.type / error.details`，并按“缺数据 / 缺上游 / 算法失败 / 权限不足”分类提示
- 规划算法配置页、任务执行结果页和相关错误提示中的历史乱码已修复，当前规划模块界面文案统一为正常中文
- 能力/行动/消耗/规划执行链路已统一接入扩展算法契约：前端统一按“内置算法 / 扩展算法实现”选择，后端统一记录算法来源、运行时、版本和执行状态；规划模块还支持本地 Python runner
- 已登录状态下访问不存在的 `/api/*` 路径，服务端现统一返回 JSON `404`，不再错误落入前端 `index.html`

### 4.1 规划约束模型扩展说明

当前 `作战力量智能编组` 的约束模型采用注册式扩展，后续新增模型时可按下面方式接入：

1. 在 `apps/server/src/planning-runtime.js` 的 `GROUPING_CONSTRAINT_MODELS` 中登记模型元数据，例如 `key`、`label`、`description`。
2. 在同文件中实现对应的约束评估函数，输入编组结果、群组蓝图、兵力池、威胁结果和规则画像，输出约束评分与命中明细。
3. 将该函数注册到 `GROUPING_CONSTRAINT_EVALUATORS`。
4. 规划模板会自动读取 `constraintModels` 列表，注册成功后前端算法配置页即可看到新的约束模型选项，无需额外改下拉逻辑。

当前内置模型：

- `baseline-constraints`：`基础编组约束`

### 4.2 外部算法网关标准化（T15）

当前能力、行动、消耗及规划执行链路已经统一复用 `apps/server/src/algorithm-gateway.js`，不再各模块各自维护一套外部调用逻辑。

- 统一契约版本：`algorithm-gateway-v1`
- 统一执行元数据：`source / runtime / version / contractVersion / timeoutMs / status`
- 统一超时与异常收口：网络错误、HTTP 错误、远端业务错误、超时错误统一映射到结构化错误
- 统一调用记录模型：服务端写入 `algorithm_call_logs`，记录模块、算法、运行时、版本、状态、错误码、请求摘要和响应摘要

统一外部请求结构（外部服务可按此契约解析）：

```json
{
  "contractVersion": "algorithm-gateway-v1",
  "module": "capability-calculation | action-calculation | consumption-calculation | intelligent-task-planning",
  "moduleKey": "same-as-module",
  "algorithm": {
    "key": "algorithm-id",
    "name": "算法名称",
    "source": "external",
    "runtime": "python | cpp",
    "version": "x.y.z",
    "engineKey": "算法工程 key，例如 future-threat-analyzer",
    "engineLabel": "算法工程名称"
  },
  "request": {
    "requestId": "alg-xxx",
    "sentAt": "ISO8601",
    "timeoutMs": 15000,
    "assessmentName": "任务名"
  },
  "payload": {
    "task": {},
    "step": {},
    "selectedImplementation": {
      "runtimeKey": "future-threat-analyzer",
      "projectName": "future-threat-analyzer",
      "projectPath": "algorithms/future-threat-analyzer"
    },
    "algorithmInput": {
      "options": {
        "runtimeOptions": {
          "future-threat-analyzer": {}
        }
      }
    },
    "context": {},
    "dataset": {}
  }
}
```

统一返回建议：

- 成功：`{ ok: true, result: {...}, meta: {...} }`，或直接返回旧版结果对象（网关会兼容）
- 失败：HTTP 非 2xx，或 `ok: false` 且携带 `error.code / error.type / error.message`

环境变量（按模块拆分）：

- 统一超时：`ALGORITHM_GATEWAY_TIMEOUT_MS`
- 能力模块：`CAPABILITY_PYTHON_URL / CAPABILITY_CPP_URL / CAPABILITY_PYTHON_VERSION / CAPABILITY_CPP_VERSION / CAPABILITY_BUILTIN_VERSION`
- 行动模块：`ACTION_PYTHON_URL / ACTION_CPP_URL / ACTION_PYTHON_VERSION / ACTION_CPP_VERSION / ACTION_BUILTIN_VERSION`
- 消耗模块：`CONSUMPTION_PYTHON_URL / CONSUMPTION_CPP_URL / CONSUMPTION_PYTHON_VERSION / CONSUMPTION_CPP_VERSION / CONSUMPTION_BUILTIN_VERSION`
- 规划模块：`PLANNING_BUILTIN_VERSION` 影响内置执行器版本；默认会通过 `algorithms/run-with-venv.mjs` 使用 `algorithms/.venv` 执行本地 Python 算法，`PLANNING_PYTHON_BIN` / `PLANNING_PYTHON_BOOTSTRAP_BIN` 可覆盖首次创建 venv 时的基础 Python；只有设置 `PLANNING_PYTHON_USE_VENV=0` 时，`PLANNING_PYTHON_BIN` 才会作为直接执行命令使用；当前已登记 `enemy-threat-analysis-local / force-grouping-local / airlanding-zone-local` 三个 active 本地 Python 变体，`target-allocation` 作为目标分配内置方法 `intelligent-allocation` 调用本地 Python 包，HTTP 外部工程仍可继续按 URL 与版本环境变量登记

说明：

- 内置引擎与 active 本地 Python 引擎可直接执行；HTTP 外部引擎在未配置 URL 时会返回结构化“未接入”错误，不会再出现无意义空报错。
- 本地 Python 算法不需要手动 `source algorithms/.venv/bin/activate`；第一次执行会自动创建 `algorithms/.venv` 并安装 `algorithms/requirements.txt`、`algorithms/enemy-threat-analysis/requirements.txt`、`algorithms/force-grouping/requirements.txt`、`algorithms/target-allocation/requirements.txt` 中的依赖。依赖文件变更后，下一次执行会自动重新同步；在 Python 3.9 环境下，敌情分析和兵力编组会安装 `eval_type_backport`，以兼容 Pydantic 对 `list[...] | None` 等新式类型注解的解析。
- `algorithm_call_logs` 当前用于服务端归档与排障；若要做可视化运维看板，可再补充查询接口。
- 规划模块当前真实发送的 `module/moduleKey` 为 `intelligent-task-planning`；若外部服务想兼容旧称呼，可同时兼容 `planning-calculation`
- 规划模块扩展实现按 `algorithms` 工程名注册；新建规划任务仍默认选择内置算法，用户可在流程编排中切换到本地 Python 变体
- 若后续新增工程，需要在 `apps/server/src/planning-runtime.js` 登记工程名、支持的规划算法、网关或本地执行参数、参数 schema 和默认参数；旧任务中保存的已删除外部绑定会因找不到变体而回退到内置算法
- 规划模块当前只会把用户显式勾选的资源库子集打包到 `payload.dataset`；未勾选任何数据源时，`selectedSources / selectedPreviews / selectedExtractions / selectedEnvironment / intelligence.red / intelligence.blue` 均为空，不会隐式使用全部已有资源。打包字段包含：
  - `selectedSources`
  - `selectedPreviews`
  - `selectedExtractions`
  - `selectedEnvironment`
  - `intelligence.red / intelligence.blue`

### 4.2.1 规划扩展算法状态

当前仓库已移除上一版规划 Python FastAPI 适配服务和 `tactical-visualizer2.0` 敌情威胁分析集成：

- `apps/planning-python` 已删除
- `dev:planning-python`、`dev:server:planning-python`、`dev:planning-python-stack` 相关 npm 脚本已删除
- 根目录 `start-planning-python*.bat` 启动脚本已删除
- 规划输出包不再生成 `敌情二次研判报告` DOCX

当前保留并新增的能力：

- 外部算法网关基础契约仍可复用，未来重新集成 HTTP 算法服务时可继续走 `algorithm-gateway-v1`
- `algorithms/enemy-threat-analysis`、`algorithms/force-grouping`、`algorithms/airlanding_zone` 已作为本地 Python 算法登记到规划模块，但不会覆盖各算法的内置默认实现；`algorithms/target-allocation` 已接入 `作战目标自动分配` 的内置方法列表，和原三种方法并列
- `enemy-threat-analysis` 与 `force-grouping` 的大模型调用已同时支持外部 OpenAI-compatible API 和本地 Ollama；两类接口共用同一套抽取/解释提示词；Ollama 模式由前端独立选择，后端自动使用 `http://localhost:11434/api/chat`（或 `OLLAMA_HOST`）调用，不需要页面录入 API Key 或 URL；Python 正式算法调用使用官方 `ollama` 包的 `Client(host=..., trust_env=False)`，避免 `httpx` 读取系统代理后把 localhost API 请求导向异常路径；正式调用和 `POST /api/planning/llm/test` 测试调用都会发送 `think:false`，关闭 Qwen 3、DeepSeek R1 等可关闭的 thinking 输出；正式算法默认向 Ollama 发送 `options.num_ctx=262144`，并把本地文件片段上限放开到 200k 总字符 / 100k 单文件字符，若仍出现 502，可设置 `OLLAMA_NUM_CTX` 或 `LLM_OLLAMA_NUM_CTX` 后重启后端重试
- `POST /api/planning/evaluate/stream` 会把本地 Python stdout/stderr 映射为 `terminal`，把 enemy/force 的 LLM stdout 片段映射为 `llm-chunk`
- `POST /api/planning/llm/test` 用于在执行规划前测试当前 LLM 配置是否可用
- `敌情威胁自动分析 三维结果` 面板仍能渲染通用威胁场字段，包括 `heatmapBase64`、`heatmapGeojson`、`bounds`、`targetEntities`、`pointThreatEvaluation`、`situationMap` 和 `heatmap.matrixSummary`
- `作战目标自动分配` 的 `structuredOutput.visualization` 或 `preferredPlan.visualization` 会被单算法结果页和最终 GeoJSON 汇总读取，用于显示蓝方编组点、红方目标点、分配箭头和部署区上下文
- `GeoJSON` 空间成果包仍会收集通用 `heatmapGeojson` 威胁场采样要素，前提是当前或未来算法结果中实际提供该字段

### 4.3 乱码与异常提示清理（T16）

当前已完成核心路径提示清理，重点覆盖：

- 登录与权限：未登录、会话失效、权限不足
- 导入与删除：数据源导入/删除、情报与环境记录校验
- 执行与归档：任务执行、执行记录读取、提交与归档

收口结果：

- 关键路径不再出现 `????` 或历史乱码值
- `index.js`、`planningWorkflow.js`、`actionWorkflow.js` 相关提示已统一为可读中文
- 前端 `api.js` 的兜底错误提示已统一为中文 `请求失败：<status>`
- 能力/行动/消耗评估接口与规划主链路均支持结构化错误对象：`error.code / error.type / error.details`

### 4.4 证据溯源模型首轮落地（T14）

当前规划执行链路已完成首轮“结果可追源”闭环，覆盖数据服务抽取、规划运行时和结果展示页：

- 数据模型：`extractions` 已补充 `source_type / source_name / file_name / task_id / evidence_meta`
- 运行时结果：`threatAnalysis` 与 `forceGrouping` 输出中新增 `evidenceTrace`
- 前端展示：
  - 数据服务页可查看数据源对应抽取条目及来源元信息
  - 规划执行结果页可查看证据溯源表（来源名称、来源类型、文件名、抽取时间、摘要）

当前验收口径：

- 关键规划结果至少可追到 `数据源 / 文件名 / 来源类型 / 抽取时间`
- 同一任务多次执行后，历史结果回看仍保留对应证据字段

### 4.5 规划算法设计与测试文档

智能任务规划模块现已补充 7 份面向真实算法升级的 Markdown 设计与测试文档，位于 `docs/intelligent-task-planning/`：

- `00-module-overview.md`：模块架构、统一输入输出、接口链路、注册/切换机制、通用评分体系和升级路线图。
- `01-enemy-threat-analysis-design-test.md`：敌情威胁自动分析设计与测试。
- `02-force-grouping-design-test.md`：作战力量智能编组设计与测试。
- `03-target-allocation-design-test.md`：作战目标自动分配设计与测试。
- `04-airborne-landing-site-selection-design-test.md`：机降地域优化选择设计与测试。
- `05-method-planning-design-test.md`：作战方法自动规划设计与测试。
- `06-support-planning-design-test.md`：作战保障自动规划设计与测试。

这些文档基于当前真实代码中的 `ALGORITHM_DEFINITIONS`、`BUILTIN_EXECUTORS`、`structuredOutput` 字段、前后端接口、现有测试和导出包格式整理。后续替换真实算法时，应先保持文档列出的平台字段兼容，再逐步重写各算法核心求解逻辑。

### 5. 权限系统

- 支持注册 / 登录
- 角色分为普通用户与管理员
- 默认管理员账号：`admin`
- 默认管理员密码：`123456`
- 登录会话已改为服务端 `HttpOnly Cookie`（`SameSite=Lax`，HTTPS 下自动启用 `Secure`），前端不再把 token 写入 `localStorage`
- 除 `/api/health` 和 `/api/auth/*` 外，其余业务 API 当前均要求先登录

## 快速开始

### 方式零：macOS 一键启动脚本

项目根目录提供 `start-macos.command`，可在 Finder 中双击启动，也可在终端中带参数运行。默认启动完整开发栈：

```bash
./start-macos.command
```

常用模式：

| 命令 | 对应命令 | 用途 |
| --- | --- | --- |
| `./start-macos.command` 或 `./start-macos.command dev` | `npm run dev` | 同时启动前端开发服务和后端开发服务 |
| `./start-macos.command web` | `npm run dev:web` | 只启动前端开发服务 |
| `./start-macos.command server` | `npm run dev:server` | 只启动后端开发服务 |
| `./start-macos.command backend` | `npm run start` | 启动本地生产后台并托管前端构建产物 |
| `./start-macos.command production` | `npm run build` 后 `npm run start` | 先完整构建，再启动本地生产服务 |
| `./start-macos.command stop` | 关闭监听端口进程 | 清理默认项目端口 `5173` 和 `3100` |
| `./start-macos.command --check` | 检查 Node/npm | 只检查启动前置条件 |

说明：

- 正常启动后，在终端窗口按 `Ctrl+C` 即可退出并关闭相关服务
- 如果异常退出后端口仍被占用，可执行 `./start-macos.command stop`
- `stop` 只处理正在监听指定端口的进程；也可手动指定端口，例如 `./start-macos.command stop 5173 3100`
- 如后端端口不是默认值，可用 `PORT=3200 ./start-macos.command server` 或 `PORT=3200 ./start-macos.command stop`
- 脚本会自动切到项目根目录、检查 `Node.js` 和 `npm`，并在缺少 `node_modules` 时执行 `npm install`

### 方式零补充：Windows 一键启动脚本

项目根目录提供了一组 Windows `.bat` 启动脚本，可直接双击使用：

| 脚本 | 对应命令 | 用途 |
| --- | --- | --- |
| `start-backend.bat` | `npm run start` | 一键启动本地生产后台并托管前端构建产物 |
| `start-dev.bat` | `npm run dev` | 同时启动前端开发服务和后端开发服务 |
| `start-web-dev.bat` | `npm run dev:web` | 只启动前端开发服务 |
| `start-server-dev.bat` | `npm run dev:server` | 只启动后端开发服务 |
| `start-production.bat` | `npm run build` 后 `npm run start` | 先完整构建，再启动本地生产服务 |

通用行为：

- 自动切到项目根目录
- 检查 `Node.js` 和 `npm` 是否可用
- 需要 Node 依赖的脚本会在缺少 `node_modules` 时先执行 `npm install`
- 停止服务时，在启动窗口按 `Ctrl+C`

常用访问地址：

- 前端开发地址：`http://localhost:5173`
- 前端开发服务会显式绑定 IPv4 host，因此 `http://127.0.0.1:5173` 也可访问
- 后端 / 本地生产地址：`http://localhost:3100`

每个脚本都支持检查模式，例如：

```bat
start-dev.bat --check
```

其中 `start-backend.bat` 仍兼容之前的参数：

```bat
start-backend.bat
start-backend.bat dev
start-backend.bat --check
```

说明：

- `--check` 只检查启动前置条件，不会真正启动长驻服务

### 方式一：开发模式

在项目根目录执行：

```bash
npm install
npm run dev
```

启动后：

- 前端开发地址：`http://localhost:5173`
- 也可使用：`http://127.0.0.1:5173`
- 后端服务地址：`http://localhost:3100`

说明：

- `npm run dev` 会同时启动前端和后端
- 也可以分别启动：
  - `npm run dev:web`
  - `npm run dev:server`

### 方式二：本地生产模式

```bash
npm run build
npm run start
```

说明：

- `npm run start` 会在缺少前端构建产物时自动构建 `@mission/web`，然后启动后端并托管构建产物
- 若你需要强制重建前端，可在启动前设置 `MISSION_FORCE_WEB_BUILD=1`
- 访问地址通常为：`http://localhost:3100`

## 登录与上手建议

首次进入建议按下面顺序体验：

1. 打开 `http://localhost:5173`（开发模式）或 `http://localhost:3100`（生产模式）
2. 使用管理员账号登录：`admin / 123456`
3. 先从首页进入“总任务中心”
4. 创建或打开一个任务，再按需跳转到对应业务工作区
5. 进入“数据服务”页，检查资源接入和专题态势
6. 在“专题态势”中切换二维 / 三维视图
7. 从左侧素材区拖放单位、探测圈、命令线、区域到地图
8. 右键地图空白处快速创建要素
9. 在右侧“地图测量”中体验距离测量与面积测量
10. 右键已有要素进行编辑、定位、删除
11. 尝试导出 `PNG / PDF / KML`

## 地图测量说明

- `距离测量`：左击连续采点，可一次绘制多段折线；右击完成后会显示每段距离和总长度
- `面积测量`：左击连续采点形成多边形；双击或右击完成后会显示多边形面积
- 测量结果仅保留在当前前端地图会话中，不写入态势要素库

## 探测圈说明

### 传感器类型

当前探测圈支持以下类型：

- `雷达`：包络线更强调连续搜索和区域覆盖
- `红外`：包络线更强调热迹特征与被动探测感
- `光电`：包络线更强调视轴指向和精瞄感
- `声学`：包络线更强调柔性监听范围与层次感

### 俯仰角语义

探测圈俯仰角采用如下约定：

- `0°`：水平
- `正角度`：向上
- `负角度`：向下

示例：

- `0° ~ 180°`：主要表现上半球 / 上视探测
- `-180° ~ 0°`：主要表现下半球 / 下视探测
- `-60° ~ -10°`：适合表现朝地面或低空方向的探测扇区

### 二维模式说明

- 二维模式下会自动关闭 DEM，以避免部分单位在 2D / 3D 切换时出现位置漂移或消失
- 二维模式主要表现地面投影、轮廓线与平面态势关系
- 三维模式主要表现空间方向、俯仰角与体积探测效果

## 离线底图目录

默认将离线底图瓦片放入 `apps/web/public/dem`：

```text
apps/web/public/dem/{z}/{x}/{y}.png
apps/web/public/dem/{z}/{x}/{y}.jpg
apps/web/public/dem/{z}/{x}/{y}.jpeg
apps/web/public/dem/{z}/{x}/{y}.webp
apps/web/public/dem/{z}/{x}/{y}.svg
```

示例：

```text
apps/web/public/dem/0/0/0.svg
apps/web/public/dem/1/0/0.svg
apps/web/public/dem/1/1/0.svg
```

如果目录中存在 `apps/web/public/dem/tilemapresource.xml`，前端会优先读取其中元数据，并自动识别：

- 瓦片扩展名
- 层级范围
- 是否为 TMS 组织方式

## DEM / 地形数据说明

### 1. 离线 DEM

当前前端支持读取 **Cesium terrain 格式** 的地形目录，而不是直接读取原始 `.dem` / `.tif` 栅格。

请将转换后的地形目录放到以下任一位置：

```text
apps/web/public/terrain/
apps/web/public/dem/
```

目录中至少需要包含：

```text
layer.json
```

推荐结构示例：

```text
apps/web/public/terrain/layer.json
apps/web/public/terrain/0/0/0.terrain
```

前端会自动探测：

- `/terrain/layer.json`
- `/dem/layer.json`

维护说明：

- `apps/web/public/terrain/0` 至 `apps/web/public/terrain/14`、`layer.json`、`meta.json` 和 `README.txt` 是当前离线 DEM 运行资产，若需要保留离线地形功能，不要删除。
- `apps/web/public/terrain/.tmp/` 是地形转换或解压过程的临时目录，`apps/web/public/terrain/**/*.zip` 是转换完成后的原始压缩包副本；它们不被前端运行时读取，已加入忽略规则，可作为瘦身对象清理。

### 2. 在线 DEM / 天地图配置

可以在数据信息服务的地图控制区保存天地图 `tk` 参数。该设置保存在当前浏览器本地，优先级高于 `.env`，保存后会应用到全局地图面板，不需要重启前端。

也可以在 `apps/web/.env.local` 中配置默认值：

```bash
VITE_TDT_TOKEN=你的天地图令牌
VITE_TDT_TERRAIN_URL=Cesium兼容地形服务地址
```

说明：

- 数据信息服务保存的 token 和 `VITE_TDT_TOKEN` 都用于天地图底图访问；数据信息服务中的本地设置优先生效，清空本地设置后会回退到 `.env` 默认值
- `VITE_TDT_TERRAIN_URL` 应指向 Cesium 兼容的地形服务地址或 `layer.json`
- 若在线 DEM 不可用，系统会自动回退到离线 DEM；若离线 DEM 也不存在，则回退到平面椭球地形
- 底图默认选择为“离线底图”。若 `apps/web/public/dem` 中未检测到可用离线底图，系统会自动尝试天地图影像；若天地图影像瓦片请求返回 `418`、`403`、超时或图片加载失败，则回退到底图网格。此时状态会提示离线底图或天地图瓦片不可用。

## 示例瓦片脚本

如果你只是想快速验证离线底图流程，可以执行：

```bash
npm run tiles:sample
```

该命令会在 `apps/web/public/dem` 下生成一套轻量 SVG 示例瓦片，用于离线底图流程验证；脚本可在 macOS / Windows / Linux 通过 Node.js 直接运行。

如果你已经替换成自己的真实演示瓦片数据，则无需再执行该命令。

说明：`apps/web/public/dem` 是当前默认离线底图目录。仓库默认只保留目录说明文件，不内置离线底图瓦片；需要离线底图时请运行示例脚本或放入自己的演示瓦片。若目录为空，系统会按规则尝试天地图 token。

## 项目结构

```text
AGENTS.md   Agent 协作约束
apps/
  server/   Node API + SQLite 示例服务
  web/      Vue + Cesium 前端界面
agent.md    Agent 持久记忆
scripts/    启动与示例数据脚本
start-macos.command macOS 一键启动/停止脚本
start-*.bat Windows 一键启动脚本
README.md   使用说明
TODO.md     后续优化建议
```

补充说明：

- 前端生产构建输出目录为 `apps/web/dist/client`
- `scripts/start-production.mjs` 默认复用已有 `apps/web/dist/client/index.html`
- `start-macos.command` 默认启动开发栈，支持 `dev / web / server / backend / production / stop / --check`
- `start-backend.bat` 默认调用 `npm run start`；`start-production.bat` 会先执行完整 `npm run build` 再启动
- 根目录 `start-*.bat` 脚本首次运行若未安装 Node 依赖，会先自动执行 `npm install`
- 若需强制重建前端，可设置 `MISSION_FORCE_WEB_BUILD=1`
- 规划模块核心运行时代码位于 `apps/server/src/planning-runtime.js`
- 仓库只提交源码、测试、设计文档、示例配置和必要示例文件；`.env.example` 中只能保留占位符，真实 API key、token 和本地 `.env.*` 配置不会提交
- `node_modules`、前端构建目录、服务端运行数据库、运行时导入数据、临时文件、算法虚拟环境、算法输出结果、源码压缩包以及本地瓦片 / DEM / terrain 资产均已加入 `.gitignore`，不要把这些可再生成或大体量本地文件当作源码维护；`apps/web/public/dem/README.txt` 是例外，会随仓库保留为空目录说明
- 2026-06-15 本地瘦身清理已移除前端生产构建产物、Vite 预构建缓存、生成输入材料、算法输出样例、旧算法压缩包副本、macOS `.DS_Store`、Python 字节码 / pytest 缓存和陈旧临时 pid/log；根目录 `node_modules`、`algorithms/.venv`、`apps/server/data/mission-demo.sqlite*` 和 `data-service-sources` 保留，以保证项目仍可直接运行并保留当前演示数据

## Agent 协作约束

- 仓库根目录新增了 `AGENTS.md`
- 任何接手本项目的 agent 都必须先按顺序读取：
  1. `AGENTS.md`
  2. `agent.md`
  3. `README.md`
- 任何 agent 在修改代码后，都必须同步更新 `agent.md` 和 `README.md`
- `agent.md` 用于技术交接记忆，`README.md` 用于对外说明当前真实行为

## 代码审查快照

以下结论基于 2026-03-26 对实际代码、构建链路和黑盒接口行为的审查：

### 本次已修复项

1. `POST /api/intelligence` 和 `PUT /api/intelligence/:id` 现在会先校验 `sourceId`，对无效或不存在的数据源返回 JSON `400`，不再泄露 HTML `500` 错误页。
2. `npm run start` 现在默认复用已有前端构建产物，只在缺失时自动构建；若需要强制重建，可通过 `MISSION_FORCE_WEB_BUILD=1` 控制。
3. 规划模块的作战任务库已切换为“从模板创建任务实例并服务端持久化”，流程配置、算法绑定、输入配置会跟随任务实例保存并可恢复。
4. 规划模块新增 `机降地域优化选择`、`作战方法自动规划`、`作战保障自动规划` 三个内置算法，火力打击与机降突击任务都能输出结构化结果和三维球路线 / 点位展示。
5. `作战力量智能编组` 新增了约束模型扩展接口，当前已内置 `基础编组约束`，并会把约束评分写入推荐方案和比对结果。
6. 任务规划输出现在统一为“服务端执行归档 + 3 类导出 + 本地快照”：服务端保存 `task_runs / task_results`，并支持 `HTML / GeoJSON / CSV` 导出，前端可选另存本地 `JSON` 快照。
7. 规划模块的算法配置页、结果页和共享提示文案已经清理历史乱码，并恢复为统一中文界面。
8. `作战保障自动规划` 现已改为 `显式战损预测输入 + 保障资源池 + 资源约束调度` 的执行模型，并补充了 `node --test` 覆盖依赖校验和受约束调度结果。
9. 规划主链路已补齐前置校验与统一错误收口：`/api/planning/validate` 与 `/api/planning/evaluate` 在错误场景统一返回结构化错误类型，前后端提示文案一致。
10. 外部算法服务接入已统一为网关契约：能力/行动/消耗/规划执行共享同一套请求结构、超时规范、异常归一和版本字段，服务端新增 `algorithm_call_logs` 归档调用来源、版本和状态。
11. 登录、权限、导入、执行、归档、删除等核心路径提示已统一清理为可读中文，历史错码与乱码（含情报默认战备状态错码）已修复；前端兜底错误提示统一为 `请求失败：<status>`。
12. 数据服务导入链路已完成批量稳定性整改：支持批量队列执行、逐项成功/失败状态、失败原因落库、单项重试与任务关联导入。
13. 规划结果已完成首轮证据溯源：抽取数据结构补齐来源元信息，规划结果输出 `evidenceTrace`，前端提供证据回看入口。
14. 规划任务本地上传文件已从 `tasks.planning_algorithm_inputs` 拆分到独立附件存储；任务列表接口只返回摘要，避免把 `base64` 文件正文跟随 `/api/tasks` 全量下发。
15. 已登录状态下访问未知 `/api/*` 时，服务端现返回 JSON `404`，不再回落到前端 HTML Shell。
16. 服务端测试基线已补齐 `API 404` 与 `任务列表不回传附件正文` 两条契约测试，`npm test --workspace @mission/server` 当前为绿色。
17. 能力评估模块状态文件 `apps/web/src/modules/capabilityWorkflow.js` 的历史乱码与 `????` 占位提示已清理，任务/模板/确认框/导出告警等文案恢复为正常中文。
18. 从任务中心详情跳转到规划执行、能力评估、行动计算、消耗计算时，前端现已显式同步所选 `taskId`；规划页会加载对应任务实例，能力计算三页会绑定同一任务上下文，不再沿用本地上一次打开的其他任务编号。
19. 数据导入预览运行时文案已完成针对 `apps/server/src/import-preview.js` 的清理，Excel/CSV/Word/PDF 预览标题、摘要、抽取草稿和错误提示不再返回历史乱码；新增 `apps/server/src/import-preview.test.js` 做回归保护。
20. 本地大体量验证产物已清理：`apps/web/dist-check-*`、`apps/web/dist-auth-check` 和历史 `apps/web/public/tiles` 已从工作区移除，并通过 `.gitignore` 防止再次混入源码维护范围。
21. 本地瘦身清理已进一步移除可再生成产物：根目录 `node_modules`、`apps/web/dist`，以及 `apps/web/public/terrain` 下已展开后的 `terrain1.zip` 压缩包副本和 `.tmp` 临时地形目录；正式离线 DEM 运行目录仍保留。
22. 已移除上一版 `tactical-visualizer2.0` 敌情威胁分析外部集成：规划 Python 适配服务、相关启动脚本、默认外部绑定、专属运行参数和 DOCX 二次研判导出均已删除；三维威胁场通用渲染能力继续保留。
23. `作战目标自动分配` 已新增 `intelligent-allocation / 智能分配算法` 内置方法，调用 `algorithms/target-allocation` Python 包并在单算法结果页展示目标分配态势图层；默认方法仍为 `multi-objective`，原三种目标分配方法不被覆盖。

### 本次 review 的正向结论

- `Vue 3 + Express + SQLite` 的模块边界已经比较清晰，前端 workflow 模块和后端 template/evaluate 接口有稳定对应关系
- `planning` 模块已经真正接入主应用，而不是只留导航占位
- Web 端构建链路当前可正常完成，构建产物路径与服务端静态托管路径一致
- 新增规划算法沿用了现有 `template / evaluate / structuredOutput` 契约，没有引入第二套并行流程

### 当前仍需注意

1. 当前任务模板定义仍以内置模板为主，任务实例已服务端化；若后续需要“可协同编辑的模板库”，仍需单独建设模板治理与审批链路。
2. 当前仍缺少完整的单元测试 / 集成测试体系；虽然服务端已补齐一小组契约测试，但整体回归覆盖仍远不足以支撑大规模重构。
3. 生产部署链路更适合本地演示或离线部署，尚未拆分成完整的 CI 构建与纯运行时托管流程。
4. 新增规划算法当前属于面向演示与流程联调的启发式内置模型，尚未接入真实高精度地形代价场、外部仿真引擎或标定过的保障数据库。
5. 结果页“保存快照”按钮写入的是浏览器本地快照（按账号隔离），该辅助快照不会自动同步到服务器；权威归档以服务端 `task_runs / task_results` 为准。

## T01-T03 基线交付（2026-04-01）

已完成首轮任务基线收口，新增文档如下：

- [docs/t01-bug-ledger.md](/d:/mission/docs/t01-bug-ledger.md)：S1/S2 bug 台账，含编号、页面、现象、复现步骤、严重度、影响角色、阻断判断、修复建议、修复验证方式。
- [docs/t02-localstorage-migration-inventory.md](/d:/mission/docs/t02-localstorage-migration-inventory.md)：`localStorage` 盘点与迁移清单，明确“必须服务端化”与“允许前端保留”边界，并给出兼容迁移策略。
- [docs/t03-task-center-data-model.md](/d:/mission/docs/t03-task-center-data-model.md)：总任务中心数据模型说明。
- [docs/t03-task-center-schema-draft.sql](/d:/mission/docs/t03-task-center-schema-draft.sql)：首版数据表 SQL 草案（`tasks / task_templates / task_versions / task_runs / task_results / task_approvals / task_attachments / audit_logs`）。

本轮基线结论摘要：

1. 任务模板、共同任务、规划结果快照、正式任务状态已全部标记为必须服务端化。
2. 仅建议保留少量 UI 偏好（如面板折叠状态）在前端持久化。

首轮修复进展（同日）：

1. 登录会话已切换为服务端 `HttpOnly Cookie`，前端不再持久化 token。
2. 规划/能力/共同任务的浏览器本地持久化已切换为“按登录账号隔离 key”，避免同一浏览器下跨账号串读。
3. 服务端接口中已清理 `????` 形式的关键错误消息，返回可读中文提示。

## 后续优化

后续改进建议已经整理到：

- `TODO.md`

如果你想继续扩展，我建议优先从以下方向入手：

- 时间轴 / 态势回放
- 传感器可信度 / 目标状态
- 多人协同编辑
- 任务目标与复盘视图
