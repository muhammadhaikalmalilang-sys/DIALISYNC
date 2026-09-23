import { 
  ShiftSchedule, 
  HDMachine, 
  MachineAssignment, 
  UserAccount, 
  Nurse, 
  Machine, 
  ShiftAssignment, 
  ShiftType, 
  AppSettings,
  DoctorShiftDuty
} from '../types';
import { GoogleSheetsService } from '../domain/GoogleSheetsService';
import { ScheduleImportService } from '../domain/ScheduleImportService';

export interface SyncPayloadData {
  monthPrefix: string;
  domainNurses: Nurse[];
  domainMachines: Machine[];
  domainMonthlyAssignments: ShiftAssignment[];
  bays: string[];
}

/**
 * Converts app state to domain models suitable for Google Sheets sync.
 */
export function prepareSyncPayload(
  schedules: ShiftSchedule[],
  employees: UserAccount[],
  machines: HDMachine[],
  machineAssignments: MachineAssignment[],
  monthPrefix: string
): SyncPayloadData {
  const domainMachines: Machine[] = (machines || []).map((m, idx) => ({
    id: isNaN(Number(m.id)) ? idx + 1 : Number(m.id),
    code: m.code,
    name: `Mesin HD ${m.code}`,
    brandModel: (m as any).brandModel || m.model || 'Nipro / Fresenius',
    category: ((m as any).category || 'REGULER') as any,
    status: (m.status === 'siap' || m.status === 'dipakai' || m.status === 'AKTIF')
      ? 'AKTIF'
      : (m.status === 'maintenance' || m.status === 'MAINTENANCE')
      ? 'MAINTENANCE'
      : 'RUSAK',
    bay: m.bay || m.zone || 'Bay A',
    operationalShift: (m as any).operationalShift || 'ALL',
    notes: m.notes,
  }));

  const domainNurses: Nurse[] = employees
    .filter((e) => e.role !== 'dokter')
    .map((e, idx) => ({
      id: isNaN(Number(e.id)) ? idx + 1 : Number(e.id),
      name: e.name,
      nip: e.nip,
      phone: e.phone,
      role: e.role === 'kepala_ruangan' ? 'KARU' : e.role === 'pj_shift' ? 'KATIM' : 'PELAKSANA',
      isActive: e.status === 'aktif',
      skillLevel: e.skillLevel || 'Senior',
      specialDuty: e.specialDuty,
    }));

  const domainMonthlyAssignments: ShiftAssignment[] = schedules
    .filter((s) => s.date.startsWith(monthPrefix))
    .map((s, idx) => {
      const emp = employees.find((e) => e.id === s.employeeId);
      const st = s.shift === 'pagi' ? 'PAGI' : s.shift === 'siang' ? 'SIANG' : 'LIBUR';
      const assignedIds = (machineAssignments || [])
        .filter((ma) => (ma.nurseId === s.employeeId || (ma as any).employeeId === s.employeeId) && ma.date === s.date)
        .map((ma) => ma.machineId);

      return {
        id: s.id,
        date: s.date,
        nurseId: isNaN(Number(s.employeeId)) ? idx + 1 : Number(s.employeeId),
        nurseName: emp?.name || s.employeeId,
        nursePhone: emp?.phone || '',
        shiftType: st as any,
        assignedMachineIds: assignedIds,
        isLeader: emp?.role === 'kepala_ruangan' || emp?.role === 'pj_shift',
        isWhatsAppSent: false,
        notes: s.note || '',
        specialDuty: emp?.specialDuty || null,
      };
    });

  const baysSet = new Set<string>();
  machines.forEach((m) => {
    if (m.bay) baysSet.add(m.bay);
    else if (m.zone) baysSet.add(m.zone);
  });
  if (baysSet.size === 0) {
    baysSet.add('Bay A (Reguler)');
    baysSet.add('Bay B (Reguler)');
    baysSet.add('Bay C (Isolasi)');
  }

  return {
    monthPrefix,
    domainNurses,
    domainMachines,
    domainMonthlyAssignments,
    bays: Array.from(baysSet),
  };
}

/**
 * Pushes data to Google Sheets via Webhook.
 */
