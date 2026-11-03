# 小影 STUDIO：模板素材制作

独立运行的全栈演示：浏览模板 → 上传真实图片 → 取得任务ID → Java后台按三个阶段制作 → 查询成功/失败 → 刷新恢复个人历史。结果为项目内预置图片，不调用真实AI服务。

项目目录：`D:\Files\Java\code\笔试项目\小影全栈`。2026-11-03用户将执行范围扩大为T01～T22，学习问答暂缓。实际验收见 [验证记录](docs/验证记录.md)，进度与交接见 [开发TODO](docs/开发TODO.md)，不要根据源码存在推定所有环境已通过。

## 快速启动（容器交付入口）

需要可连接的 Docker Linux 引擎与 Compose，不需要宿主机预装Java/Node/MySQL。

```powershell
Copy-Item .env.example .env
# 按需编辑 .env；本地演示默认值不含真实凭据
docker compose up --build -d --wait --wait-timeout 240
```

浏览器打开 http://localhost:3000 。默认只有前端对宿主开放端口。容器内链路：浏览器 `/api` → Next.js → `backend:8080` → `mysql:3306`。链接：[打开模板中心](http://localhost:3000/templates)。修改FRONTEND_PORT时同步APP_ORIGIN，包括协议与端口。开发HTTP的Cookie默认不设Secure，HTTPS部署设置COOKIE_SECURE=true并同步来源。

```powershell
docker compose ps
docker compose logs --tail 100 backend
docker compose stop
docker compose start
```

日常停止/重启不清卷。数据库与私人媒体分别保存在mysql-data、media-data中；不使用 `down -v` 作为重启命令。

当前本机Docker客户端可用，但Linux引擎不可连接，启动所需Windows服务缺少系统服务控制权限；容器实际运行未验证。当前源码生产服务已在 http://localhost:3000 启动，后端8080，独立MySQL13306。

已执行：Java真实MySQL测试8项、前端行为测试9项、lint/类型检查/生产构建、Java直连与Next生产代理API冒烟各8组、Chrome真实交互6组均通过。截图和命令详见验证记录。

## 版本与初始化

Java21、Spring Boot3.5.14、MyBatis Starter3.0.5；MySQL8.4.8。Next.js16.4.4、React19.2.9、TypeScript5.9.3、Node镜像24.11.0；前端其余精确版本见 frontend/package.json 与 package-lock.json，构建工具入口见 backend/pom.xml 与 Maven Wrapper。机器实际工具及官方兼容依据见 [环境核对](docs/环境核对.md)。

数据库唯一初始化入口是Flyway `backend/src/main/resources/db/migration`。V1建立用户、会话、模板、素材和任务表并插入四个模板；重复启动由Flyway版本表识别，不重复插入。已有数据库升级新增迁移，不修改已经执行的V1，不重建用户数据。

## 本地源码开发

需要JDK21、Node24、可访问的MySQL8.4，先创建专属演示库和账号（不要使用真实业务库）。后端在backend中运行：

```powershell
$env:JAVA_HOME='你的JDK21目录'
$env:DB_URL='jdbc:mysql://127.0.0.1:3306/xiaoying?connectionTimeZone=UTC'
$env:DB_USERNAME='xiaoying'
$env:DB_PASSWORD='你的演示库密码'
$env:STORAGE_DIR='./data'
$env:APP_ORIGIN='http://localhost:3000'
$env:SPRING_PROFILES_ACTIVE='demo'
.\mvnw.cmd spring-boot:run
```

另开终端，在frontend运行：

```powershell
npm ci
$env:BACKEND_URL='http://localhost:8080'
npm run dev
```

实际本机验证所用隔离库、端口和命令见验证记录；上面是通用开发入口。不要将本机绝对路径写进容器。

## 检查入口

```powershell
# frontend
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
# backend（先设置JDK；集成测试配置见验证记录）
.\mvnw.cmd -B verify
# 项目根目录，服务已启动时
node scripts/smoke.mjs http://localhost:3000
```

Java测试使用真实MySQL，不启动数据库就不会通过。请使用独立测试库：先建立xiaoying_test，将DB_URL指向该库（其他连接配置同开发），再执行verify，测试只新增演示数据。不要与正在处理任务的开发库共用，以免启动中断收尾影响演示。

浏览器验证：前后端运行后，在项目根目录执行 `node frontend/tests/browser-smoke.mjs`。Windows默认使用本机Chrome；Linux先在frontend执行 `npx playwright install chromium`。测试新增匿名演示数据并输出docs/browser截图和results.json。

Linux下使用 `./mvnw`。CI对push/PR执行前端独立lint/类型检查/测试/构建、Java verify与MySQL、Compose构建启动及真实API冒烟。远程流水线未触发就不记为通过。

## 页面与演示

- `/templates`：暗色模板网格、旅行/人像分类，数据由Java提供。
- `/templates/postcard`：一图模板制作台，左上传右任务；city/duo需要两张图片。
- `/history`：全部模板的本人历史；账户入口说明匿名身份与Cookie限制。

选择PNG/JPEG（每张≤5MB），上传完成后开始制作，右侧出现任务卡，左侧可继续提交第二个任务。演示控制可指定失败阶段与每阶段0～30000ms耗时，仅demo/test后端接受覆盖。默认执行素材检查、模拟生成、结果整理。每步失败立即停止后续步骤；卡片展示失败阶段、原因和时间。

刷新页面，记录从Java/MySQL恢复，同一Cookie保持身份。页面离开不停止Java任务。成功结果可打开对话框，Escape关闭。普通和无痕窗口为不同用户；跨用户素材、任务、结果访问返回404。

