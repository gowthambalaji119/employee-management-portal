const db = require('../config/db');
const { nowISO, diffSeconds, formatHMS } = require('../utils/time');
const { findActiveSession } = require('./authController');

/**
 * POST /api/session/heartbeat
 * Called periodically (e.g. every 20-30s) by the client while a tab is open.
 * Keeps last_heartbeat fresh so that on reconnect the server can tell the
 * client how long it's been since it last heard from this session — enabling
 * "Resume Session" vs "Close Previous Session" recovery prompts.
 */
function heartbeat(req, res) {
  const userId = req.user.id;
  const session = findActiveSession.get(userId);
  if (!session) return res.status(404).json({ error: 'No active session' });

  db.prepare(`UPDATE work_sessions SET last_heartbeat = ? WHERE id = ?`).run(nowISO(), session.id);
  return res.json({ ok: true, serverTime: nowISO() });
}

/**
 * GET /api/session/current
 * Returns the authoritative, server-computed live state of the caller's session:
 * status, elapsed working seconds (paused during break), elapsed break seconds.
 * This is the single source of truth the frontend timer displays should sync to.
 */
function currentSessionState(req, res) {
  const userId = req.user.id;
  const session = findActiveSession.get(userId);
  if (!session) {
    return res.json({ session: null, status: 'OFFLINE' });
  }

  const now = nowISO();
  const openBreak = db
    .prepare(`SELECT * FROM breaks WHERE work_session_id = ? AND break_end IS NULL`)
    .get(session.id);

  const closedBreaksSeconds = db
    .prepare(`SELECT COALESCE(SUM(duration_seconds),0) as total FROM breaks WHERE work_session_id = ? AND break_end IS NOT NULL`)
    .get(session.id).total;

  let liveBreakSeconds = closedBreaksSeconds;
  let liveWorkSeconds;
  let status = 'ONLINE';

  const totalElapsed = diffSeconds(session.login_time, now);

  if (openBreak) {
    status = 'ON_BREAK';
    liveBreakSeconds += diffSeconds(openBreak.break_start, now);
    liveWorkSeconds = Math.max(0, totalElapsed - liveBreakSeconds);
  } else {
    liveWorkSeconds = Math.max(0, totalElapsed - liveBreakSeconds);
  }

  return res.json({
    session: {
      id: session.id,
      loginTime: session.login_time,
      status,
    },
    status,
    serverTime: now,
    workingSeconds: liveWorkSeconds,
    breakSeconds: liveBreakSeconds,
    workingFormatted: formatHMS(liveWorkSeconds),
    breakFormatted: formatHMS(liveBreakSeconds),
  });
}

module.exports = { heartbeat, currentSessionState };
