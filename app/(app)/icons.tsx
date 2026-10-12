// Small line icons for the sidebar (drawn here, no icon library).
const P: Record<string, React.ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="9" rx="2" /><rect x="14" y="3" width="7" height="5" rx="2" /><rect x="14" y="12" width="7" height="9" rx="2" /><rect x="3" y="16" width="7" height="5" rx="2" /></>,
  riders: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><path d="M17 4.8a3.3 3.3 0 0 1 0 6.2M18.5 14.8c1.8.6 3 2.3 3.4 5.2" /></>,
  daily: <><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M8 3v4M16 3v4M3.5 10h17" /></>,
  payroll: <><rect x="3" y="6" width="18" height="12" rx="3" /><circle cx="12" cy="12" r="2.5" /><path d="M6.5 9.5v.01M17.5 14.5v.01" /></>,
  recon: <><path d="M4 7h13l-3-3M20 17H7l3 3" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>,
  imports: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 19h16" /></>,
  rates: <><path d="M4 12.5 12 4h7a1 1 0 0 1 1 1v7l-8.5 8.5a1.5 1.5 0 0 1-2 0L4 14.5a1.5 1.5 0 0 1 0-2z" /><circle cx="15.5" cy="8.5" r="1" /></>,
  bank: <><path d="M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" /></>,
  users: <><rect x="4" y="10.5" width="16" height="10" rx="3" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 15v2" /></>,
  reports: <><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M5 19h14" /></>,
  audit: <><path d="M7 3h8l4 4v14H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></>,
  soon: <circle cx="12" cy="12" r="2" />,
};
export function Icon({ name }: { name: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{P[name] ?? P.soon}</svg>;
}
