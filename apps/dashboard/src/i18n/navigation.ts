import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// Locale-aware navigation helpers.
// Import Link, redirect, usePathname, useRouter from here —
// they automatically handle the locale prefix in URLs.
export const { Link, redirect, usePathname, useRouter } =
  createNavigation(routing);
