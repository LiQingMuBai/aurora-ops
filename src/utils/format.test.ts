import { describe, expect, it } from 'vitest';
import { buildTimeline, shortenAddress } from './format.js';

// 验证地址压缩逻辑在空值和长地址场景下都符合预期。
describe('shortenAddress', () => {
  it('returns placeholder for empty value', () => {
    expect(shortenAddress('')).toBe('--');
  });

  it('shortens long addresses', () => {
    expect(shortenAddress('1234567890abcdef')).toBe('1234...cdef');
  });
});

// 验证时间线状态机在关键路径上会输出正确的节点状态。
describe('buildTimeline', () => {
  it('marks approve as active when signing', () => {
    const steps = buildTimeline('signing', 'idle', false, false, false);
    expect(steps[1]?.state).toBe('active');
  });

  it('marks transfer as done when signature exists', () => {
    const steps = buildTimeline('success', 'success', true, true, false);
    expect(steps[2]?.state).toBe('done');
  });
});
