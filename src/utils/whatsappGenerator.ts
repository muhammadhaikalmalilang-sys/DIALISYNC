import { 
  UserAccount, 
  ShiftSchedule, 
  HDMachine, 
  MachineAssignment, 
  SpecialTask,
  SPECIAL_TASK_DEFINITIONS,
  SpecialTaskCategory
} from '../types';
import { 
  getEffectiveShiftForEmployee, 
  getMachineSortOrder, 
  normalizeMachineCode,
  CLINICAL_MACHINE_ORDER,
  sortNursesByShiftScheduleOrder
} from './scheduler';

export interface WhatsAppSummaryOptions {
  dateStr: string;
  employees: UserAccount[];
  schedules: ShiftSchedule[];
  machines: HDMachine[];
  machineAssignments: MachineAssignment[];
  specialTasks: SpecialTask[];
  doctorOverridePagi?: string;
  doctorOverrideSiang?: string;
  kepalaRuangName?: string;
}

/**
 * Format contiguous machine allocations to clean readable strings:
 * Examples:
 * - ['A01', 'A02', 'A03'] -> "A01 s/d A03 (3 mesin)"
 * - ['A12', 'C01', 'C02'] -> "A12 s/d C02 (3 mesin)" (contiguous in RS Happy Land clinical layout)
 * - ['B07', 'B08', 'B09', 'C05'] -> "B07 s/d B09 +C05 (4 mesin)"
 * - ['B03', 'B04', 'B07'] -> "B03, B04, B07 (3 mesin)"
 * - ['B08', 'B09'] -> "B08, B09 (2 mesin)"
 * - ['ISO 01'] -> "ISO 01 (1 mesin)"
 */
export function formatMachineAllocation(machineCodes: string[]): string {
  if (!machineCodes || machineCodes.length === 0) {
    return 'Belum diplot (0 mesin)';
  }

  // Deduplicate and normalize
  const uniqueNormalized = Array.from(
    new Set(machineCodes.map((c) => normalizeMachineCode(c)))
  );

  // Sort according to clinical layout
  const sortedCodes = uniqueNormalized.sort(
    (a, b) => getMachineSortOrder(a) - getMachineSortOrder(b)
  );

  const totalCount = sortedCodes.length;

  // Group into contiguous blocks based on getMachineSortOrder index
  const blocks: string[][] = [];
  let currentBlock: string[] = [];

  for (let i = 0; i < sortedCodes.length; i++) {
    const code = sortedCodes[i];
    const order = getMachineSortOrder(code);

    if (currentBlock.length === 0) {
      currentBlock.push(code);
    } else {
      const prevCode = currentBlock[currentBlock.length - 1];
      const prevOrder = getMachineSortOrder(prevCode);

      // If consecutive in CLINICAL_MACHINE_ORDER
      if (order === prevOrder + 1 && prevOrder !== 999 && order !== 999) {
        currentBlock.push(code);
      } else {
        blocks.push(currentBlock);
        currentBlock = [code];
      }
    }
  }
  if (currentBlock.length > 0) {
    blocks.push(currentBlock);
  }

  // If there's only 1 block
  if (blocks.length === 1) {
    const b = blocks[0];
    if (b.length >= 3) {
      return `${b[0]} s/d ${b[b.length - 1]} (${totalCount} mesin)`;
    } else if (b.length === 2) {
      return `${b[0]}, ${b[1]} (${totalCount} mesin)`;
    } else {
      return `${b[0]} (${totalCount} mesin)`;
    }
  }

  // If there are 2 blocks: one long block (>= 3) and one single item
  if (blocks.length === 2) {
    const [b1, b2] = blocks;
    if (b1.length >= 3 && b2.length === 1) {
      // E.g. "B07 s/d B09 +C5 (4 mesin)"
      const singleClean = b2[0].replace(/^C0(\d)/, 'C$1').replace(/^B0(\d)/, 'B$1').replace(/^A0(\d)/, 'A$1');
      return `${b1[0]} s/d ${b1[b1.length - 1]} +${singleClean} (${totalCount} mesin)`;
    }
    if (b2.length >= 3 && b1.length === 1) {
      const singleClean = b1[0].replace(/^C0(\d)/, 'C$1').replace(/^B0(\d)/, 'B$1').replace(/^A0(\d)/, 'A$1');
      return `${b2[0]} s/d ${b2[b2.length - 1]} +${singleClean} (${totalCount} mesin)`;
    }
  }

  // General fallback: if all blocks are small (length <= 2), comma-separated list
  const hasLongRun = blocks.some((b) => b.length >= 3);
  if (!hasLongRun) {
    return `${sortedCodes.join(', ')} (${totalCount} mesin)`;
  }

  // If there are long runs mixed with singles, format runs as "X s/d Y" and singles as "Z"
  const formattedSegments = blocks.map((b) => {
    if (b.length >= 3) {
      return `${b[0]} s/d ${b[b.length - 1]}`;
    }
    return b.join(', ');
  });

  return `${formattedSegments.join(', ')} (${totalCount} mesin)`;
}

