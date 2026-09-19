/**
 * Seed script — creates demo departments, an admin account, and several
 * employee accounts so the app can be explored immediately.
 *
 * Run with: npm run seed
 */
const bcrypt = require('bcryptjs');
const db = require('../config/db');

function upsertDepartment(name, description) {
  const existing = db.prepare('SELECT id FROM departments WHERE name = ?').get(name);
  if (existing) return existing.id;
  const r = db.prepare('INSERT INTO departments (name, description) VALUES (?, ?)').run(name, description);
  return r.lastInsertRowid;
}

function upsertUser({ employee_id, name, email, password, role, department_id, designation, phone }) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return existing.id;
  const hash = bcrypt.hashSync(password, 12);
  const r = db.prepare(`
    INSERT INTO users (employee_id, name, email, password_hash, role, department_id, designation, phone, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OFFLINE')
  `).run(employee_id, name, email, hash, role, department_id, designation, phone);
  return r.lastInsertRowid;
}

function run() {
  console.log('Seeding database...');

  const eng = upsertDepartment('Engineering', 'Product & platform engineering');
  const hr = upsertDepartment('Human Resources', 'People operations');
  const sales = upsertDepartment('Sales', 'Revenue & customer acquisition');
  const support = upsertDepartment('Customer Support', 'Customer success and support');

  const adminId = upsertUser({
    employee_id: 'ADM001',
    name: 'Alex Morgan',
    email: 'admin@company.com',
    password: 'Admin@123',
    role: 'admin',
    department_id: hr,
    designation: 'HR Administrator',
    phone: '+1-555-0100',
  });

  const employees = [
    { employee_id: 'EMP001', name: 'John Carter', email: 'john@company.com', department_id: eng, designation: 'Software Engineer', phone: '+1-555-0101' },
    { employee_id: 'EMP002', name: 'David Kim', email: 'david@company.com', department_id: eng, designation: 'Frontend Engineer', phone: '+1-555-0102' },
    { employee_id: 'EMP003', name: 'Sarah Lee', email: 'sarah@company.com', department_id: sales, designation: 'Sales Executive', phone: '+1-555-0103' },
    { employee_id: 'EMP004', name: 'Priya Patel', email: 'priya@company.com', department_id: support, designation: 'Support Specialist', phone: '+1-555-0104' },
    { employee_id: 'EMP005', name: 'Michael Chen', email: 'michael@company.com', department_id: eng, designation: 'Backend Engineer', phone: '+1-555-0105' },
  ];

  const employeeIds = [];
  for (const e of employees) {
    const id = upsertUser({ ...e, password: 'Employee@123', role: 'employee' });
    employeeIds.push(id);
  }

  // Seed a few tasks
  const taskCount = db.prepare('SELECT COUNT(*) as c FROM tasks').get().c;
  if (taskCount === 0) {
    const insertTask = db.prepare(`
      INSERT INTO tasks (assigned_to, assigned_by, title, description, priority, due_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertTask.run(employeeIds[0], adminId, 'Finish sprint retrospective doc', 'Summarize last sprint outcomes', 'MEDIUM', '2026-09-20', 'PENDING');
    insertTask.run(employeeIds[1], adminId, 'Fix dashboard responsive layout', 'Mobile breakpoint issues on cards', 'HIGH', '2026-09-18', 'IN_PROGRESS');
    insertTask.run(employeeIds[2], adminId, 'Follow up with lead - Acme Corp', 'Send proposal follow-up email', 'URGENT', '2026-09-16', 'PENDING');
  }

  // Seed a leave request
  const leaveCount = db.prepare('SELECT COUNT(*) as c FROM leave_requests').get().c;
  if (leaveCount === 0) {
    db.prepare(`
      INSERT INTO leave_requests (user_id, leave_type, from_date, to_date, reason, status)
      VALUES (?, 'CASUAL', '2026-09-25', '2026-09-26', 'Family event', 'PENDING')
    `).run(employeeIds[0]);
  }

  // Seed a welcome notification for each employee
  const insertNotif = db.prepare(`INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)`);
  for (const id of employeeIds) {
    const already = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ?').get(id).c;
    if (already === 0) {
      insertNotif.run(id, 'Welcome to the Employee Portal', 'Your account has been set up. Clock in to start tracking your work session.');
    }
  }

  console.log('Seed complete.');
  console.log('---------------------------------------------');
  console.log('Admin login:    admin@company.com / Admin@123');
  console.log('Employee login: john@company.com  / Employee@123');
  console.log('(all seeded employees use password Employee@123)');
  console.log('---------------------------------------------');
}

run();