查询故障演示：浏览器开发工具临时阻断单任务GET，卡片保留最后业务状态，出现查询中断后解除阻断并点恢复查询。恢复只读取旧任务，不创建新任务。任务终态停止自动查询，离开页面清理请求/定时器。

自动API冒烟会新建匿名演示用户和少量任务，不清空已有数据。

## API 与状态契约

Java路径以 `/api` 开头，浏览器通过Next.js同源代理；Cookie、上传内容、错误状态与响应均转发。统一错误基本格式 `{code,message}`，不向浏览器返回异常堆栈。

| 方法与路径 | 行为 |
| --- | --- |
| POST /api/session；GET /api/me | 创建/复用匿名身份；查看当前身份 |
| GET /api/categories；GET /api/templates?categoryId=... | 分类和模板数组 |
| GET /api/templates/{id}；GET /api/templates/{id}/cover | 模板要求与公共封面 |
| POST /api/assets | multipart file、templateId，201返回素材ID/预览URL/类型/大小 |
| GET /api/assets/{id}/content | 本人素材内容 |
| POST /api/tasks | templateId、assetIds、有条件simulation，202返回任务快照 |
| GET /api/tasks/{id} | 本人任务快照，只读 |
| GET /api/tasks?templateId=... | 本人全量历史 `{items,nextCursor:null}` |
| GET /api/tasks/active | 本人全部未完成任务数组 |
| GET /api/tasks/{id}/result | 本人成功结果图片 |

整体状态 `QUEUED → RUNNING → SUCCEEDED / FAILED`；阶段 `CHECK_ASSETS → GENERATE → PACKAGE_RESULT`，各阶段独立保存PENDING/RUNNING/SUCCEEDED/FAILED与时间。任务快照包含id、templateId、templateTitle、status、currentStage、failedStage、error、resultUrl、version、createdAt、startedAt、finishedAt、steps。UTC时间以含Z的ISO8601表示，前端按本地时区显示。

400参数不合法、401会话失效、403来源不受信任、404不存在/无归属、413过大、415图片格式或内容不合法。GET返回HTTP200且status=FAILED表示任务执行失败；查询HTTP失败不改变任务业务状态。

## 关键文件与调用链路

浏览器组件在 `frontend/src/components`，路由在 `frontend/src/app`；`api/[...path]/route.ts`只转发、不持久化业务。shell维护身份和按ID合并的任务快照，tasks负责查询生命周期，workspace负责上传槽位与提交。

Java入口在 `backend/src/main/java/com/xiaoying`：ApiController处理HTTP；Identity验证服务端会话；MediaStore校验图片内容并保存本地文件；StoreMapper使用绑定SQL访问MySQL；TaskStore使用短事务锁定并更新任务；TaskEngine提交后派发有界单Worker，按三阶段运行。小接口不为凑层数增加空Service。

任务输入、标题、模拟参数、阶段及时间保存在任务payload中；主表status/version同事务更新。状态完整持久化，不依赖浏览器缓存。终态不回退；轮询按版本接受新快照，身份变化清理缓存。所有模板当前统一PNG/JPEG与5MB限制；提交再次检查数量、重复ID、归属与文件存在。上传与提交校验归属，私人文件不通过公开静态路径暴露。

## 限制、取舍和恢复

- 单实例内存队列，不保证重启后续跑，也不支持多实例调度。启动时将遗留等待/运行任务置失败，原因SERVICE_RESTARTED；这是中断收尾。
- 创建任务提交后、派发前仍有崩溃窗口；队列满将已创建任务置失败并可查询，HTTP线程不承担耗时制作。
- 文件系统和数据库不是同一事务。上传记录失败会尝试清理文件；崩溃窗口可能留下孤立文件。预置结果文件先准备好再发布任务成功。
- 没有后端受理幂等、自动重试和断点续跑；提交超时先看历史，前端防重复点击不等于后端幂等。
- 匿名Cookie有效期30天。清除/过期/换浏览器不能找回原身份；令牌仅在Cookie，数据库保存摘要。
- 历史全量读取适合有限演示数据，未实现分页；不做支付、真实AI、会员、任务删除等题外功能。
- 依赖核查：生产npm audit为0；全部依赖剩18项moderate，集中在ESLint开发工具的minimatch链，high/critical为0，报告见frontend/audit-all.json。未以强制降级工具掩盖问题。Flyway对MySQL8.4有超出其已测试版本的提示，真实迁移与8测试通过。

部署前配置来源/密码/HTTPS Cookie，构建启动后跑smoke。回滚须评估数据库迁移兼容性，停止写入后备份数据库和媒体；单纯切换镜像不会自动回滚数据。

## 交付与学习

PowerShell7执行 `pwsh -File scripts/package.ps1` 生成源码ZIP，白名单排除node_modules、.next、target、真实.env、私人数据、日志和原始试卷。已有同名包时使用新的OutputName，不自动覆盖。包必须包含锁文件、迁移SQL、测试、CI、Dockerfile和Compose。

[来源与AI工作流](docs/来源与AI工作流.md)记录实际分工与素材边界；实际投入未由用户确认，不虚构工时。未自动发布、推送或交卷。用户亲手练习与口述仍待完成，集中开发通过不代表用户已掌握。

需求依据：[需求分析与实施方案](docs/需求分析与实施方案.md)；[学习目标与逐轮实践](docs/学习目标与逐轮实践.md)；[开发边界与注意事项](docs/开发边界与注意事项.md)。


