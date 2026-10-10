import React from "react";

const paths = {
  school: <><path d="m3 10 9-7 9 7v10H3Z" /><path d="M9 20v-6h6v6M7 10h.01M17 10h.01M10 8h4" /></>,
  students: <><path d="m2 8 10-5 10 5-10 5Z" /><path d="M6 10v6c4 3 8 3 12 0v-6M22 8v7" /></>,
  teachers: <><rect x="3" y="3" width="18" height="13" rx="2" /><path d="M8 21v-5m8 5v-5M7 8h10M7 11h6" /></>,
  employees: <><rect x="3" y="7" width="18" height="14" rx="3" /><path d="M8 7V4h8v3M3 12c6 4 12 4 18 0M10 13h4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2" /></>,
  edit: <><path d="m15 5 4 4M4 20l5-1L21 7a2.8 2.8 0 0 0-4-4L5 15Z" /></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
  sparkles: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4M18 4h4" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4Z" /><circle cx="12" cy="13" r="3.5" /></>,
};

export default function Icon({ name, className = "" }) {
  return (
    <svg className={`icon ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
