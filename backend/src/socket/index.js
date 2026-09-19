const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');
require('dotenv').config();

let ioInstance = null;

/** Parse JWT from the socket handshake cookie header */
function getUserFromSocket(socket) {
  try {
    const rawCookie = socket.handshake.headers.cookie;
    if (!rawCookie) return null;
    const parsed = cookie.parse(rawCookie);
    const token = parsed.token;
    if (!token) return null;
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return null;
  }
}

function initSocket(httpServer) {
  ioInstance = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_ORIGIN || true,
      credentials: true,
    },
  });

  ioInstance.on('connection', (socket) => {
    const user = getUserFromSocket(socket);
    if (!user) {
      // Allow connection but flag as unauthenticated; client should re-auth.
      socket.emit('unauthenticated');
      socket.disconnect(true);
      return;
    }

    // Join role-based & personal rooms
    socket.join(`user:${user.id}`);
    if (user.role === 'admin') {
      socket.join('admins');
    }

    socket.on('disconnect', () => {
      // Presence itself is tracked via DB/session state, not socket connection,
      // so a dropped socket does not by itself end a work session (see session recovery).
    });
  });

  return ioInstance;
}

function getIO() {
  if (!ioInstance) throw new Error('Socket.IO not initialized yet');
  return ioInstance;
}

/** Broadcast helpers used by controllers */
const emitters = {
  employeeOnline(payload) {
    getIO().to('admins').emit('employee_online', payload);
  },
  employeeBreakStart(payload) {
    getIO().to('admins').emit('employee_break_start', payload);
  },
  employeeBreakEnd(payload) {
    getIO().to('admins').emit('employee_break_end', payload);
  },
  employeeLogout(payload) {
    getIO().to('admins').emit('employee_logout', payload);
  },
  employeeStatusChanged(payload) {
    getIO().to('admins').emit('employee_status_changed', payload);
    // also notify the employee's own room (multi-tab sync)
    if (payload.userId) getIO().to(`user:${payload.userId}`).emit('employee_status_changed', payload);
  },
  attendanceUpdated(payload) {
    getIO().to('admins').emit('attendance_updated', payload);
    if (payload.userId) getIO().to(`user:${payload.userId}`).emit('attendance_updated', payload);
  },
  notificationCreated(userId, payload) {
    getIO().to(`user:${userId}`).emit('notification_created', payload);
  },
};

module.exports = { initSocket, getIO, emitters };
