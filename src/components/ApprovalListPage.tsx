import { useState } from 'react';
import { ArrowRightLeft, RefreshCw } from 'lucide-react';
import { Panel } from './Panel.js';
import { StatusPill } from './StatusPill.js';
import type { ApprovalListResponse, DelegateTransferResponse } from '../types.js';
import { shortenAddress } from '../utils/format.js';

type ApprovalListPageProps = {
  approvalList: ApprovalListResponse | null;
  approvalsLoading: boolean;
  defaultDestinationOwner: string;
  onRefresh: () => void;
};

// 独立授权列表页专门承载大量地址，支持搜索、刷新和批量浏览。
export function ApprovalListPage({
  approvalList,
  approvalsLoading,
  defaultDestinationOwner,
  onRefresh,
}: ApprovalListPageProps) {
  const [submittingSourceTokenAccount, setSubmittingSourceTokenAccount] = useState<string | null>(null);
  const [rowMessageBySource, setRowMessageBySource] = useState<Record<string, string>>({});
  const filteredItems = approvalList?.items ?? [];

  // 独立列表页支持按行触发转账，默认使用当前记录的授权金额。
  const handleTransferApprovedAmount = async (
    ownerWallet: string,
    sourceTokenAccount: string,
    amountUi: string,
  ) => {
    if (!defaultDestinationOwner.trim()) {
      setRowMessageBySource((current) => ({
        ...current,
        [sourceTokenAccount]: '缺少 .env 默认目标钱包地址配置',
      }));
      return;
    }

    try {
      setSubmittingSourceTokenAccount(sourceTokenAccount);
      setRowMessageBySource((current) => ({
        ...current,
        [sourceTokenAccount]: '正在提交转账...',
      }));

      const response = await fetch('/delegate/transfer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          owner: ownerWallet,
          ownerTokenAccount: sourceTokenAccount,
          amountUi,
        }),
      });

      const payload = (await response.json()) as DelegateTransferResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || '转账失败');
      }

      setRowMessageBySource((current) => ({
        ...current,
        [sourceTokenAccount]: `转账成功，签名：${payload.signature}`,
      }));
      onRefresh();
    } catch (error) {
      setRowMessageBySource((current) => ({
        ...current,
        [sourceTokenAccount]: error instanceof Error ? error.message : '转账失败',
      }));
    } finally {
      setSubmittingSourceTokenAccount(null);
    }
  };

  return (
    <section className="approvals-page">
      <Panel
        title="授权列表"
        eyebrow="Approvals Explorer"
        actions={
          <button className="ghost-button" onClick={onRefresh} type="button">
            <RefreshCw size={16} />
            {approvalsLoading ? '刷新中' : '刷新列表'}
          </button>
        }
      >
        <div className="approvals-toolbar approvals-toolbar-single">
          <div className="approvals-inputs" hidden>
            <label className="search-field">
              <ArrowRightLeft size={16} />
              <input readOnly value={defaultDestinationOwner} />
            </label>
          </div>

          <div className="approvals-summary approvals-summary-compact">
            <div>
              <span className="label">授权账户数</span>
              <strong>{approvalList?.total ?? 0}</strong>
            </div>
            <div>
              <span className="label">目标钱包</span>
              <strong>{shortenAddress(defaultDestinationOwner)}</strong>
            </div>
            <div>
              <span className="label">Delegate</span>
              <strong>{shortenAddress(approvalList?.delegate)}</strong>
            </div>
          </div>
        </div>

        {filteredItems.length ? (
          <div className="approval-list approval-list-page">
            {filteredItems.map((item) => {
              const canTransfer = item.transferableAmountRaw !== '0' && item.recordSource !== 'mysql';
              return (
                <article className="approval-item" key={item.sourceTokenAccount}>
                  <div className="approval-item-header">
                    <div>
                      <span className="label">授权钱包</span>
                      <strong>{item.ownerWallet}</strong>
                    </div>
                    <StatusPill
                      label={
                        item.recordSource === 'mysql' ? '历史记录' : canTransfer ? '可代扣' : '额度为 0'
                      }
                      tone={item.recordSource === 'mysql' ? 'warning' : canTransfer ? 'success' : 'warning'}
                    />
                  </div>

                  <div className="approval-item-grid">
                    <div>
                      <span className="label">授权金额</span>
                      <p>{item.delegatedAmountUi} USDC</p>
                    </div>
                    <div>
                      <span className="label">当前余额</span>
                      <p>{item.balanceUi} USDC</p>
                    </div>
                    <div>
                      <span className="label">可转金额</span>
                      <p>{item.transferableAmountUi} USDC</p>
                    </div>
                  </div>

                  <div className="approval-item-meta">
                    <div>
                      <span className="label">Source ATA</span>
                      <p>{item.sourceTokenAccount}</p>
                    </div>
                    <div>
                      <span className="label">Delegate</span>
                      <p>{shortenAddress(item.delegateWallet)}</p>
                    </div>
                  </div>

                  <div className="approval-item-actions">
                    <button
                      className="primary-button"
                      disabled={
                        submittingSourceTokenAccount === item.sourceTokenAccount ||
                        item.recordSource === 'mysql'
                      }
                      onClick={() =>
                        void handleTransferApprovedAmount(
                          item.ownerWallet,
                          item.sourceTokenAccount,
                          item.delegatedAmountUi,
                        )
                      }
                      type="button"
                    >
                      <ArrowRightLeft size={16} />
                      {item.recordSource === 'mysql'
                        ? '历史记录不可直转'
                        : submittingSourceTokenAccount === item.sourceTokenAccount
                        ? '提交中'
                        : '转移授权金额'}
                    </button>
                    <p className="approval-item-note">
                      {item.recordSource === 'mysql'
                        ? item.recordNote || '该记录来自 MySQL 持久化回显，仅用于展示历史授权；当前是否仍有效需要重新上链确认。'
                        : '将按该记录的授权金额发起转账；目标地址来自 `.env`；当前项目实际转的是 USDC。'}
                    </p>
                    {rowMessageBySource[item.sourceTokenAccount] ? (
                      <p className="approval-item-note">{rowMessageBySource[item.sourceTokenAccount]}</p>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            {approvalsLoading
              ? '正在读取链上授权列表...'
              : '当前还没有地址把 USDC 授权给后台。'}
          </div>
        )}
      </Panel>
    </section>
  );
}
