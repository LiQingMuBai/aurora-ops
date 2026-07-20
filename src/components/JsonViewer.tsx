// 用于展示接口原始返回，方便联调时直接观察 JSON 结构。
type JsonViewerProps = {
  title: string;
  value: unknown;
};

export function JsonViewer({ title, value }: JsonViewerProps) {
  return (
    <div className="json-card">
      <div className="json-card-header">
        <span>{title}</span>
      </div>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}
