// 后端健康检查接口返回的数据结构。
export type HealthResponse = {
  ok: boolean;
  rpcUrl: string;
  usdcMint: string;
  backendDelegate: string;
  defaultDestinationOwner: string;
  defaultDestinationTokenAccount: string;
};

// 当前链上已授权给后台 delegate 的 USDC 账户列表项。
export type ApprovalListItem = {
  sourceTokenAccount: string;
  ownerWallet: string;
  delegateWallet: string;
  balanceRaw: string;
  balanceUi: string;
  delegatedAmountRaw: string;
  delegatedAmountUi: string;
  transferableAmountRaw: string;
  transferableAmountUi: string;
};

// 授权列表接口返回的数据结构。
export type ApprovalListResponse = {
  mint: string;
  delegate: string;
  decimals: number;
  total: number;
  items: ApprovalListItem[];
};

// “构建授权交易”接口返回给前端的钱包签名材料。
export type BuildApproveResponse = {
  delegate: string;
  sourceTokenAccount: string;
  mint: string;
  amountUi: string;
  rawAmount: string;
  decimals: number;
  serializedTransactionBase64: string;
  note: string;
};

// “后台 delegate 转账”接口返回给前端的结果结构。
export type DelegateTransferResponse = {
  signature: string;
  mint: string;
  sourceTokenAccount: string;
  destinationTokenAccount: string;
  delegate: string;
  amountUi: string;
  rawAmount: string;
};

// 前端对授权和转账分别维护一套独立状态机。
export type ApproveStatus = 'idle' | 'building' | 'signing' | 'confirming' | 'success' | 'error';
export type TransferStatus = 'idle' | 'submitting' | 'success' | 'error';

// 时间线组件使用的统一节点结构。
export type TimelineStep = {
  id: string;
  label: string;
  detail: string;
  state: 'idle' | 'active' | 'done' | 'error';
};
