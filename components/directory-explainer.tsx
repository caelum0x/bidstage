import type { ReactNode } from "react";

export function DirectoryExplainer({
  children,
  eyebrow,
  id,
  title,
}: {
  children: ReactNode;
  eyebrow: string;
  id: string;
  title: string;
}) {
  return (
    <section className="directory-explainer shell" aria-labelledby={id}>
      <div>
        <span>{eyebrow}</span>
        <h2 id={id}>{title}</h2>
      </div>
      <div className="directory-explainer-copy">{children}</div>
    </section>
  );
}
