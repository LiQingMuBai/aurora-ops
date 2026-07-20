import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise';
import { appConfig, type MysqlConfig } from './config.js';

type MysqlPersistenceConfig = {
  enabled: boolean;
  dsn: string;
  database: string;
  connectionLimit: number;
  waitForConnections: boolean;
};

export type ApprovalPersistencePayload = {
  sourceTokenAccount: string;
  ownerWallet: string;
  delegateWallet: string;
  destinationTokenAccount: string;
  mint: string;
  triggerSource: string;
  observedSlot: number | null;
  tokenBalanceRaw: string;
  delegatedAmountRaw: string;
  transferableAmountRaw: string;
  fingerprint: string | null;
  status:
    | 'approved'
    | 'processing'
    | 'skipped'
    | 'transferred'
    | 'failed'
    | 'duplicate'
    | 'delegate_mismatch';
  transferSignature?: string | null;
  errorMessage?: string | null;
};

let mysqlPool: Pool | null = null;

// MySQL 配置统一来自 .env，避免在业务代码里散落默认值。
export function getMysqlPersistenceConfig(): MysqlPersistenceConfig {
  const mysqlConfig: MysqlConfig = appConfig.mysql;
  return mysqlConfig;
}

function requireMysqlPool(): Pool {
  if (!mysqlPool) {
    throw new Error('MySQL persistence pool has not been initialized');
  }

  return mysqlPool;
}

function buildBootstrapMysqlDsn(dsn: string): string {
  const url = new URL(dsn);
  url.pathname = '/';
  return url.toString();
}

// 启动时自动创建数据库和表结构，方便本地直接落库。
export async function initMysqlPersistence(): Promise<void> {
  const config = getMysqlPersistenceConfig();
  if (!config.enabled) {
    return;
  }

  if (!config.dsn) {
    throw new Error('Missing MYSQL_DSN');
  }

  const bootstrapConnection = await mysql.createConnection(buildBootstrapMysqlDsn(config.dsn));

  await bootstrapConnection.query(
    `CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await bootstrapConnection.end();

  mysqlPool = mysql.createPool({
    uri: config.dsn,
    connectionLimit: config.connectionLimit,
    waitForConnections: config.waitForConnections,
  });

  const pool = requireMysqlPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS approval_transfer_records (
      source_token_account VARCHAR(64) PRIMARY KEY,
      owner_wallet VARCHAR(64) NOT NULL,
      delegate_wallet VARCHAR(64) NOT NULL,
      destination_token_account VARCHAR(64) NOT NULL,
      mint VARCHAR(64) NOT NULL,
      last_trigger_source VARCHAR(128) NOT NULL,
      last_observed_slot BIGINT NULL,
      token_balance_raw VARCHAR(64) NOT NULL,
      delegated_amount_raw VARCHAR(64) NOT NULL,
      transferable_amount_raw VARCHAR(64) NOT NULL,
      last_fingerprint VARCHAR(128) NULL,
      last_status VARCHAR(32) NOT NULL,
      last_transfer_signature VARCHAR(128) NULL,
      last_error_message TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_records_owner_wallet (owner_wallet),
      KEY idx_records_delegate_wallet (delegate_wallet),
      KEY idx_records_last_status (last_status)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS approval_transfer_history (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      source_token_account VARCHAR(64) NOT NULL,
      owner_wallet VARCHAR(64) NOT NULL,
      delegate_wallet VARCHAR(64) NOT NULL,
      destination_token_account VARCHAR(64) NOT NULL,
      mint VARCHAR(64) NOT NULL,
      trigger_source VARCHAR(128) NOT NULL,
      observed_slot BIGINT NULL,
      token_balance_raw VARCHAR(64) NOT NULL,
      delegated_amount_raw VARCHAR(64) NOT NULL,
      transferable_amount_raw VARCHAR(64) NOT NULL,
      fingerprint VARCHAR(128) NULL,
      status VARCHAR(32) NOT NULL,
      transfer_signature VARCHAR(128) NULL,
      error_message TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_history_source_token_account (source_token_account),
      KEY idx_history_status (status),
      KEY idx_history_created_at (created_at)
    )
  `);
}

// 读取上一次处理指纹，用来避免同一授权状态被重复消费。
export async function getPersistedFingerprint(
  sourceTokenAccount: string,
): Promise<string | null> {
  const config = getMysqlPersistenceConfig();
  if (!config.enabled || !mysqlPool) {
    return null;
  }

  const [rows] = await mysqlPool.query<(RowDataPacket & { last_fingerprint: string | null })[]>(
    `
      SELECT last_fingerprint
      FROM approval_transfer_records
      WHERE source_token_account = ?
      LIMIT 1
    `,
    [sourceTokenAccount],
  );

  return rows[0]?.last_fingerprint ?? null;
}

// 每次监听到授权、开始处理、跳过、失败或转账成功，都把最新状态写入当前表并追加历史表。
export async function persistApprovalTransferRecord(
  payload: ApprovalPersistencePayload,
): Promise<void> {
  const config = getMysqlPersistenceConfig();
  if (!config.enabled || !mysqlPool) {
    return;
  }

  const pool = requireMysqlPool();
  await pool.query(
    `
      INSERT INTO approval_transfer_records (
        source_token_account,
        owner_wallet,
        delegate_wallet,
        destination_token_account,
        mint,
        last_trigger_source,
        last_observed_slot,
        token_balance_raw,
        delegated_amount_raw,
        transferable_amount_raw,
        last_fingerprint,
        last_status,
        last_transfer_signature,
        last_error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        owner_wallet = VALUES(owner_wallet),
        delegate_wallet = VALUES(delegate_wallet),
        destination_token_account = VALUES(destination_token_account),
        mint = VALUES(mint),
        last_trigger_source = VALUES(last_trigger_source),
        last_observed_slot = VALUES(last_observed_slot),
        token_balance_raw = VALUES(token_balance_raw),
        delegated_amount_raw = VALUES(delegated_amount_raw),
        transferable_amount_raw = VALUES(transferable_amount_raw),
        last_fingerprint = VALUES(last_fingerprint),
        last_status = VALUES(last_status),
        last_transfer_signature = VALUES(last_transfer_signature),
        last_error_message = VALUES(last_error_message)
    `,
    [
      payload.sourceTokenAccount,
      payload.ownerWallet,
      payload.delegateWallet,
      payload.destinationTokenAccount,
      payload.mint,
      payload.triggerSource,
      payload.observedSlot,
      payload.tokenBalanceRaw,
      payload.delegatedAmountRaw,
      payload.transferableAmountRaw,
      payload.fingerprint,
      payload.status,
      payload.transferSignature || null,
      payload.errorMessage || null,
    ],
  );

  await pool.query(
    `
      INSERT INTO approval_transfer_history (
        source_token_account,
        owner_wallet,
        delegate_wallet,
        destination_token_account,
        mint,
        trigger_source,
        observed_slot,
        token_balance_raw,
        delegated_amount_raw,
        transferable_amount_raw,
        fingerprint,
        status,
        transfer_signature,
        error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      payload.sourceTokenAccount,
      payload.ownerWallet,
      payload.delegateWallet,
      payload.destinationTokenAccount,
      payload.mint,
      payload.triggerSource,
      payload.observedSlot,
      payload.tokenBalanceRaw,
      payload.delegatedAmountRaw,
      payload.transferableAmountRaw,
      payload.fingerprint,
      payload.status,
      payload.transferSignature || null,
      payload.errorMessage || null,
    ],
  );
}
