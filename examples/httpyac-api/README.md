# LightRAG API httpyac 示例

目录按接口域拆分，覆盖当前 FastAPI 服务已挂载的全部对外 HTTP API：

- `00-system.http`: `/`、`/health`、`/auth-status`
- `01-auth.http`: `/login`、`/login/guest`
- `02-documents.http`: 全部文档接口
- `03-query.http`: 全部查询接口
- `04-graph.http`: 全部图谱接口
- `05-prompt-config.http`: 全部 prompt-config 接口
- `06-workspaces.http`: 全部 workspace 接口
- `07-ollama.http`: 全部 Ollama 兼容接口

## 准备

1. 安装 httpyac

```bash
npm install -g httpyac
```

2. 在本目录创建 `.env.local`

```bash
cp examples/httpyac-api/env.example examples/httpyac-api/.env.local
```

3. 启动服务后执行

```bash
cd examples/httpyac-api
httpyac send 00-system.http --all -o body
httpyac send 02-documents.http --all -o body
```

## 约定

- 当前示例统一使用 `{{$dotenv ...}}` 读取变量，因此请把值写进本目录的 `.env.local`。
- 鉴权默认使用 `X-API-Key` 头；如果你的服务只启用了登录鉴权，可先执行 `01-auth.http` 获取 token，再把各请求改成 `Authorization: Bearer <token>`。
- `02-documents.http`、`03-query.http`、`04-graph.http`、`05-prompt-config.http`、`06-workspaces.http`、`07-ollama.http` 都已通过 `# @import ./01-auth.http` 自动复用登录令牌，执行前请先确保 `.env.local` 里的用户名和密码可用。
- 多工作区接口默认带 `LIGHTRAG-WORKSPACE` 头；未启用多工作区时可保留默认值。
- 含删除、重建、导入、合并的请求都已单独标注，执行前先确认目标数据。
- `04-graph.http` 中的 `/graph/import/custom-kg` 已按最新契约更新：关系使用 `src_id` / `tgt_id`，实体可选传 `name`，任意未知字段会进入 `custom_properties`。
- `/documents/upload` 示例使用原始 `multipart/form-data` 体，直接可发，不依赖额外文件。
- 如果你在 VS Code 外修改了 `.env.local`，执行一次 `httpyac.reset` 再重试。

## 建议执行顺序

1. `00-system.http`
2. `01-auth.http`
3. `06-workspaces.http`
4. `02-documents.http`
5. `05-prompt-config.http`
6. `03-query.http`
7. `04-graph.http`
8. `07-ollama.http`
