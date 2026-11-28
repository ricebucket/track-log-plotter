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
export const IconChevronRight = ({ size = 14 }: P) => svg(size, <path d="M7 5l4 4-4 4" />, 2);
export const IconChevronUp = ({ size = 14 }: P) => svg(size, <path d="M5 11l4-4 4 4" />, 2);
export const IconBack = ({ size = 16 }: P) => svg(size, <path d="M11 4.5L6.5 9l4.5 4.5" />, 2);
export const IconClose = ({ size = 15 }: P) => svg(size, <path d="M4.5 4.5l9 9M13.5 4.5l-9 9" />, 1.9);
/** A gear: eight teeth around a ring. */
export const IconGear = ({ size = 20 }: P) => svg(size, [<path key="a" d="M14.45 7.32 L16.39 7.73 L16.39 10.27 L14.45 10.68 L14.04 11.66 L15.12 13.33 L13.33 15.12 L11.66 14.04 L10.68 14.45 L10.27 16.39 L7.73 16.39 L7.32 14.45 L6.34 14.04 L4.67 15.12 L2.88 13.33 L3.96 11.66 L3.55 10.68 L1.61 10.27 L1.61 7.73 L3.55 7.32 L3.96 6.34 L2.88 4.67 L4.67 2.88 L6.34 3.96 L7.32 3.55 L7.73 1.61 L10.27 1.61 L10.68 3.55 L11.66 3.96 L13.33 2.88 L15.12 4.67 L14.04 6.34Z" />, <circle key="b" cx="9" cy="9" r="2.3" />], 1.5);
export const IconPanelHide = ({ size = 18 }: P) => svg(size, [<rect key="a" x="2.5" y="3.5" width="13" height="11" rx="2" />, <path key="b" d="M7 3.5v11M12.4 7.2L10.6 9l1.8 1.8" />]);
export const IconPanelShow = ({ size = 18 }: P) => svg(size, [<rect key="a" x="2.5" y="3.5" width="13" height="11" rx="2" />, <path key="b" d="M7 3.5v11M10.6 7.2L12.4 9l-1.8 1.8" />]);
/** The bottom sheet on phones brought back: its arrow points up (it hides with a down arrow, as the timeline does). */
export const IconSheetShow = ({ size = 18 }: P) => svg(size, [<rect key="a" x="2.5" y="3.5" width="13" height="11" rx="2" />, <path key="b" d="M2.5 11h13M7.2 8L9 6.2l1.8 1.8" />]);
export const IconTimeline = ({ size = 18 }: P) => svg(size, [<path key="a" d="M2.5 13.5h13" />, <path key="b" d="M3.5 10.5l3-3.5 3 2 4.5-5" />]);
export const IconPlay = ({ size = 16 }: P) => (
  <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" focusable="false"><path d="M6.5 4.6v8.8l7-4.4z" fill="currentColor" /></svg>
);
export const IconPause = ({ size = 16 }: P) => (
  <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" focusable="false"><path d="M5.5 4.5h2.4v9H5.5zM10.1 4.5h2.4v9h-2.4z" fill="currentColor" /></svg>
);
export const IconDoc = ({ size = 15 }: P) => svg(size, [<path key="a" d="M4.5 2.5h6l3 3v10h-9z" />, <path key="b" d="M10.5 2.5v3h3M7 9.5h4.5M7 12.5h4.5" />]);
/** Two arrows, up and down: swap. */
export const IconSwap = ({ size = 15 }: P) => svg(size, <path d="M6 15V3.5M6 3.5L3.2 6.3M6 3.5l2.8 2.8M12 3v11.5M12 14.5l-2.8-2.8M12 14.5l2.8-2.8" />, 1.6);
/** A small line graph. */
export const IconGraph = ({ size = 15 }: P) => svg(size, [<path key="a" d="M2.5 14.5h13" />, <path key="b" d="M3.5 11.5l3.2-4 2.8 2.2 4.5-6" />], 1.6);
export const IconCopy = ({ size = 15 }: P) => svg(size, [<rect key="a" x="2.5" y="5.5" width="9" height="9" rx="2" />, <path key="b" d="M6.5 3.5h6a2 2 0 0 1 2 2v6" />]);
/** A folded map (Google Maps links). */
export const IconMap = ({ size = 18 }: P) => svg(size, [<path key="a" d="M2.5 4.5l4-1.5 5 1.5 4-1.5v10.5l-4 1.5-5-1.5-4 1.5z" />, <path key="b" d="M6.5 3v10.5M11.5 4.5V15" />], 1.6);
/** A standing figure (Street View). */
export const IconPegman = ({ size = 18 }: P) => svg(size, [<circle key="a" cx="9" cy="4" r="1.8" />, <path key="b" d="M6.5 16l1-5.5H6V8.2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2.3h-1.5l1 5.5" />], 1.6);
/** Stacked layers (Google My Maps). */
export const IconLayers = ({ size = 18 }: P) => svg(size, [<path key="a" d="M9 2.5l6.5 3.5L9 9.5 2.5 6z" />, <path key="b" d="M2.5 9.5L9 13l6.5-3.5" />, <path key="c" d="M2.5 12.5L9 16l6.5-3.5" />], 1.6);
export const IconExternal = ({ size = 13 }: P) => svg(size, <path d="M7 4H4.5A1.5 1.5 0 0 0 3 5.5v8A1.5 1.5 0 0 0 4.5 15h8a1.5 1.5 0 0 0 1.5-1.5V11M10 3h5v5M15 3l-7 7" />, 1.9);
export const IconWarn = ({ size = 13 }: P) => (
  <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" focusable="false"><path d="M7 1.4l5.8 10.2H1.2zM7 5.3v2.9M7 10.1v0.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
);
export const IconFolder = ({ size = 18 }: P) => svg(size, <path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.3l1.6 1.7h5.1a1.5 1.5 0 0 1 1.5 1.5v6.8a1.5 1.5 0 0 1-1.5 1.5H4a1.5 1.5 0 0 1-1.5-1.5z" />, 1.7);
export const IconUpload = ({ size = 20 }: P) => svg(size, <path d="M9 12.3V4.4M5.9 7.4 9 4.3l3.1 3.1M3.5 12.8v1.2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-1.2" />, 1.6);
export const IconLock = ({ size = 16 }: P) => svg(size, <path d="M5 8.5h8a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1zM6.5 8.5V6.3a2.5 2.5 0 0 1 5 0v2.2" />, 1.6);
export const IconZoomIn = ({ size = 18 }: P) => svg(size, <path d="M9 4v10M4 9h10" />, 2);
export const IconZoomOut = ({ size = 18 }: P) => svg(size, <path d="M4 9h10" />, 2);
/** A clock face (time zones). */
export const IconClock = ({ size = 16 }: P) => svg(size, [<circle key="a" cx="9" cy="9" r="6.5" />, <path key="b" d="M9 5.5V9l2.4 1.6" />], 1.7);
/** A magnifier with a minus (zoom back out). */
export const IconZoomReset = ({ size = 16 }: P) => svg(size, [<circle key="a" cx="8" cy="8" r="5" />, <path key="b" d="M5.8 8h4.4M11.7 11.7L15 15" />], 1.8);
export const IconFit = ({ size = 18 }: P) => svg(size, <path d="M3 7V3h4M11 3h4v4M15 11v4h-4M7 15H3v-4" />, 1.8);
/** A compass needle: the red half points north. */
export const IconCompass = ({ size = 20 }: P) => (
  <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true" focusable="false"><path d="M9 1.5l3.2 7.5H5.8z" fill="#d03b3b" /><path d="M9 16.5L5.8 9h6.4z" fill="currentColor" fill-opacity="0.4" /></svg>
);
export const IconFlag = ({ size = 12 }: P) => (
  <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M2 9.5V1h5.5L6.5 3l1 2H2" fill="currentColor" /></svg>
);
export const IconCheck = ({ size = 11 }: P) => svg(size, <path d="M4 9.5l3.2 3.2L14 5.8" />, 2.6);
export const IconSearch = ({ size = 15 }: P) => svg(size, [<circle key="a" cx="8" cy="8" r="5" />, <path key="b" d="M12 12l3.5 3.5" />], 1.8);
export const IconTrash = ({ size = 15 }: P) => svg(size, <path d="M3.5 5h11M7.5 5V3.5h3V5M5 5l.7 9.5h6.6L13 5" />, 1.6);
export const IconCalc = ({ size = 13 }: P) => svg(size, [<rect key="a" x="4" y="2.5" width="10" height="13" rx="2" />, <path key="b" d="M6.5 5.5h5M6.6 9h.1M9 9h.1M11.4 9h.1M6.6 12h.1M9 12h.1M11.4 12h.1" />], 1.6);
export const IconSelect = ({ size = 16 }: P) => svg(size, [<rect key="a" x="2.4" y="2.4" width="13.2" height="13.2" rx="3.2" />, <path key="b" d="M5.7 9.2l2.3 2.3 4.4-4.8" />]);
export const IconCombine = ({ size = 16 }: P) => svg(size, <path d="M2.5 4.5c4 0 4.5 4.5 7 4.5h6M2.5 13.5c4 0 4.5-4.5 7-4.5M13 6.5L15.5 9 13 11.5" />);
export const IconTarget = ({ size = 15 }: P) => svg(size, [<circle key="a" cx="9" cy="9" r="5.2" />, <circle key="b" cx="9" cy="9" r="1.4" />, <path key="c" d="M9 1.5v2.3M9 14.2v2.3M1.5 9h2.3M14.2 9h2.3" />]);
