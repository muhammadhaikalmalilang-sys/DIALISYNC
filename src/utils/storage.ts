import { UserAccount, ShiftSchedule, HDMachine, MachineAssignment, SpecialTask, MachineZoneConfig, DEFAULT_ZONES } from '../types';
import { INITIAL_EMPLOYEES, INITIAL_MACHINES, INITIAL_SPECIAL_TASKS, getInitialSchedules, getInitialMachineAssignments } from '../data/initialData';
import { autoAssignMachinesForShift, KNOWN_NURSE_NICKNAMES, NAME_TO_NICKNAME } from './scheduler';

const KEYS = {
  CURRENT_USER: 'hd_shift_current_user',
  EMPLOYEES: 'hd_shift_employees',
  SCHEDULES: 'hd_shift_schedules',
  MACHINES: 'hd_shift_machines',
  MACHINE_ASSIGNMENTS: 'hd_shift_machine_assignments',
  SPECIAL_TASKS: 'hd_shift_special_tasks',
  ZONES: 'hd_shift_machine_zones',
  DATA_VERSION: 'hd_system_data_version_v6_rshl_whatsapp',
};

// Ensure migration to RS Happy Land team and WhatsApp summary ready dataset
if (typeof window !== 'undefined') {
  try {
    const version = localStorage.getItem(KEYS.DATA_VERSION);
    if (!version || version !== 'v6_rshl_whatsapp') {
      localStorage.setItem(KEYS.EMPLOYEES, JSON.stringify(INITIAL_EMPLOYEES));
      localStorage.setItem(KEYS.MACHINES, JSON.stringify(INITIAL_MACHINES));
      localStorage.setItem(KEYS.SCHEDULES, JSON.stringify(getInitialSchedules()));
      localStorage.setItem(KEYS.MACHINE_ASSIGNMENTS, JSON.stringify(getInitialMachineAssignments()));
      localStorage.setItem(KEYS.SPECIAL_TASKS, JSON.stringify(INITIAL_SPECIAL_TASKS));

      const adminUser = INITIAL_EMPLOYEES.find((e) => e.role === 'admin') || INITIAL_EMPLOYEES[0];
      if (adminUser) {
        localStorage.setItem(KEYS.CURRENT_USER, JSON.stringify(adminUser));
      }

      localStorage.setItem(KEYS.DATA_VERSION, 'v6_rshl_whatsapp');
    }
  } catch (e) {
    console.error(e);
  }
}

