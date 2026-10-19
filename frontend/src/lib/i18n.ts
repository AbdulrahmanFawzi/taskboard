import type { ColumnKind, Priority, Role } from './types'

/** Arabic text, Gregorian calendar and Western digits: what Saudi government platforms show. */
export const LOCALE = 'ar-SA-u-ca-gregory-nu-latn'

export const roleLabel: Record<Role, string> = { Owner: 'مالك', Admin: 'مشرف', Member: 'عضو', Viewer: 'مشاهد' }
export const priorityLabel: Record<Priority, string> = { Low: 'منخفضة', Medium: 'متوسطة', High: 'عالية', Urgent: 'عاجلة' }
export const kindLabel: Record<ColumnKind, string> = { Todo: 'لم تبدأ', InProgress: 'قيد التنفيذ', Review: 'مراجعة', Done: 'مكتملة' }

/** Arabic count wording: 1 مهمة، 2 مهمتان، 3–10 مهام، 11+ مهمة. */
export function count(n: number, one: string, two: string, few: string, many = one) {
  if (n === 0) return `لا ${few}`
  if (n === 1) return one
  if (n === 2) return two
  if (n <= 10) return `${n} ${few}`
  return `${n} ${many}`
}

export const shortDate = (d: Date | string) =>
  new Date(typeof d === 'string' && d.length === 10 ? d + 'T00:00:00' : d).toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' })
export const longDate = (d: Date | string) => new Date(d).toLocaleDateString(LOCALE)
export const dateTime = (d: Date | string) => new Date(d).toLocaleString(LOCALE, { dateStyle: 'medium', timeStyle: 'short' })
export const weekday = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(LOCALE, { weekday: 'short' })
export const num = (v: number, decimals = 0) =>
  v.toLocaleString(LOCALE, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

/** Server and validation messages arrive in Arabic already; identity error codes are mapped here. */
export const identityErrors: Record<string, string> = {
  DuplicateEmail: 'هذا البريد مسجّل مسبقًا.',
  DuplicateUserName: 'هذا البريد مسجّل مسبقًا.',
  InvalidEmail: 'صيغة البريد الإلكتروني غير صحيحة.',
  PasswordTooShort: 'كلمة المرور قصيرة. استخدم 8 أحرف على الأقل.',
  PasswordRequiresUniqueChars: 'كلمة المرور تحتاج 4 أحرف مختلفة على الأقل.',
}
