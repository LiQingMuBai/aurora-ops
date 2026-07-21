import { useEffect, useMemo, useState } from 'react';
import { PublicKey, Transaction } from '@solana/web3.js';
import { Activity, ArrowRightLeft, ChevronRight, ShieldCheck, Wallet } from 'lucide-react';
import { ApprovalListPage } from './components/ApprovalListPage.js';
import { Panel } from './components/Panel.js';
import { StatusPill } from './components/StatusPill.js';
import { JsonViewer } from './components/JsonViewer.js';
import { Timeline } from './components/Timeline.js';
import { usePhantomWallet } from './hooks/usePhantomWallet.js';
import type {
  ApprovalListResponse,
  ApproveStatus,
  BuildApproveResponse,
  DelegateTransferResponse,
  HealthResponse,
  ScheduledSweepToggleResponse,
  SubmitApproveResponse,
  TransferStatus,
} from './types.js';
import { buildTimeline, getExplorerUrl, shortenAddress } from './utils/format.js';
import { updateFavicon } from './utils/favicon.js';
import { findAssociatedTokenAddress } from './utils/solana.ts';

// 统一处理前端对后端接口的 JSON 请求，并把接口错误转成可读异常。
async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || '请求失败');
  }

  return data;
}

type AppPage = 'dashboard' | 'approvals';

// 用 hash 维护页面切换，避免额外引入路由依赖。
function resolveAppPage(): AppPage {
  return window.location.hash === '#/approvals' ? 'approvals' : 'dashboard';
}

