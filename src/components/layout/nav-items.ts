/**
 * Shared navigation configuration for the protected shell.
 *
 * Consumed by:
 * - `src/components/layout/sidebar.tsx` (desktop, `md+`)
 * - `src/components/layout/mobile-nav.tsx` (mobile drawer, `<md`)
 *
 * Keeping the list in one place ensures the two navigation surfaces
 * never drift — adding an asset-type page here updates both at once.
 */

export interface NavItem {
  href: string;
  label: string;
  group: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "오늘 시장 상황", group: "홈" },
  { href: "/asset/us-equity", label: "미국주식", group: "자산군" },
  { href: "/asset/kr-equity", label: "한국주식", group: "자산군" },
  { href: "/asset/crypto", label: "암호화폐", group: "자산군" },
  { href: "/asset/global-etf", label: "글로벌 ETF", group: "자산군" },
  { href: "/changelog", label: "변화 로그", group: "히스토리" },
  { href: "/indicators", label: "지표 사전", group: "참고" },
];

export const GROUP_ORDER = ["홈", "자산군", "히스토리", "참고"] as const;
