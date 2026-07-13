export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function watchReducedMotion(onChange: (reduced: boolean) => void) {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  const handleChange = (event: MediaQueryListEvent) => onChange(event.matches);
  onChange(query.matches);
  query.addEventListener('change', handleChange);
  return () => query.removeEventListener('change', handleChange);
}
