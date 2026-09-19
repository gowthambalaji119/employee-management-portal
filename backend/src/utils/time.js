// All server-side, authoritative time utilities.
// The frontend NEVER sends timestamps that are trusted for calculations.

require('dotenv').config();

const RULES = {
  standardWorkHours: parseFloat(process.env.STANDARD_WORK_HOURS || '8'),
  maxBreakMinutes: parseInt(process.env.MAX_BREAK_MINUTES || '60', 10),
  lateLoginThreshold: process.env.LATE_LOGIN_THRESHOLD || '09:15',
  halfDayThresholdHours: parseFloat(process.env.HALF_DAY_THRESHOLD_HOURS || '4'),
};

/** Returns current server timestamp in ISO 8601 (UTC) */
function nowISO() {
  return new Date().toISOString();
}

/** Returns YYYY-MM-DD for "today" on the server, used as the attendance date key */
function todayDateStr(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/** Seconds between two ISO timestamps (b - a), never negative */
function diffSeconds(aISO, bISO) {
  const a = new Date(aISO).getTime();
  const b = new Date(bISO).getTime();
  const diff = Math.floor((b - a) / 1000);
  return diff > 0 ? diff : 0;
}

/** Format seconds as HH:MM:SS */
function formatHMS(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':');
}

/** Determine whether a login time (ISO) is "late" per configured threshold (HH:MM local server time) */
function isLateLogin(loginISO) {
  const d = new Date(loginISO);
  const [h, m] = RULES.lateLoginThreshold.split(':').map(Number);
  const thresholdMinutes = h * 60 + m;
  const loginMinutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return loginMinutes > thresholdMinutes;
}

/** Compute overtime seconds given actual worked seconds vs standard hours */
function computeOvertimeSeconds(actualWorkSeconds) {
  const standardSeconds = RULES.standardWorkHours * 3600;
  const overtime = actualWorkSeconds - standardSeconds;
  return overtime > 0 ? overtime : 0;
}

/** Determine attendance status from worked hours */
function computeAttendanceStatus(actualWorkSeconds, isOnLeave = false) {
  if (isOnLeave) return 'ON_LEAVE';
  const hours = actualWorkSeconds / 3600;
  if (hours <= 0) return 'ABSENT';
  if (hours < RULES.halfDayThresholdHours) return 'HALF_DAY';
  return 'PRESENT';
}

module.exports = {
  RULES,
  nowISO,
  todayDateStr,
  diffSeconds,
  formatHMS,
  isLateLogin,
  computeOvertimeSeconds,
  computeAttendanceStatus,
};
