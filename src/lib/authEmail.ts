/**
 * Login is by User ID (§7 — employees have their own ID, not all have email), but Supabase Auth
 * is email/password natively. Rather than a bespoke auth system, this derives a synthetic,
 * internal-only email from the User ID for Supabase Auth's sake — real email (optional) stays
 * purely a contact field on employees_users, decoupled from login entirely.
 *
 * `.example` is an IANA-reserved TLD (RFC 2606) guaranteed never to resolve to a real domain —
 * picked deliberately so this can never collide with an employee's actual email address.
 */
const AUTH_EMAIL_DOMAIN = 'user.btm-oms.example'

export const USER_ID_MAX_LENGTH = 10
const USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,10}$/

export function isValidUserId(userId: string): boolean {
  return USER_ID_PATTERN.test(userId)
}

export function toAuthEmail(userId: string): string {
  return `${userId.trim().toLowerCase()}@${AUTH_EMAIL_DOMAIN}`
}
