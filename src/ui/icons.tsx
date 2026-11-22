// Small line icons. All are decorative: buttons carry their own labels.
import type { JSX } from 'preact';

type P = { size?: number };
const svg = (size: number, children: JSX.Element | JSX.Element[], stroke = 1.7) => (
  <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width={stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

export const IconEye = ({ size = 19 }: P) => svg(size, [<path key="a" d="M1.8 9S4.4 4 9 4s7.2 5 7.2 5-2.6 5-7.2 5S1.8 9 1.8 9z" />, <circle key="b" cx="9" cy="9" r="2.3" />], 1.6);
export const IconEyeOff = ({ size = 19 }: P) => svg(size, <path d="M3.2 6.4C2.3 7.6 1.8 9 1.8 9s2.6 5 7.2 5c1.1 0 2.1-.3 3-.7M6.3 4.5C7.1 4.2 8 4 9 4c4.6 0 7.2 5 7.2 5s-.6 1.2-1.7 2.4M2.5 2.5l13 13" />, 1.6);
export const IconPlus = ({ size = 14 }: P) => svg(size, <path d="M9 3.5v11M3.5 9h11" />, 2);
export const IconChevronDown = ({ size = 14 }: P) => svg(size, <path d="M5 7l4 4 4-4" />, 2);
export const IconChevronUp = ({ size = 14 }: P) => svg(size, <path d="M5 11l4-4 4 4" />, 2);
export const IconBack = ({ size = 16 }: P) => svg(size, <path d="M11 4.5L6.5 9l4.5 4.5" />, 2);
export const IconClose = ({ size = 15 }: P) => svg(size, <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />, 1.9);
export const IconSettings = ({ size = 18 }: P) => svg(size, [<path key="a" d="M3 5.5h6M13 5.5h2M3 9h1.5M8 9h7M3 12.5h8.5M15 12.5h0" />, <circle key="b" cx="11" cy="5.5" r="1.7" />, <circle key="c" cx="6.2" cy="9" r="1.7" />, <circle key="d" cx="13.3" cy="12.5" r="1.7" />]);
export const IconPanelHide = ({ size = 18 }: P) => svg(size, [<rect key="a" x="2.5" y="3.5" width="13" height="11" rx="2" />, <path key="b" d="M7 3.5v11M12.4 7.2L10.6 9l1.8 1.8" />]);
export const IconPanelShow = ({ size = 18 }: P) => svg(size, [<rect key="a" x="2.5" y="3.5" width="13" height="11" rx="2" />, <path key="b" d="M7 3.5v11M10.6 7.2L12.4 9l-1.8 1.8" />]);
export const IconTimeline = ({ size = 18 }: P) => svg(size, [<path key="a" d="M2.5 13.5h13" />, <path key="b" d="M3.5 10.5l3-3.5 3 2 4.5-5" />]);
export const IconPlay = ({ size = 16 }: P) => (
  <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" focusable="false"><path d="M6.5 4.6v8.8l7-4.4z" fill="currentColor" /></svg>
);
export const IconPause = ({ size = 16 }: P) => (
  <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" focusable="false"><path d="M5.5 4.5h2.4v9H5.5zM10.1 4.5h2.4v9h-2.4z" fill="currentColor" /></svg>
);
export const IconDoc = ({ size = 15 }: P) => svg(size, [<path key="a" d="M4.5 2.5h6l3 3v10h-9z" />, <path key="b" d="M10.5 2.5v3h3M7 9.5h4.5M7 12.5h4.5" />]);
export const IconCopy = ({ size = 15 }: P) => svg(size, [<rect key="a" x="2.5" y="5.5" width="9" height="9" rx="2" />, <path key="b" d="M6.5 3.5h6a2 2 0 0 1 2 2v6" />]);
export const IconExternal = ({ size = 13 }: P) => svg(size, <path d="M7 4H4.5A1.5 1.5 0 0 0 3 5.5v8A1.5 1.5 0 0 0 4.5 15h8a1.5 1.5 0 0 0 1.5-1.5V11M10 3h5v5M15 3l-7 7" />, 1.9);
export const IconWarn = ({ size = 13 }: P) => (
  <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M7 1.4l5.8 10.2H1.2zM7 5.3v2.9M7 10.1v0.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
);
export const IconFolder = ({ size = 18 }: P) => svg(size, <path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.3l1.6 1.7h5.1a1.5 1.5 0 0 1 1.5 1.5v6.8a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5z" />, 1.7);
export const IconUpload = ({ size = 20 }: P) => svg(size, <path d="M9 12.3V4.4M5.9 7.4 9 4.3l3.1 3.1M3.5 12.8v1.2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1.2" />, 1.6);
export const IconLock = ({ size = 16 }: P) => svg(size, <path d="M5 8.5h8a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1zM6.5 8.5V6.3a2.5 2.5 0 0 1 5 0v2.2" />, 1.6);
export const IconZoomIn = ({ size = 18 }: P) => svg(size, <path d="M9 4v10M4 9h10" />, 2);
export const IconZoomOut = ({ size = 18 }: P) => svg(size, <path d="M4 9h10" />, 2);
export const IconFit = ({ size = 18 }: P) => svg(size, <path d="M3 7V3h4M11 3h4v4M15 11v4h-4M7 15H3v-4" />, 1.8);
export const IconNorth = ({ size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" focusable="false"><path d="M9 2.5l3.6 9.5L9 10.3 5.4 12z" fill="currentColor" /><path d="M7.4 16V13.4l3.2 2.6v-2.6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
);
export const IconFlag = ({ size = 12 }: P) => (
  <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M2 9.5V1h5.5L6.5 3l1 2H2" fill="currentColor" /></svg>
);
export const IconCheck = ({ size = 11 }: P) => svg(size, <path d="M4 9.5l3.2 3.2L14 5.8" />, 2.6);
export const IconSearch = ({ size = 15 }: P) => svg(size, [<circle key="a" cx="8" cy="8" r="5" />, <path key="b" d="M12 12l3.5 3.5" />], 1.8);
export const IconTrash = ({ size = 15 }: P) => svg(size, <path d="M3.5 5h11M7.5 5V3.5h3V5M5 5l.7 9.5h6.6L13 5" />, 1.6);
export const IconCalc = ({ size = 13 }: P) => svg(size, [<rect key="a" x="4" y="2.5" width="10" height="13" rx="2" />, <path key="b" d="M6.5 5.5h5M6.6 9h.1M9 9h.1M11.4 9h.1M6.6 12h.1M9 12h.1M11.4 12h.1" />], 1.6);
