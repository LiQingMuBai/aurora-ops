import type { PropsWithChildren, ReactNode } from 'react';

// 通用面板组件，用来统一页面里各个卡片区块的标题和边框样式。
type PanelProps = PropsWithChildren<{
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
}>;

export function Panel({ title, eyebrow, actions, children }: PanelProps) {
  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          {eyebrow ? <p className="panel-eyebrow">{eyebrow}</p> : null}
          <h2>{title}</h2>
        </div>
        {actions ? <div>{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
