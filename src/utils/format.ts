import type { ApproveStatus, TransferStatus, TimelineStep } from '../types.js';

// 把长地址压缩成适合卡片展示的短格式。
export function shortenAddress(value: string | null | undefined): string {
  if (!value) {
    return '--';
  }

  if (value.length <= 12) {
    return value;
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

// 统一拼出交易浏览器链接，页面里所有交易跳转都走这里。
export function getExplorerUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

// 把页面内部状态映射成用户可见的时间线节点。
export function buildTimeline(
  approveStatus: ApproveStatus,
  transferStatus: TransferStatus,
  hasApproveSignature: boolean,
  hasTransferSignature: boolean,
  hasError: boolean,
): TimelineStep[] {
  return [
    {
      id: 'health',
      label: '连接后端',
      detail: '读取 RPC、USDC Mint 和 delegate 地址',
      state: 'done',
    },
    {
      id: 'approve',
      label: '授权后台',
      detail: '生成并签名 ApproveChecked 交易',
      state: resolveApproveState(approveStatus, hasApproveSignature, hasError),
    },
    {
      id: 'transfer',
      label: '后台代扣',
      detail: '后台执行 TransferChecked 把 USDC 转到目标地址',
      state: resolveTransferState(transferStatus, hasTransferSignature, hasError),
    },
  ];
}

// 授权阶段的状态解析，优先级是错误 > 完成 > 进行中 > 空闲。
function resolveApproveState(
  status: ApproveStatus,
  hasSignature: boolean,
  hasError: boolean,
): TimelineStep['state'] {
  if (hasError && status === 'error') {
    return 'error';
  }

  if (hasSignature || status === 'success') {
    return 'done';
  }

  if (status === 'building' || status === 'signing' || status === 'confirming') {
    return 'active';
  }

  return 'idle';
}

// 转账阶段的状态解析，逻辑与授权阶段保持同一套语义。
function resolveTransferState(
  status: TransferStatus,
  hasSignature: boolean,
  hasError: boolean,
): TimelineStep['state'] {
  if (hasError && status === 'error') {
    return 'error';
  }

  if (hasSignature || status === 'success') {
    return 'done';
  }

  if (status === 'submitting') {
    return 'active';
  }

  return 'idle';
}
