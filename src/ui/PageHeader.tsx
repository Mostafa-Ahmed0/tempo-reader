import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  /** Small line under the title. */
  subtitle?: ReactNode;
  /** Right-aligned buttons. */
  actions?: ReactNode;
}

/** Standard top-of-page heading used by the tab pages (Library, Stats, Settings). */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        <h1 className="page-header__title">{title}</h1>
        {subtitle ? <p className="page-header__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

/** Calm placeholder block for empty states (and for the stub pages). */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <section className="empty-state">
      <h2 className="empty-state__title">{title}</h2>
      {children ? <div className="empty-state__body">{children}</div> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </section>
  );
}
