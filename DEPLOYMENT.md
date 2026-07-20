# 部署文档

本文档用于部署 `aurora-ops`。

## 1. 部署目标

建议部署为两个进程：

- 后端 API：Express + Solana 监听器
- 前端静态站点：Vite 构建产物

你也可以在同一台服务器上同时部署前后端。

## 2. 运行要求

建议环境：

- Node.js 20+
- npm 10+
- 可访问 Solana RPC
- 可选 MySQL 8+

## 3. 环境变量

至少需要准备以下变量：

```env
PORT=3000
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_COMMITMENT=confirmed
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
BACKEND_SECRET_KEY=
DEFAULT_DESTINATION_OWNER=
ENABLE_APPROVAL_LISTENER=true
ENABLE_AUTO_TRANSFER=true
ENABLE_MYSQL_PERSISTENCE=false
MYSQL_DSN=mysql://root:password@127.0.0.1:3306/solana_delegate_demo
MYSQL_CONNECTION_LIMIT=10
MYSQL_WAIT_FOR_CONNECTIONS=true
```

重点说明：

- `BACKEND_SECRET_KEY`：后端热钱包私钥，必须保密
- `DEFAULT_DESTINATION_OWNER`：授权列表页点击按钮时默认转入的钱包地址
- `ENABLE_AUTO_TRANSFER=false`：如果你只想监听和记录，不想自动转账，可以关闭
- `ENABLE_MYSQL_PERSISTENCE=true`：如果要开启数据库记录，必须确保 MySQL 可连通

## 4. 本地或服务器初始化

拉取代码后执行：

```bash
npm install
cp .env.example .env
```

然后编辑 `.env`，至少填入：

- `BACKEND_SECRET_KEY`
- `DEFAULT_DESTINATION_OWNER`

如果使用 MySQL，还要确认：

- `ENABLE_MYSQL_PERSISTENCE=true`
- `MYSQL_DSN` 正确可用

## 5. 开发环境启动

```bash
npm run dev
```

默认会启动：

- 前端开发服务：`http://localhost:5173`
- 后端 API：`http://localhost:3000`

注意：

- 当前项目里前端代理会跟随后端 `PORT`
- 如果 `5173` 被占用，Vite 会自动切换到新端口

## 6. 生产部署建议

### 方案 A：前后端同机部署

适合快速部署和内部使用。

步骤：

1. 构建前端
2. 使用 PM2 或 systemd 常驻后端
3. 使用 Nginx 托管前端静态文件并反代后端

前端构建：

```bash
npm run build
```

后端启动：

```bash
npm run start
```

### 方案 B：前后端分离部署

适合更清晰的生产结构。

- 前端部署到静态站点平台或 Nginx
- 后端单独部署为 Node 服务
- 前端通过反向代理访问后端接口

## 7. 使用 PM2 部署后端

全局安装：

```bash
npm install -g pm2
```

启动：

```bash
pm2 start "npm run start" --name aurora-ops
```

查看状态：

```bash
pm2 status
pm2 logs aurora-ops
```

开机自启：

```bash
pm2 save
pm2 startup
```

## 8. Nginx 反向代理示例

下面示例假设：

- 前端静态文件目录：`/var/www/aurora-ops/dist`
- 后端监听：`127.0.0.1:3000`
- 域名：`your-domain.com`

```nginx
server {
    listen 80;
    server_name your-domain.com;

    root /var/www/aurora-ops/dist;
    index index.html;

    location / {
        try_files $uri /index.html;
    }

    location /health {
        proxy_pass http://127.0.0.1:3000;
    }

    location /approvals {
        proxy_pass http://127.0.0.1:3000;
    }

    location /approve {
        proxy_pass http://127.0.0.1:3000;
    }

    location /delegate {
        proxy_pass http://127.0.0.1:3000;
    }
}
```

## 9. MySQL 部署注意事项

如果启用 MySQL：

- 先保证 `MYSQL_DSN` 指向可访问实例
- 启动时后端会自动创建数据库和表
- 建议为数据库用户分配最小必要权限

建议至少开启：

- 网络访问控制
- 慢查询日志
- 定期备份

## 10. 上线前检查清单

上线前建议逐项确认：

- `.env` 中没有空的 `BACKEND_SECRET_KEY`
- `.env` 中已配置 `DEFAULT_DESTINATION_OWNER`
- `SOLANA_RPC_URL` 可访问且稳定
- 后端健康检查可用：`/health`
- 前端授权列表页可打开：`/#/approvals`
- 若启用 MySQL，数据库可以自动建表
- 日志中没有持续报错或重复重启

## 11. 健康检查

可以直接执行：

```bash
curl http://127.0.0.1:3000/health
```

应重点确认以下字段：

- `ok`
- `backendDelegate`
- `defaultDestinationOwner`
- `listenerEnabled`
- `autoTransferEnabled`
- `mysqlPersistenceEnabled`

## 12. 安全建议

- 不要把 `.env` 提交到 GitHub
- 不要把真实私钥写入 README 或部署脚本
- 生产环境建议使用专用热钱包，不要复用个人钱包
- 建议给后端增加访问控制、接口签名和操作审计
- 大额资金场景建议增加人工确认和限额策略
