import type { ReactNode } from "react";

export function PageHeader({ title, eyebrow, extra }: { title: string; eyebrow: string; extra?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
      </div>
      {extra && <div className="page-actions">{extra}</div>}
    </header>
  );
}
