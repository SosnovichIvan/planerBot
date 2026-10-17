const paths = {
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M18 6 6 18',
  refresh: 'M20 7v5h-5M19 12a7 7 0 1 1-2-5l3 3',
  previous: 'm15 5-7 7 7 7',
  next: 'm9 5 7 7-7 7',
  down: 'm6 9 6 6 6-6',
  calendar: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2',
  clock: 'M12 8v4l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  moon: 'M20 14a8 8 0 0 1-10-10 8.5 8.5 0 1 0 10 10',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
};

export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg className="size-[20px] flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