export async function pushToGoogleSheets(
  settings: AppSettings,
  payloadData: SyncPayloadData,
  doctorDuties?: Record<string, DoctorShiftDuty>
): Promise<{ isSuccess: boolean; message: string }> {
  const webhookUrl = (settings?.googleSheetWebhookUrl || '').trim();
  if (!webhookUrl) {
    return {
      isSuccess: false,
      message: 'URL Webhook Google Apps Script belum dikonfigurasi. Buka pengaturan untuk menyetel URL.',
    };
  }

  try {
    const result = await GoogleSheetsService.syncAllToGoogleSheets(
      webhookUrl,
      payloadData.monthPrefix,
      payloadData.domainNurses,
      payloadData.domainMachines,
      payloadData.domainMonthlyAssignments,
      payloadData.bays,
      [],
      doctorDuties
    );
    return {
      isSuccess: result.isSuccess,
      message: result.message,
    };
  } catch (err: any) {
    return {
      isSuccess: false,
      message: 'Gagal mengirim data ke Google Sheets: ' + (err?.message || err),
    };
  }
}

/**
 * Pulls data from Google Sheets (via Webhook or Spreadsheet URL fallback).
 */
export async function pullFromGoogleSheets(
  settings: AppSettings,
  targetMonth: string,
  employees: UserAccount[],
  machines: HDMachine[]
): Promise<{
  isSuccess: boolean;
  message: string;
  assignments: ShiftAssignment[];
  nurses?: Nurse[];
  machines?: Machine[];
}> {
  const webhookUrl = (settings?.googleSheetWebhookUrl || '').trim();
  const spreadsheetUrl = (settings?.googleSpreadsheetIdOrUrl || '').trim();

  // 1. Try pulling via Google Apps Script Webhook
  if (webhookUrl) {
    try {
      const webhookResult = await GoogleSheetsService.fetchDataFromGoogleSheets(webhookUrl, targetMonth);
      if (webhookResult.isSuccess && (webhookResult.assignments?.length || webhookResult.nurses?.length)) {
        return {
          isSuccess: true,
          message: webhookResult.message || `Berhasil menarik data via Webhook (${webhookResult.assignments.length} jadwal).`,
          assignments: webhookResult.assignments,
          nurses: webhookResult.nurses,
          machines: webhookResult.machines,
        };
      }
    } catch (whErr) {
      console.warn('[GoogleSheetsSync] Webhook fetch error, trying spreadsheet URL fallback:', whErr);
    }
  }

  // 2. Fallback: Try pulling via Google Spreadsheet URL (CSV matrix parser)
  if (spreadsheetUrl) {
    try {
      const domainNurses: Nurse[] = employees.map((e, idx) => ({
        id: isNaN(Number(e.id)) ? idx + 1 : Number(e.id),
        name: e.name,
        nip: e.nip,
        phone: e.phone,
        role: e.role === 'kepala_ruangan' ? 'KARU' : e.role === 'pj_shift' ? 'KATIM' : 'PELAKSANA',
        isActive: e.status === 'aktif',
        skillLevel: e.skillLevel || 'Senior',
        specialDuty: e.specialDuty,
      }));

      const domainMachines: Machine[] = machines.map((m, idx) => ({
        id: isNaN(Number(m.id)) ? idx + 1 : Number(m.id),
        code: m.code,
        name: `Mesin ${m.code}`,
        brandModel: (m as any).brandModel || 'HD Unit',
        category: 'REGULER',
        status: 'AKTIF',
        bay: m.bay || 'Bay A',
      }));

      const parseResult = await ScheduleImportService.fetchFromGoogleSheetsUrl(
        spreadsheetUrl,
        targetMonth,
        domainNurses,
        domainMachines,
        true
      );

      if (parseResult.isSuccess && parseResult.assignments.length > 0) {
        return {
          isSuccess: true,
          message: `Berhasil menarik ${parseResult.assignments.length} penugasan jadwal dari Google Spreadsheet!`,
          assignments: parseResult.assignments,
          nurses: parseResult.newNursesCreated,
        };
      } else {
        return {
          isSuccess: false,
          message: parseResult.message || 'Tidak ada jadwal ditemukan di Google Spreadsheet.',
          assignments: [],
        };
      }
    } catch (urlErr: any) {
      return {
        isSuccess: false,
        message: 'Gagal menarik data dari Google Spreadsheet: ' + (urlErr?.message || urlErr),
        assignments: [],
      };
    }
  }

  return {
    isSuccess: false,
    message: 'Belum ada Webhook URL atau Link Spreadsheet yang dikonfigurasi. Silakan isi URL terlebih dahulu.',
    assignments: [],
  };
}

/**
 * Transforms pulled assignments into application schedules and machine assignments.
 */
