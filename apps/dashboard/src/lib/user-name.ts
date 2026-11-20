export function fullName(u: { firstName?: string | null; lastName?: string | null } | null | undefined): string | null {
  if (!u) return null;
  const parts = [u.firstName, u.lastName].filter((p): p is string => Boolean(p && p.trim()));
  return parts.length ? parts.join(" ") : null;
}
