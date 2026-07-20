type FaviconTone = 'ok' | 'error' | 'neutral';

type FaviconPayload = {
  label: string;
  tone: FaviconTone;
};

function resolveFaviconLink(): HTMLLinkElement {
  const existing = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (existing) {
    return existing;
  }

  const link = document.createElement('link');
  link.rel = 'icon';
  document.head.append(link);
  return link;
}

function clampLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) {
    return 'A';
  }

  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) {
      return 'A';
    }
    if (numeric > 99) {
      return '99+';
    }
    return String(numeric);
  }

  return trimmed.length > 3 ? trimmed.slice(0, 3) : trimmed;
}

function resolveToneDot(tone: FaviconTone): string {
  if (tone === 'ok') {
    return '#34d399';
  }
  if (tone === 'error') {
    return '#fb7185';
  }
  return '#38bdf8';
}

function renderFaviconPng({ label, tone }: FaviconPayload): string {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return '';
  }

  const gradient = ctx.createLinearGradient(0, 0, 64, 64);
  gradient.addColorStop(0, '#0f172a');
  gradient.addColorStop(1, '#061328');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);

  const aurora = ctx.createRadialGradient(18, 14, 6, 30, 26, 46);
  aurora.addColorStop(0, 'rgba(103, 232, 249, 0.9)');
  aurora.addColorStop(1, 'rgba(56, 189, 248, 0)');
  ctx.fillStyle = aurora;
  ctx.fillRect(0, 0, 64, 64);

  ctx.fillStyle = 'rgba(148, 163, 184, 0.26)';
  ctx.strokeStyle = 'rgba(147, 197, 253, 0.22)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if ('roundRect' in ctx) {
    (ctx as CanvasRenderingContext2D & { roundRect: typeof ctx.roundRect }).roundRect(5, 5, 54, 54, 14);
  } else {
    const x = 5;
    const y = 5;
    const width = 54;
    const height = 54;
    const radius = 14;
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();

  const normalizedLabel = clampLabel(label);
  ctx.fillStyle = '#e2e8f0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = normalizedLabel.length > 2 ? '700 20px system-ui, sans-serif' : '800 26px system-ui, sans-serif';
  ctx.fillText(normalizedLabel, 32, 34);

  ctx.beginPath();
  ctx.fillStyle = resolveToneDot(tone);
  ctx.arc(50, 18, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 2;
  ctx.arc(50, 18, 6, 0, Math.PI * 2);
  ctx.stroke();

  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl;
}

export function updateFavicon(payload: FaviconPayload): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const link = resolveFaviconLink();
  const dataUrl = renderFaviconPng(payload);
  if (!dataUrl) {
    return;
  }

  link.type = 'image/png';
  link.href = dataUrl;
}