export function applyPulledDataToApp(
  assignments: ShiftAssignment[],
  targetMonth: string,
  currentSchedules: ShiftSchedule[],
  currentEmployees: UserAccount[],
  currentMachines: HDMachine[],
  currentMachineAssignments: MachineAssignment[]
): {
  updatedSchedules: ShiftSchedule[];
  updatedMachineAssignments: MachineAssignment[];
  updatedEmployees: UserAccount[];
} {
  const employeeMapByName = new Map<string, UserAccount>();
  const employeeMapById = new Map<string, UserAccount>();
  const updatedEmployees = [...currentEmployees];

  currentEmployees.forEach((emp) => {
    employeeMapByName.set(emp.name.toLowerCase().trim(), emp);
    employeeMapById.set(String(emp.id), emp);
  });

  // Convert assignments to ShiftSchedule[]
  const newShiftSchedules: ShiftSchedule[] = [];
  const newMachineAssignments: MachineAssignment[] = [];
  const datesProcessed = new Set<string>();

  assignments.forEach((a) => {
    datesProcessed.add(a.date);
    let foundEmp = employeeMapByName.get(a.nurseName.toLowerCase().trim()) || employeeMapById.get(String(a.nurseId));

    if (!foundEmp) {
      // Auto-register new nurse if not found
      const newEmpId = `emp-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      foundEmp = {
        id: newEmpId,
        username: a.nurseName.toLowerCase().replace(/[^a-z0-9]/g, '') || `nurse${Date.now()}`,
        password: 'password123',
        name: a.nurseName,
        nip: a.notes || `NIP-${Math.floor(100000 + Math.random() * 900000)}`,
        role: a.isLeader ? 'pj_shift' : 'perawat',
        phone: a.nursePhone || '081234567800',
        email: `${a.nurseName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'nurse'}@hospital.id`,
        status: 'aktif',
        createdAt: new Date().toISOString(),
        skillLevel: 'Senior',
        specialDuty: a.specialDuty || undefined,
      };
      updatedEmployees.push(foundEmp);
      employeeMapByName.set(foundEmp.name.toLowerCase().trim(), foundEmp);
      employeeMapById.set(String(foundEmp.id), foundEmp);
    }

    const emp = foundEmp;

    let shiftTypeLower: ShiftType = 'libur';
    const st = String(a.shiftType || '').toLowerCase();
    if (st.includes('pagi') && st.includes('siang')) shiftTypeLower = 'pagi_siang';
    else if (st === 'siang' || st === 's') shiftTypeLower = 'siang';
    else if (st === 'pagi' || st === 'p') shiftTypeLower = 'pagi';
    else if (st === 'cuti' || st === 'c') shiftTypeLower = 'cuti';
    else if (st === 'izin' || st === 'i') shiftTypeLower = 'izin';
    else if (st === 'sakit' || st === 'skt' || st === 'sk') shiftTypeLower = 'sakit';
    else shiftTypeLower = 'libur';

    newShiftSchedules.push({
      id: `${emp.id}_${a.date}`,
      employeeId: emp.id,
      date: a.date,
      shift: shiftTypeLower,
      note: a.notes || (a.specialDuty ? `Tugas: ${a.specialDuty}` : undefined),
    });

    // Machine assignments if any
    if (a.assignedMachineIds && a.assignedMachineIds.length > 0) {
      const shiftSlot: 'pagi' | 'siang' = shiftTypeLower === 'siang' ? 'siang' : 'pagi';
      a.assignedMachineIds.forEach((mId) => {
        const matchingMachine = currentMachines.find(
          (m) => String(m.id) === String(mId) || m.code.toUpperCase() === String(mId).toUpperCase()
        );
        const machineKey = matchingMachine ? matchingMachine.id : String(mId);

        newMachineAssignments.push({
          id: `${emp.id}_${a.date}_${shiftSlot}_${machineKey}`,
          machineId: machineKey,
          nurseId: emp.id,
          date: a.date,
          shift: shiftSlot,
        });
      });
    }
  });

  // Retain schedules outside of the imported month/dates
  const remainingSchedules = currentSchedules.filter((s) => !datesProcessed.has(s.date));
  const remainingMachineAssignments = currentMachineAssignments.filter((ma) => !datesProcessed.has(ma.date));

  return {
    updatedSchedules: [...remainingSchedules, ...newShiftSchedules],
    updatedMachineAssignments: [...remainingMachineAssignments, ...newMachineAssignments],
    updatedEmployees,
  };
}