export const storage = {
  getCurrentUser(): UserAccount | null {
    try {
      const data = localStorage.getItem(KEYS.CURRENT_USER);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },

  setCurrentUser(user: UserAccount | null) {
    if (user) {
      localStorage.setItem(KEYS.CURRENT_USER, JSON.stringify(user));
    } else {
      localStorage.removeItem(KEYS.CURRENT_USER);
    }
    window.dispatchEvent(new Event('hd_auth_changed'));
  },

  getEmployees(): UserAccount[] {
    try {
      const data = localStorage.getItem(KEYS.EMPLOYEES);
      if (data) {
        const parsed: UserAccount[] = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((emp) => {
            const nick = emp.nickname || (emp.name ? NAME_TO_NICKNAME[emp.name.toUpperCase()] : undefined);
            const result: UserAccount = { ...emp };
            if (nick) {
              result.nickname = nick;
            } else {
              delete result.nickname;
            }
            return result;
          });
        }
      }
    } catch (e) {
      console.error(e);
    }
    // initialize
    this.saveEmployees(INITIAL_EMPLOYEES);
    return INITIAL_EMPLOYEES;
  },

  saveEmployees(employees: UserAccount[]) {
    localStorage.setItem(KEYS.EMPLOYEES, JSON.stringify(employees));
    window.dispatchEvent(new Event('hd_data_updated'));
  },

  deleteEmployee(employeeId: string) {
    const currentEmployees = this.getEmployees();
    const updatedEmployees = currentEmployees.filter((e) => e.id !== employeeId);

    const currentSchedules = this.getSchedules();
    const updatedSchedules = currentSchedules.filter((s) => s.employeeId !== employeeId);

    const currentAssignments = this.getMachineAssignments();
    const updatedAssignments = currentAssignments.map((a) => {
      if (a.nurseId === employeeId) {
        const copy = { ...a };
        delete copy.nurseId;
        return copy;
      }
      return a;
    });

    const currentTasks = this.getSpecialTasks();
    const updatedTasks = currentTasks.filter((t) => t.assignedToId !== employeeId);

    const currentUser = this.getCurrentUser();
    let updatedUser = currentUser;
    if (currentUser && currentUser.id === employeeId) {
      const fallbackUser = updatedEmployees.find((e) => e.role === 'admin') || updatedEmployees[0];
      if (fallbackUser) {
        this.setCurrentUser(fallbackUser);
        updatedUser = fallbackUser;
      }
    }

    localStorage.setItem(KEYS.EMPLOYEES, JSON.stringify(updatedEmployees));
    localStorage.setItem(KEYS.SCHEDULES, JSON.stringify(updatedSchedules));
    localStorage.setItem(KEYS.MACHINE_ASSIGNMENTS, JSON.stringify(updatedAssignments));
    localStorage.setItem(KEYS.SPECIAL_TASKS, JSON.stringify(updatedTasks));

    window.dispatchEvent(new Event('hd_data_updated'));

    return {
      employees: updatedEmployees,
      schedules: updatedSchedules,
      assignments: updatedAssignments,
      tasks: updatedTasks,
      currentUser: updatedUser,
    };
  },

  getZones(): MachineZoneConfig[] {
    try {
      const data = localStorage.getItem(KEYS.ZONES);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const legacyZoneNameMap: Record<string, string> = {
            'Reguler A': 'Zona A (Reguler)',
            'Reguler B': 'Zona B (Reguler)',
            'Zona B Depan (Reguler)': 'Zona B (Reguler)',
            'Zona B Belakang (Reguler)': 'Zona B (Reguler)',
            'Zona C Depan (Reguler)': 'Zona C (Reguler)',
            'Zona C Belakang (Reguler)': 'Zona C (Reguler)',
            'Isolasi HBsAg(+)': 'Zona Isolasi',
            'Isolasi HCV(+)': 'Zona Isolasi',
            'VIP / Khusus': 'Zona A (Reguler)',
          };

          // Deduplicate by normalized name and track used IDs
          const seenNames = new Set<string>();
          const deduped: MachineZoneConfig[] = [];

          for (const z of parsed) {
            const normalizedName = legacyZoneNameMap[z.name] || z.name;
            if (!seenNames.has(normalizedName)) {
              seenNames.add(normalizedName);
              deduped.push({
                ...z,
                name: normalizedName,
              });
            }
          }

          // Add any missing default zones (checked by name)
          for (const dz of DEFAULT_ZONES) {
            if (!seenNames.has(dz.name)) {
              seenNames.add(dz.name);
              deduped.push(dz);
            }
          }

          // Ensure all IDs are unique and orders are clean
          const seenIds = new Set<string>();
          const finalized: MachineZoneConfig[] = deduped
            .sort((a, b) => a.order - b.order)
            .map((z, idx) => {
              let uniqueId = z.id;
              if (seenIds.has(uniqueId) || !uniqueId) {
                uniqueId = `zone-${z.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${idx + 1}`;
              }
              seenIds.add(uniqueId);
              return {
                ...z,
                id: uniqueId,
                order: idx + 1,
              };
            });

          this.saveZones(finalized);
          return finalized;
        }
      }
    } catch (e) {
      console.error(e);
    }
    this.saveZones(DEFAULT_ZONES);
    return DEFAULT_ZONES;
  },

  saveZones(zones: MachineZoneConfig[]) {
    const sorted = [...zones].sort((a, b) => a.order - b.order);
    localStorage.setItem(KEYS.ZONES, JSON.stringify(sorted));
    window.dispatchEvent(new Event('hd_data_updated'));
  },

  getSchedules(): ShiftSchedule[] {
    try {
      const data = localStorage.getItem(KEYS.SCHEDULES);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.error(e);
    }
    const initial = getInitialSchedules();
    this.saveSchedules(initial);
    return initial;
  },

  saveSchedules(schedules: ShiftSchedule[]) {
    localStorage.setItem(KEYS.SCHEDULES, JSON.stringify(schedules));
    window.dispatchEvent(new Event('hd_data_updated'));
  },

  getMachines(): HDMachine[] {
    try {
      const data = localStorage.getItem(KEYS.MACHINES);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          // Normalize any legacy zone names
          const legacyMap: Record<string, string> = {
            'Reguler A': 'Zona A (Reguler)',
            'Reguler B': 'Zona B (Reguler)',
            'Zona B Depan (Reguler)': 'Zona B (Reguler)',
            'Zona B Belakang (Reguler)': 'Zona B (Reguler)',
            'Zona C Depan (Reguler)': 'Zona C (Reguler)',
            'Zona C Belakang (Reguler)': 'Zona C (Reguler)',
            'Isolasi HBsAg(+)': 'Zona Isolasi',
            'Isolasi HCV(+)': 'Zona Isolasi',
            'VIP / Khusus': 'Zona A (Reguler)',
          };

          const seenIds = new Set<string>();
          const seenCodes = new Set<string>();
          const normalized: HDMachine[] = [];
          let hadC09 = false;

          for (const m of parsed) {
            if (!m || !m.id || !m.code) continue;
            const cleanCode = m.code.trim().toUpperCase().replace(/[\s-_]+/g, '');
            if (cleanCode === 'C09' || cleanCode === 'HDC09' || m.id === 'mach-c09') {
              hadC09 = true;
              continue;
            }
            if (seenIds.has(m.id) || seenCodes.has(cleanCode)) continue;
            seenIds.add(m.id);
            seenCodes.add(cleanCode);
            normalized.push({
              ...m,
              code: m.code.trim(),
              zone: legacyMap[m.zone] || m.zone,
            });
          }

          if (hadC09) {
            localStorage.setItem(KEYS.MACHINES, JSON.stringify(normalized));
            try {
              const assignsData = localStorage.getItem(KEYS.MACHINE_ASSIGNMENTS);
              if (assignsData) {
                const parsedAssigns: MachineAssignment[] = JSON.parse(assignsData);
                const filteredAssigns = parsedAssigns.filter((a) => a.machineId !== 'mach-c09');
                localStorage.setItem(KEYS.MACHINE_ASSIGNMENTS, JSON.stringify(filteredAssigns));
              }
            } catch (err) {
              console.error(err);
            }
          }

          return normalized;
        }
      }
    } catch (e) {
      console.error(e);
    }
    this.saveMachines(INITIAL_MACHINES);
    return INITIAL_MACHINES;
  },

  saveMachines(machines: HDMachine[]) {
    localStorage.setItem(KEYS.MACHINES, JSON.stringify(machines));
    window.dispatchEvent(new Event('hd_data_updated'));
  },

  getMachineAssignments(): MachineAssignment[] {
    try {
      const data = localStorage.getItem(KEYS.MACHINE_ASSIGNMENTS);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.error(e);
    }
    // Generate initial today assignment for morning and afternoon
    const today = '2026-09-18';
    const employees = this.getEmployees();
    const machines = this.getMachines();
    const schedules = this.getSchedules();

    const pagiNurses = employees.filter((e) => {
      const sch = schedules.find((s) => s.employeeId === e.id && s.date === today);
      return e.role === 'perawat' && sch?.shift === 'pagi';
    });

    const siangNurses = employees.filter((e) => {
      const sch = schedules.find((s) => s.employeeId === e.id && s.date === today);
      return e.role === 'perawat' && sch?.shift === 'siang';
    });

    const morningAssign = autoAssignMachinesForShift(today, 'pagi', pagiNurses, machines);
    const afternoonAssign = autoAssignMachinesForShift(today, 'siang', siangNurses, machines);
    const initial = [...morningAssign, ...afternoonAssign];
    this.saveMachineAssignments(initial);
    return initial;
  },

  saveMachineAssignments(assignments: MachineAssignment[]) {
    localStorage.setItem(KEYS.MACHINE_ASSIGNMENTS, JSON.stringify(assignments));
    window.dispatchEvent(new Event('hd_data_updated'));
  },

  getSpecialTasks(): SpecialTask[] {
    try {
      const data = localStorage.getItem(KEYS.SPECIAL_TASKS);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.error(e);
    }
    this.saveSpecialTasks(INITIAL_SPECIAL_TASKS);
    return INITIAL_SPECIAL_TASKS;
  },

  saveSpecialTasks(tasks: SpecialTask[]) {
    localStorage.setItem(KEYS.SPECIAL_TASKS, JSON.stringify(tasks));
    window.dispatchEvent(new Event('hd_data_updated'));
  },

  resetSchedules(monthPrefix?: string) {
    if (monthPrefix) {
      const current = this.getSchedules();
      const remaining = current.filter((s) => !s.date.startsWith(monthPrefix));
      this.saveSchedules(remaining);
    } else {
      this.saveSchedules([]);
    }
  },

  resetAllData() {
    localStorage.setItem(KEYS.EMPLOYEES, JSON.stringify(INITIAL_EMPLOYEES));
    localStorage.setItem(KEYS.SCHEDULES, JSON.stringify(getInitialSchedules()));
    localStorage.setItem(KEYS.MACHINES, JSON.stringify(INITIAL_MACHINES));
    localStorage.setItem(KEYS.MACHINE_ASSIGNMENTS, JSON.stringify(getInitialMachineAssignments()));
    localStorage.setItem(KEYS.SPECIAL_TASKS, JSON.stringify(INITIAL_SPECIAL_TASKS));
    const adminUser = INITIAL_EMPLOYEES.find((e) => e.role === 'admin') || INITIAL_EMPLOYEES[0];
    if (adminUser) {
      this.setCurrentUser(adminUser);
    }
    window.dispatchEvent(new Event('hd_data_updated'));
  },
};