export function App() {
  // 钱包能力和页面状态都在这里集中管理，方便单页模拟流程联调。
  const { provider, walletAddress, setWalletAddress, connect, disconnect } = usePhantomWallet();
  const [currentPage, setCurrentPage] = useState<AppPage>(resolveAppPage);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [approveAmount, setApproveAmount] = useState('1.25');
  const [transferAmount, setTransferAmount] = useState('1.25');
  const [approveStatus, setApproveStatus] = useState<ApproveStatus>('idle');
  const [transferStatus, setTransferStatus] = useState<TransferStatus>('idle');
  const [approveResult, setApproveResult] = useState<BuildApproveResponse | null>(null);
  const [approveSignature, setApproveSignature] = useState<string | null>(null);
  const [transferResult, setTransferResult] = useState<DelegateTransferResponse | null>(null);
  const [approvalList, setApprovalList] = useState<ApprovalListResponse | null>(null);
  const [selectedSourceTokenAccount, setSelectedSourceTokenAccount] = useState('');
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [scheduledSweepUpdating, setScheduledSweepUpdating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadHealth = async () => {
    try {
      const payload = await fetchJson<HealthResponse>('/health');
      setHealth(payload);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '健康检查失败');
    }
  };

  // 链上授权列表独立刷新，避免影响授权/转账主流程的错误提示。
  const loadApprovals = async () => {
    try {
      setApprovalsLoading(true);
      const payload = await fetchJson<ApprovalListResponse>('/approvals');
      setApprovalList(payload);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '授权列表加载失败');
    } finally {
      setApprovalsLoading(false);
    }
  };

  // 页面加载后先读取后端健康状态，用于展示 RPC、Mint 和后台 delegate 信息。
  useEffect(() => {
    void loadHealth();
    void loadApprovals();
  }, []);

  useEffect(() => {
    const label = currentPage === 'approvals' ? String(approvalList?.total ?? 0) : 'A';
    const tone = health?.ok ? 'ok' : errorMessage ? 'error' : 'neutral';
    updateFavicon({
      label,
      tone,
    });
  }, [approvalList?.total, currentPage, errorMessage, health?.ok]);

  // 监听 hash 变化，在“首页”和“授权列表页”之间切换。
  useEffect(() => {
    const syncPage = () => setCurrentPage(resolveAppPage());
    window.addEventListener('hashchange', syncPage);
    return () => window.removeEventListener('hashchange', syncPage);
  }, []);

  // 根据当前钱包地址和 USDC Mint 计算用户默认 ATA，保持页面展示与后端默认逻辑一致。
  const sourceTokenAccount = useMemo(() => {
    if (!walletAddress || !health?.usdcMint) {
      return null;
    }

    return findAssociatedTokenAddress(
      new PublicKey(walletAddress),
      new PublicKey(health.usdcMint),
    ).toBase58();
  }, [health?.usdcMint, walletAddress]);

  // 首页 Step 03 只允许从“已授权账户列表”中挑选来源账户，避免误把当前连接钱包 ATA 当成代扣来源。
  const selectedApprovalItem = useMemo(
    () =>
      approvalList?.items.find((item) => item.sourceTokenAccount === selectedSourceTokenAccount) || null,
    [approvalList?.items, selectedSourceTokenAccount],
  );

  const selectableApprovalItems = useMemo(
    () => approvalList?.items.filter((item) => item.recordSource !== 'mysql') || [],
    [approvalList?.items],
  );

  // 当前若连接的是后台 delegate 自己的钱包，则直接视为误操作场景并禁用首页代扣按钮。
  const backendWalletConnected = Boolean(
    walletAddress && health?.backendDelegate && walletAddress === health.backendDelegate,
  );

  useEffect(() => {
    if (!selectableApprovalItems.length) {
      setSelectedSourceTokenAccount('');
      return;
    }

    const currentStillExists = selectableApprovalItems.some(
      (item) => item.sourceTokenAccount === selectedSourceTokenAccount,
    );
    if (!currentStillExists) {
      setSelectedSourceTokenAccount(selectableApprovalItems[0].sourceTokenAccount);
    }
  }, [selectableApprovalItems, selectedSourceTokenAccount]);

  // 把授权状态和转账状态映射成时间线，便于用户理解当前执行到哪一步。
  const timeline = useMemo(
    () =>
      buildTimeline(
        approveStatus,
        transferStatus,
        Boolean(approveSignature),
        Boolean(transferResult?.signature),
        Boolean(errorMessage),
      ),
    [approveSignature, approveStatus, errorMessage, transferResult?.signature, transferStatus],
  );

  // 主动连接 Phantom 钱包，并把错误反馈到页面右侧调试区。
  const connectWallet = async () => {
    try {
      setErrorMessage(null);
      const address = await connect();
      setWalletAddress(address);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '钱包连接失败');
    }
  };

  // 第一步：请求后端构建 ApproveChecked 交易，再由 Phantom 完成签名和广播。
  const handleApprove = async () => {
    if (!walletAddress || !provider || !health) {
      setErrorMessage('请先连接钱包并等待健康检查完成');
      return;
    }

    try {
      setErrorMessage(null);
      setApproveStatus('building');
      const payload = await fetchJson<BuildApproveResponse>('/approve/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: walletAddress,
          amountUi: approveAmount,
        }),
      });

      setApproveResult(payload);
      setApproveStatus('signing');

      // 后端返回的是 base64 交易，前端还原后交给钱包签名。
      const transaction = Transaction.from(
        Uint8Array.from(atob(payload.serializedTransactionBase64), (char) => char.charCodeAt(0)),
      );
      const signedTransaction = await provider.signTransaction(transaction);
      const submitPayload = await fetchJson<SubmitApproveResponse>('/approve/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signedTransactionBase64: btoa(
            String.fromCharCode(...signedTransaction.serialize()),
          ),
        }),
      });

      setApproveStatus('confirming');
      setApproveSignature(submitPayload.signature);
      setApproveStatus('success');
      void loadApprovals();
    } catch (error) {
      setApproveStatus('error');
      setErrorMessage(error instanceof Error ? error.message : '授权失败');
    }
  };

  // 第二步：在用户授权完成后，直接调用后端接口执行 delegate 转账。
  const handleTransfer = async () => {
    if (backendWalletConnected) {
      setErrorMessage('当前连接的是后台 delegate 地址，首页已禁止直接执行代扣转账');
      return;
    }

    if (!selectedApprovalItem) {
      setErrorMessage('请先从已授权账户中选择一个来源账户');
      return;
    }

    try {
      setErrorMessage(null);
      setTransferStatus('submitting');
      const payload = await fetchJson<DelegateTransferResponse>('/delegate/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: selectedApprovalItem.ownerWallet,
          ownerTokenAccount: selectedApprovalItem.sourceTokenAccount,
          amountUi: transferAmount,
        }),
      });

      setTransferResult(payload);
      setTransferStatus('success');
      void loadApprovals();
    } catch (error) {
      setTransferStatus('error');
      setErrorMessage(error instanceof Error ? error.message : '代扣失败');
    }
  };

  // 首页可直接启停定时归集任务，避免每次改 .env 再重启服务。
  const handleToggleScheduledSweep = async () => {
    if (!health) {
      return;
    }

    try {
      setErrorMessage(null);
      setScheduledSweepUpdating(true);
      const payload = await fetchJson<ScheduledSweepToggleResponse>('/scheduled-sweep/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: !health.scheduledSweepEnabled,
        }),
      });

      setHealth((current) =>
        current
          ? {
              ...current,
              scheduledSweepEnabled: payload.scheduledSweepEnabled,
              scheduledSweepIntervalMs: payload.scheduledSweepIntervalMs,
              scheduledSweepMinDelegatedAmountUi: payload.scheduledSweepMinDelegatedAmountUi,
              scheduledSweepMinBalanceAmountUi: payload.scheduledSweepMinBalanceAmountUi,
            }
          : current,
      );
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '定时任务切换失败');
    } finally {
      setScheduledSweepUpdating(false);
    }
  };

  const transferBlockedMessage = backendWalletConnected
    ? '当前连接的是后台 delegate 地址。为避免把后台自己的 ATA 误当作代扣来源，首页已禁用该按钮。'
    : !selectableApprovalItems.length
      ? '当前没有可直接代扣的实时链上授权账户；MySQL 持久化记录仅用于展示历史，不可直接转账。'
      : !selectedApprovalItem
        ? '请先从已授权账户中选择一个来源账户。'
        : selectedApprovalItem.transferableAmountRaw === '0'
          ? '所选来源账户当前可转金额为 0，暂时不能执行代扣。'
          : null;

  return (
    // 页面采用左操作右观测的双栏布局，强调“模拟操作 + 调试反馈”。
    <main className="app-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Solana / USDC / Delegate Flow</p>
          <h1>
            把授权和代扣转账变成
            <br />
            一个可点击的网页模拟器
          </h1>
          <p className="hero-text">
            先让用户在 Phantom 中签名授权，再由后台 delegate 把 USDC 转到目标地址。
            这个页面会把网络状态、签名结果和接口响应全部摊开给你看。
          </p>
          <div className="hero-pills">
            <StatusPill label={health ? '后端在线' : '读取中'} tone={health ? 'success' : 'warning'} />
            <StatusPill label={walletAddress ? '钱包已连接' : '钱包未连接'} />
          </div>
          <div className="hero-nav">
            <a
              className={`nav-chip ${currentPage === 'dashboard' ? 'nav-chip-active' : ''}`}
              href="#/"
            >
              模拟首页
            </a>
            <a
              className={`nav-chip ${currentPage === 'approvals' ? 'nav-chip-active' : ''}`}
              href="#/approvals"
            >
              授权列表页
            </a>
          </div>
        </div>
        {/* 顶部信息卡用来展示当前联调最关心的三个链上标识。 */}
        <div className="hero-grid">
          <div className="metric-card">
            <span>USDC Mint</span>
            <strong>{shortenAddress(health?.usdcMint)}</strong>
          </div>
          <div className="metric-card">
            <span>Backend Delegate</span>
            <strong>{shortenAddress(health?.backendDelegate)}</strong>
          </div>
          <div className="metric-card">
            <span>当前钱包 ATA</span>
            <strong>{shortenAddress(sourceTokenAccount)}</strong>
          </div>
        </div>
      </section>
      {currentPage === 'approvals' ? (
        <ApprovalListPage
          approvalList={approvalList}
          approvalsLoading={approvalsLoading}
          defaultDestinationOwner={health?.defaultDestinationOwner || ''}
          onRefresh={() => void loadApprovals()}
        />
      ) : (
        <section className="dashboard">
          <div className="column">
            {/* 钱包连接区负责展示钱包状态、RPC 和默认 ATA。 */}
            <Panel
              title="钱包与网络"
              eyebrow="Step 01"
              actions={
                <div className="panel-actions">
                  <button
                    className={health?.scheduledSweepEnabled ? 'primary-button' : 'ghost-button'}
                    onClick={handleToggleScheduledSweep}
                    type="button"
                    disabled={!health || scheduledSweepUpdating}
                  >
                    <Activity size={16} />
                    {scheduledSweepUpdating
                      ? '切换中'
                      : health?.scheduledSweepEnabled
                        ? '关闭定时任务'
                        : '开启定时任务'}
                  </button>
                  {walletAddress ? (
                    <button className="ghost-button" onClick={disconnect} type="button">
                      断开
                    </button>
                  ) : null}
                </div>
              }
            >
              <div className="info-row">
                <div>
                  <span className="label">钱包</span>
                  <strong>{walletAddress ? shortenAddress(walletAddress) : '未连接'}</strong>
                </div>
                <button className="primary-button" onClick={connectWallet} type="button">
                  <Wallet size={16} />
                  连接 Phantom
                </button>
              </div>
              <div className="meta-grid">
                <div>
                  <span className="label">RPC</span>
                  <p>{health?.rpcUrl || '加载中'}</p>
                </div>
                <div>
                  <span className="label">当前钱包 ATA</span>
                  <p>{sourceTokenAccount || '连接钱包后自动计算'}</p>
                </div>
                <div>
                  <span className="label">定时归集</span>
                  <p>
                    {health
                      ? `${health.scheduledSweepEnabled ? '已开启' : '已关闭'} / ${Math.floor(
                          health.scheduledSweepIntervalMs / 60000,
                        )} 分钟`
                      : '加载中'}
                  </p>
                </div>
                <div>
                  <span className="label">归集阈值</span>
                  <p>
                    {health
                      ? `授权>${health.scheduledSweepMinDelegatedAmountUi} / 余额>${health.scheduledSweepMinBalanceAmountUi}`
                      : '加载中'}
                  </p>
                </div>
              </div>
            </Panel>

            {/* 授权区只做一件事：让用户给后台 delegate 一笔可控额度。 */}
            <Panel title="授权后台为 Delegate" eyebrow="Step 02">
              <label className="field">
                <span>授权 USDC 金额</span>
                <input value={approveAmount} onChange={(event) => setApproveAmount(event.target.value)} />
              </label>
              <button className="primary-button wide-button" onClick={handleApprove} type="button">
                <ShieldCheck size={16} />
                发起授权签名
              </button>
              <p className="hint">这一步会唤起 Phantom，让用户签名 `ApproveChecked` 交易。</p>
            </Panel>

            {/* 转账区复用授权结果，让后台执行真正的代扣动作。 */}
            <Panel title="后台代扣转账" eyebrow="Step 03">
              {transferBlockedMessage ? <div className="error-banner">{transferBlockedMessage}</div> : null}
              <label className="field">
                <span>来源账户（仅限已授权账户）</span>
                <select
                  value={selectedSourceTokenAccount}
                  onChange={(event) => setSelectedSourceTokenAccount(event.target.value)}
                  disabled={!selectableApprovalItems.length}
                >
                  {!selectableApprovalItems.length ? (
                    <option value="">当前没有可直接代扣的实时链上授权账户</option>
                  ) : null}
                  {selectableApprovalItems.map((item) => (
                    <option key={item.sourceTokenAccount} value={item.sourceTokenAccount}>
                      {`${shortenAddress(item.ownerWallet)} / 可转 ${item.transferableAmountUi} USDC`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>已选来源 ATA</span>
                <input readOnly value={selectedApprovalItem?.sourceTokenAccount || '请先选择已授权来源账户'} />
              </label>
              <label className="field">
                <span>目标钱包地址（来自 .env）</span>
                <input readOnly value={health?.defaultDestinationOwner || '加载中'} />
              </label>
              <label className="field">
                <span>转账 USDC 金额</span>
                <input value={transferAmount} onChange={(event) => setTransferAmount(event.target.value)} />
              </label>
              <button
                className="primary-button wide-button"
                onClick={handleTransfer}
                type="button"
                disabled={Boolean(transferBlockedMessage) || transferStatus === 'submitting'}
              >
                <ArrowRightLeft size={16} />
                {transferStatus === 'submitting' ? '提交中' : '执行 Delegate 转账'}
              </button>
              <p className="hint">
                首页不会再默认使用当前连接钱包的 ATA。这里只能从已授权账户中挑选来源账户，目标地址固定来自
                `.env` 的 `DEFAULT_DESTINATION_OWNER`。
              </p>
              {selectedApprovalItem ? (
                <p className="hint">
                  已选账户：授权 {selectedApprovalItem.delegatedAmountUi} USDC / 余额{' '}
                  {selectedApprovalItem.balanceUi} USDC / 可转 {selectedApprovalItem.transferableAmountUi} USDC
                </p>
              ) : null}
            </Panel>
          </div>

          <div className="column">
            {/* 首页只展示授权摘要，并引导进入独立列表页查看大量地址。 */}
            <Panel title="授权监控入口" eyebrow="Approvals">
              <div className="approvals-summary">
                <div>
                  <span className="label">授权账户数</span>
                  <strong>{approvalList?.total ?? 0}</strong>
                </div>
                <div>
                  <span className="label">Delegate</span>
                  <strong>{shortenAddress(approvalList?.delegate || health?.backendDelegate)}</strong>
                </div>
              </div>
              <div className="approval-entry-card">
                <p className="hero-text">
                  授权地址较多时，建议进入独立授权列表页浏览、搜索和刷新，避免首页被长列表占满。
                </p>
                <a className="primary-button nav-button" href="#/approvals">
                  查看授权列表页
                  <ChevronRight size={16} />
                </a>
              </div>
            </Panel>

            {/* 时间线负责把抽象的链上步骤翻译成用户可理解的状态机。 */}
            <Panel title="流程时间线" eyebrow="State Machine">
              <Timeline steps={timeline} />
            </Panel>

            {/* 调试区展示最近一次接口返回和交易链接，便于演示和排错。 */}
            <Panel title="结果与调试" eyebrow="Telemetry">
              <div className="result-stack">
                <div className="result-card">
                  <div className="result-title">
                    <Activity size={16} />
                    <span>最近状态</span>
                  </div>
                  <p>授权状态：{approveStatus}</p>
                  <p>转账状态：{transferStatus}</p>
                  {approveSignature ? (
                    <a href={getExplorerUrl(approveSignature)} rel="noreferrer" target="_blank">
                      查看授权交易
                    </a>
                  ) : null}
                  {transferResult?.signature ? (
                    <a href={getExplorerUrl(transferResult.signature)} rel="noreferrer" target="_blank">
                      查看转账交易
                    </a>
                  ) : null}
                </div>

                {errorMessage ? <div className="error-banner">{errorMessage}</div> : null}
                <JsonViewer title="健康检查" value={health} />
                <JsonViewer title="授权返回" value={approveResult} />
                <JsonViewer title="转账返回" value={transferResult} />
              </div>
            </Panel>
          </div>
        </section>
      )}
    </main>
  );
}
