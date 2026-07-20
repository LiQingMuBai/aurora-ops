type MysqlConfig = {
  enabled: boolean;
  dsn: string;
  database: string;
  connectionLimit: number;
  waitForConnections: boolean;
};

type AppConfig = {
  port: number;
  rpcUrl: string;
  usdcMint: string;
  backendSecretKey: string;
  defaultDestinationOwner: string;
  listenerEnabled: boolean;
  autoTransferEnabled: boolean;
  solanaCommitment: 'processed' | 'confirmed' | 'finalized';
  mysql: MysqlConfig;
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
};

export type { AppConfig, MysqlConfig };
