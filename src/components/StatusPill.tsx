// 状态胶囊组件，用颜色快速表达当前连接或运行状态。
type StatusPillProps = {
  label: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
};

export function StatusPill({ label, tone = 'default' }: StatusPillProps) {
  return <span className={`status-pill status-pill-${tone}`}>{label}</span>;
}
