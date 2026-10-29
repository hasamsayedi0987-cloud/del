import type { ReactNode } from "react";

interface IconProps {
  size?: number;
  className?: string;
}

const S = (props: IconProps, children: ReactNode, fill = false) => (
  <svg
    width={props.size ?? 22}
    height={props.size ?? 22}
    viewBox="0 0 24 24"
    fill={fill ? "currentColor" : "none"}
    stroke={fill ? "none" : "currentColor"}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={props.className}
  >
    {children}
  </svg>
);

export const IconChat = (p: IconProps) =>
  S(p, <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />);

export const IconSend = (p: IconProps) =>
  S(p, <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />);

export const IconSearch = (p: IconProps) =>
  S(p, <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>);

export const IconSettings = (p: IconProps) =>
  S(p, <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>);

export const IconBack = (p: IconProps) =>
  S(p, <path d="M15 18l-6-6 6-6" />);

export const IconPlus = (p: IconProps) =>
  S(p, <><path d="M12 5v14M5 12h14" /></>);

export const IconCheck = (p: IconProps) =>
  S(p, <path d="M20 6 9 17l-5-5" />);

export const IconDoubleCheck = (p: IconProps) =>
  S(p, <><path d="M2 12l5 5L18 6" /><path d="M9 12l5 5L22 6" /></>);

export const IconUser = (p: IconProps) =>
  S(p, <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>);

export const IconMoon = (p: IconProps) =>
  S(p, <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />);

export const IconSun = (p: IconProps) =>
  S(p, <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);

export const IconLogout = (p: IconProps) =>
  S(p, <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>);

export const IconGlobe = (p: IconProps) =>
  S(p, <><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>);

export const IconServer = (p: IconProps) =>
  S(p, <><rect x="2" y="2" width="20" height="8" rx="2" /><rect x="2" y="14" width="20" height="8" rx="2" /><path d="M6 6h.01M6 18h.01" /></>);

export const IconInfo = (p: IconProps) =>
  S(p, <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>);

export const IconHeartSolid = ({ size = 26, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
  </svg>
);
