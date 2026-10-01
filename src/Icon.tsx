const paths = {
  check: <path d="m4 10 4 4 8-9" />,
  circle: <><circle cx="10" cy="10" r="8" /><path d="m6 10 3 3 5-6" /></>,
  plus: <path d="M10 4v12M4 10h12" />,
  grid: <><rect x="3" y="3" width="5" height="5" rx="1" /><rect x="12" y="3" width="5" height="5" rx="1" /><rect x="3" y="12" width="5" height="5" rx="1" /><rect x="12" y="12" width="5" height="5" rx="1" /></>,
  archive: <><rect x="3" y="4" width="14" height="4" rx="1" /><path d="M4 8v8h12V8M8 11h4" /></>,
  search: <><circle cx="8" cy="8" r="5" /><path d="m12 12 5 5" /></>,
  left: <path d="m12 4-6 6 6 6" />,
  right: <path d="m8 4 6 6-6 6" />,
  target: <><circle cx="10" cy="10" r="7" /><circle cx="10" cy="10" r="3" /></>,
  folder: <path d="M2 6V4h6l2 2h8v10H2Z" />,
  download: <><path d="M10 2v10m-4-4 4 4 4-4M3 13v4h14v-4" /></>,
  edit: <><path d="m12 3 5 5-9 9H3v-5ZM10 5l5 5" /></>,
  x: <path d="m5 5 10 10M5 15 15 5" />,
  clock: <><circle cx="10" cy="10" r="7" /><path d="M10 6v4l3 2" /></>,
  shield: <><path d="m10 2 7 3v5c0 4-7 8-7 8S3 14 3 10V5Z" /><path d="m6 10 3 3 5-6" /></>
};
export function Icon({ name, size = 18 }: { name: keyof typeof paths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