/**
 * Generates full WhatsApp message summary matching the hospital's exact format.
 */
export function generateWhatsAppMessage(options: WhatsAppSummaryOptions): string {
  const {
    dateStr,
    employees,
    schedules,
    machines,
    machineAssignments,
    specialTasks,
    doctorOverridePagi,
    doctorOverrideSiang,
    kepalaRuangName,
  } = options;

  const dateObj = new Date(dateStr + 'T00:00:00');
  const formattedDate = new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(dateObj);

  // Active employees
  const activeEmployees = employees.filter((e) => e.status === 'aktif');
  const activeNurses = activeEmployees.filter(
    (e) => e.role === 'perawat' || e.role === 'pj_shift'
  );

  // Kepala Ruang
  const kepalaRuang = activeEmployees.find((e) => e.role === 'kepala_ruangan');
  const targetKaruTitle = kepalaRuangName || (kepalaRuang ? kepalaRuang.name : 'Kepala Ruang HD');

  // Filter nurses per shift, sorted strictly:
  // 1. Kepala ruang, 2. PJ Shif (L), 3. PJ Shif (P), 4. Pelaksana (L), 5. Pelaksana (P)
  const pagiNurses = sortNursesByShiftScheduleOrder(
    activeNurses.filter(
      (n) => getEffectiveShiftForEmployee(n, dateStr, schedules, employees) === 'pagi'
    )
  );
  const siangNurses = sortNursesByShiftScheduleOrder(
    activeNurses.filter(
      (n) => getEffectiveShiftForEmployee(n, dateStr, schedules, employees) === 'siang'
    )
  );

  // Doctors per shift
  const doctors = activeEmployees.filter((e) => e.role === 'dokter');

  const scheduledDoctorPagi = doctors.find((d) => {
    const sch = schedules.find((s) => s.employeeId === d.id && s.date === dateStr);
    return sch?.shift === 'pagi';
  });
  const scheduledDoctorSiang = doctors.find((d) => {
    const sch = schedules.find((s) => s.employeeId === d.id && s.date === dateStr);
    return sch?.shift === 'siang';
  });

  const finalDoctorPagi = doctorOverridePagi !== undefined && doctorOverridePagi.trim() !== ''
    ? doctorOverridePagi.trim()
    : scheduledDoctorPagi?.name || 'dr. Reza Rizki Ramadhan';

  const finalDoctorSiang = doctorOverrideSiang !== undefined && doctorOverrideSiang.trim() !== ''
    ? doctorOverrideSiang.trim()
    : scheduledDoctorSiang?.name || 'dr. Paramitha Kusumadewi';

  // Helper to get assigned machines for a nurse on a shift
  const getNurseMachines = (nurseId: string, shift: 'pagi' | 'siang'): string[] => {
    return machineAssignments
      .filter(
        (a) => a.date === dateStr && a.shift === shift && a.nurseId === nurseId && !a.isOff
      )
      .map((a) => {
        const m = machines.find((mach) => mach.id === a.machineId);
        return m ? m.code : a.machineId;
      });
  };

  // Build Sif Pagi lines
  const pagiLines: string[] = [];
  pagiNurses.forEach((nurse, index) => {
    const assignedMachines = getNurseMachines(nurse.id, 'pagi');
    const allocationStr = formatMachineAllocation(assignedMachines);
    pagiLines.push(`${index + 1}. *${nurse.name.toUpperCase()}* : ${allocationStr}`);
  });

  // Build Sif Siang lines
  const siangLines: string[] = [];
  siangNurses.forEach((nurse, index) => {
    const assignedMachines = getNurseMachines(nurse.id, 'siang');
    const allocationStr = formatMachineAllocation(assignedMachines);
    siangLines.push(`${index + 1}. *${nurse.name.toUpperCase()}* : ${allocationStr}`);
  });

  // Special Tasks per shift
  const categoryOrder: SpecialTaskCategory[] = [
    'pj_shift',
    'farmasi_logistik',
    'bhp',
    'cito',
    'natrium_ro',
  ];

  const categoryLabels: Record<SpecialTaskCategory, string> = {
    pj_shift: 'PJ SIF',
    farmasi_logistik: 'FARMASI LOGISTIK',
    bhp: 'BHP',
    cito: 'CITO',
    natrium_ro: 'NATRIUM RO',
  };

  const getShiftTasks = (shift: 'pagi' | 'siang'): string[] => {
    const shiftTasks = specialTasks.filter(
      (t) => t.date === dateStr && t.shift === shift
    );

    const taskLines: string[] = [];

    // Group by category
    categoryOrder.forEach((cat) => {
      const matching = shiftTasks.filter((t) => t.category === cat);
      if (matching.length > 0) {
        // Collect assigned names
        const assignedNames = matching
          .map((t) => {
            const emp = employees.find((e) => e.id === t.assignedToId);
            return emp ? emp.name.toUpperCase() : t.assignedToId;
          })
          .filter(Boolean);

        // Deduplicate
        const uniqueNames = Array.from(new Set(assignedNames));
        if (uniqueNames.length > 0) {
          const label = categoryLabels[cat] || cat.toUpperCase();
          taskLines.push(`• *${label} :* ${uniqueNames.join(' + ')}`);
        }
      }
    });

    return taskLines;
  };

  const tasksPagi = getShiftTasks('pagi');
  const tasksSiang = getShiftTasks('siang');

  // Off / Cuti
  const offEmployees = activeEmployees.filter((e) => {
    if (e.role === 'kepala_ruangan') return false;
    const eff = getEffectiveShiftForEmployee(e, dateStr, schedules, employees);
    return eff === 'libur' || eff === 'cuti' || eff === 'izin' || eff === 'sakit';
  });

  const liburNames = offEmployees
    .filter((e) => getEffectiveShiftForEmployee(e, dateStr, schedules, employees) === 'libur')
    .map((e) => e.name.toUpperCase());

  const cutiNames = offEmployees
    .filter((e) => {
      const eff = getEffectiveShiftForEmployee(e, dateStr, schedules, employees);
      return eff === 'cuti' || eff === 'izin' || eff === 'sakit';
    })
    .map((e) => e.name.toUpperCase());

  let offCutiText = '';
  const offParts: string[] = [];
  if (liburNames.length > 0) {
    offParts.push(`Libur: ${liburNames.join(', ')}`);
  }
  if (cutiNames.length > 0) {
    offParts.push(`Cuti/Izin/Sakit: ${cutiNames.join(', ')}`);
  }
  offCutiText = offParts.length > 0 ? offParts.join(' | ') : '-';

  // Inactive machines (maintenance / perbaikan / isOff)
  const getInactiveMachines = (shift: 'pagi' | 'siang'): string => {
    const offAssignments = machineAssignments.filter(
      (a) => a.date === dateStr && a.shift === shift && a.isOff
    );
    const offMachineIds = new Set(offAssignments.map((a) => a.machineId));

    const inactiveList = machines.filter(
      (m) =>
        offMachineIds.has(m.id) ||
        m.status === 'maintenance' ||
        m.status === 'perbaikan'
    );

    if (inactiveList.length === 0) {
      return '';
    }

    return inactiveList.map((m) => m.code).join(', ');
  };

  const inactivePagi = getInactiveMachines('pagi');
  const inactiveSiang = getInactiveMachines('siang');

  // Construct final WhatsApp Message String
  const parts: string[] = [
    '📋 *RINGKASAN JADWAL & ALOKASI MESIN HD*',
    '🏥 *RS Happy Land Medical Centre* • Ruang Dialisis Gedung Timur Lt.3',
    `📅 *${formattedDate}*`,
    `Kepada Yth. *${targetKaruTitle}*`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    `🌅 *SIF PAGI* (${pagiNurses.length} Staf)`,
    `🩺 *DOKTER SIF PAGI :* ${finalDoctorPagi}`,
    '',
    pagiLines.length > 0 ? pagiLines.join('\n') : '*(Belum ada perawat pelaksana pagi)*',
    '',
    `🌇 *SIF SIANG* (${siangNurses.length} Staf)`,
    `🩺 *DOKTER SIF SIANG :* ${finalDoctorSiang}`,
    '',
    siangLines.length > 0 ? siangLines.join('\n') : '*(Belum ada perawat pelaksana siang)*',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '🏷️ *TUGAS KHUSUS / PIC HARI INI:*',
    '*SIF PAGI*',
    tasksPagi.length > 0 ? tasksPagi.join('\n') : '• *PIC :* -',
    '',
    '*SIF SIANG*',
    tasksSiang.length > 0 ? tasksSiang.join('\n') : '• *PIC :* -',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    `🌴 *Off/Cuti :* ${offCutiText}`,
    '',
    '⚠️ *Mesin Non-Aktif :*',
    `Pagi : ${inactivePagi}`,
    `Siang : ${inactiveSiang}`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    'Unit Dialisis - RS HAPPY LAND MEDICAL CENTRE YOGYAKARTA',
  ];

  return parts.join('\n');
}

/**
 * Formats clean international phone number for WhatsApp link:
 * - "0812-3456-7890" -> "6281234567890"
 * - "+6281234567890" -> "6281234567890"
 */
export function formatPhoneNumberForWhatsApp(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) {
    return '62' + digits.slice(1);
  }
  if (digits.startsWith('62')) {
    return digits;
  }
  return digits;
}

/**
 * Builds WhatsApp Web / App direct launch URL
 */
export function buildWhatsAppUrl(phone: string, message: string): string {
  const cleanPhone = formatPhoneNumberForWhatsApp(phone);
  const encodedText = encodeURIComponent(message);
  if (cleanPhone) {
    return `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedText}`;
  }
  return `https://api.whatsapp.com/send?text=${encodedText}`;
}
