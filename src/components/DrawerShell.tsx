// Shared chrome for the right-side drawers across the app.
//
// Centralizes the three pieces every drawer copied verbatim: the backdrop
// click-to-close, the Escape key listener, and the dialog ARIA wrapper. Each
// drawer keeps its own CSS prefix (passed via `classPrefix`) so the existing
// `.txn-drawer-*`, `.ie-drawer-*`, `.eff-drawer-*`, and `.pcd-drawer-*` rules
// still match — the visual diff after adopting this shell is zero.
//
// What stays IN each drawer (and is intentionally not lifted here):
//   - the close button (each drawer renders its own, with its own icon/place)
//   - the header (titles, summary rows, toggles — all content-specific)
//   - the body (tables, KPI pills, comparison panels — all content-specific)
//
// History: the rule-of-three threshold was crossed with the I&E drawer (#378)
// becoming the fourth drawer-style surface. This primitive is the bundled
// extraction debt from that PR, kept mechanical: shell chrome only.
import { useEffect } from 'react';

type PanelTag = 'div' | 'aside';

interface Props {
  /** CSS class prefix; backdrop becomes `${classPrefix}-backdrop`, panel becomes `${classPrefix}-panel`. */
  classPrefix: string;
  /** Accessible label for the dialog. */
  ariaLabel: string;
  /** Fired when the user presses Escape or clicks the backdrop. */
  onClose: () => void;
  /** Element used for the panel itself. Defaults to `div`. Transaction drawers use `aside`. */
  panelAs?: PanelTag;
  /**
   * Optional `data-state` attribute on the panel. Used today by the transaction
   * drawers to style the empty state (`"empty" | "populated"`); omitted by
   * Efficiency and ProjectionCompare. Passing `undefined` skips the attribute.
   */
  panelDataState?: string;
  /** Drawer contents — header, body, footer, close button. */
  children: React.ReactNode;
}

export function DrawerShell({
  classPrefix,
  ariaLabel,
  onClose,
  panelAs = 'div',
  panelDataState,
  children,
}: Props) {
  // Close on Escape. Same shape every drawer used: listen for one keydown,
  // bail on Escape, clean up on unmount.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Click directly on the backdrop closes the drawer. Clicks inside the panel
  // bubble up but the `e.target === e.currentTarget` guard ignores them.
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const panelProps = {
    className: `${classPrefix}-panel`,
    role: 'dialog' as const,
    'aria-modal': true,
    'aria-label': ariaLabel,
    ...(panelDataState !== undefined ? { 'data-state': panelDataState } : {}),
  };

  return (
    <div className={`${classPrefix}-backdrop`} onClick={handleBackdropClick}>
      {panelAs === 'aside' ? <aside {...panelProps}>{children}</aside> : <div {...panelProps}>{children}</div>}
    </div>
  );
}
