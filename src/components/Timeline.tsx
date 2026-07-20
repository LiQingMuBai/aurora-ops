import type { TimelineStep } from '../types.js';

// 时间线组件，把内部状态机渲染成可读的步骤列表。
type TimelineProps = {
  steps: TimelineStep[];
};

export function Timeline({ steps }: TimelineProps) {
  return (
    <div className="timeline">
      {steps.map((step) => (
        <div className={`timeline-item timeline-${step.state}`} key={step.id}>
          <div className="timeline-bullet" />
          <div>
            <strong>{step.label}</strong>
            <p>{step.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
