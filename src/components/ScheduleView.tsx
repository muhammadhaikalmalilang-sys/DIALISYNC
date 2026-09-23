import React, { useState, useMemo } from 'react';
import { 
  UserAccount, 
  ShiftSchedule, 
  ShiftType, 
  SHIFT_DEFINITIONS,
  SpecialTask,
  SpecialTaskCategory,
  SPECIAL_TASK_DEFINITIONS,
  HDMachine,
  MachineAssignment,
  AppSettings,
  Machine,
  Nurse,
  ShiftAssignment
} from '../types';
import { 
  getDaysInMonth, 
  generateMonthlySchedule,
  sortNursesByShiftScheduleOrder,
  getEffectiveShiftForEmployee,
  getTodayDateString
} from '../utils/scheduler';
import { 
  Calendar as CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  Sparkles, 
  Printer, 
  Filter, 
  Edit3, 
  Check, 
  X, 
  RotateCcw,
  AlertCircle,
  Clock,
  Info,
  UserCheck,
  Stethoscope,
  HeartPulse,
  AlertTriangle,
  Sun,
  Moon,
  Zap,
  CheckCircle2,
  Phone,
  ArrowRight,
  ListFilter,
  FileDown,
  Download,
  Loader2,
  Cpu,
  FileSpreadsheet,
  Share2,
  Send,
  ExternalLink,
  RefreshCw
} from 'lucide-react';
import { exportScheduleToPdf, printScheduleDirectly } from '../utils/pdfExport';
import { storage } from '../utils/storage';
import { ImportScheduleModal } from './ImportScheduleModal';
import { GoogleScriptGuideModal } from './GoogleScriptGuideModal';
import { RegenerateMachineAllocationModal } from './RegenerateMachineAllocationModal';
import { HeadNurseReportModal } from './HeadNurseReportModal';
import { SpecialDutyBadge } from './SpecialDutyBadge';
import { GoogleSheetsService } from '../domain/GoogleSheetsService';

interface ScheduleViewProps {
  currentUser: UserAccount;
  employees: UserAccount[];
  schedules: ShiftSchedule[];
  specialTasks: SpecialTask[];
  onUpdateSchedule: (newSchedules: ShiftSchedule[]) => void;
  machines?: HDMachine[];
  machineAssignments?: MachineAssignment[];
  onUpdateMachineAssignments?: (newAssignments: MachineAssignment[]) => void;
  settings?: AppSettings;
  onUpdateSettings?: (newSettings: AppSettings) => void;
}

export const ScheduleView: React.FC<ScheduleViewProps> = ({
  currentUser,
  employees,
  schedules,
  specialTasks,
  onUpdateSchedule,
  machines = [],
  machineAssignments = [],
  onUpdateMachineAssignments,
  settings,
  onUpdateSettings,
}) => {
  // Current active month (0-indexed: 8 = September 2026)
  const [selectedYear, setSelectedYear] = useState<number>(2026);
  const [selectedMonth, setSelectedMonth] = useState<number>(8); // September

  // Filter state
  const [roleFilter, setRoleFilter] = useState<'all' | 'mine' | 'kepala_ruangan' | 'pj_shift' | 'dokter' | 'perawat'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetScope, setResetScope] = useState<'month' | 'all'>('month');
  const [preserveOverrides, setPreserveOverrides] = useState(true);
  const [editingCell, setEditingCell] = useState<{ 
    employeeId: string; 
    dateStr: string; 
    currentShift: ShiftType; 
    note?: string 
  } | null>(null);

  // New Modals state from reference repo
  const [showImportModal, setShowImportModal] = useState(false);
  const [showGoogleScriptModal, setShowGoogleScriptModal] = useState(false);
  const [showRegenerateAllocationModal, setShowRegenerateAllocationModal] = useState(false);
  const [showHeadNurseReportModal, setShowHeadNurseReportModal] = useState(false);
  const [isSyncingSheets, setIsSyncingSheets] = useState(false);
  const [activeDateForReport, setActiveDateForReport] = useState<string>(() => getTodayDateString());

  // Doctor Scheduling state (Simplified: 1 Doctor per Shift, or 1 Doctor covering 2 Shifts)
  const [selectedDoctorDate, setSelectedDoctorDate] = useState<string>(() => getTodayDateString());
  const [showDoctorMonthlyList, setShowDoctorMonthlyList] = useState<boolean>(false);
  const [showDoctorPatternModal, setShowDoctorPatternModal] = useState<boolean>(false);
  const [doctorPagiPattern, setDoctorPagiPattern] = useState<string>('emp-dr-reza');
  const [doctorSiangPattern, setDoctorSiangPattern] = useState<string>('emp-dr-paramitha');
  const [doctorPatternMode, setDoctorPatternMode] = useState<'fixed' | 'alternating'>('fixed');

  // Print and PDF Export state
  const [showPrintModal, setShowPrintModal] = useState<boolean>(false);
  const [isExportingPdf, setIsExportingPdf] = useState<boolean>(false);

  // Days in selected month
  const days = getDaysInMonth(selectedYear, selectedMonth);

  // Month prefix string: e.g. "2026-09"
  const monthPrefix = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;

  const effectiveSettings = useMemo(() => {
    return settings || storage.getSettings();
  }, [settings]);

  // Domain adapted machines & nurses
  const domainMachines: Machine[] = useMemo(() => {
    return (machines || []).map((m, idx) => ({
      id: isNaN(Number(m.id)) ? idx + 1 : Number(m.id),
      code: m.code,
      name: `Mesin HD ${m.code}`,
      brandModel: (m as any).brandModel || m.model || 'Nipro / Fresenius',
      category: ((m as any).category || 'REGULER') as any,
      status: (m.status === 'siap' || m.status === 'dipakai' || m.status === 'AKTIF') ? 'AKTIF' : (m.status === 'maintenance' || m.status === 'MAINTENANCE') ? 'MAINTENANCE' : 'RUSAK',
      bay: m.bay || m.zone || 'Bay A',
      operationalShift: (m as any).operationalShift || 'ALL',
      notes: m.notes,
    }));
  }, [machines]);

  const domainNurses: Nurse[] = useMemo(() => {
    return employees
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
  }, [employees]);

  // Domain monthly assignments
  const domainMonthlyAssignments: ShiftAssignment[] = useMemo(() => {
    return schedules
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
  }, [schedules, employees, machineAssignments, monthPrefix]);

  // Daily assignments for HeadNurseReportModal
  const currentDailyAssignments: ShiftAssignment[] = useMemo(() => {
    const effectiveDate = days.find((d) => d.dateStr === activeDateForReport)?.dateStr || days[0]?.dateStr || getTodayDateString();

    return schedules
      .filter((s) => s.date === effectiveDate)
      .map((s, idx) => {
        const emp = employees.find((e) => e.id === s.employeeId);
        const st = s.shift === 'pagi' ? 'PAGI' : s.shift === 'siang' ? 'SIANG' : 'LIBUR';
        const assignedIds = (machineAssignments || [])
          .filter((ma) => (ma.nurseId === s.employeeId || (ma as any).employeeId === s.employeeId) && ma.date === effectiveDate)
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
  }, [schedules, employees, machineAssignments, activeDateForReport, days]);

  const handleImportCompleted = (
    importedAssignments: ShiftAssignment[],
    targetMonth: string,
    replaceExisting: boolean = true
  ) => {
    const newShiftSchedules: ShiftSchedule[] = importedAssignments.map((a) => {
      const emp = employees.find(
        (e) => String(e.id) === String(a.nurseId) || e.name.toLowerCase() === a.nurseName.toLowerCase()
      );
      const employeeId = emp ? emp.id : String(a.nurseId);
      let shiftLower: ShiftType = 'pagi';
      const st = (a.shiftType || '').toLowerCase();
      if (st.includes('pagi') && st.includes('siang')) shiftLower = 'pagi_siang';
      else if (st === 'siang') shiftLower = 'siang';
      else if (st === 'pagi') shiftLower = 'pagi';
      else if (st === 'libur') shiftLower = 'libur';
      else if (st === 'cuti') shiftLower = 'cuti';
      else if (st === 'izin') shiftLower = 'izin';
      else if (st === 'sakit') shiftLower = 'sakit';

      return {
        id: `${employeeId}_${a.date}`,
        employeeId,
        date: a.date,
        shift: shiftLower,
        isCustomOverride: true,
      };
    });

    let updatedSchedules = [...schedules];
    if (replaceExisting) {
      updatedSchedules = updatedSchedules.filter((s) => !s.date.startsWith(targetMonth));
    }
    onUpdateSchedule([...updatedSchedules, ...newShiftSchedules]);

    if (onUpdateMachineAssignments) {
      const newMachineAssignments: MachineAssignment[] = [];
      importedAssignments.forEach((a) => {
        if (a.assignedMachineIds && a.assignedMachineIds.length > 0) {
          const emp = employees.find(
            (e) => String(e.id) === String(a.nurseId) || e.name.toLowerCase() === a.nurseName.toLowerCase()
          );
          const employeeId = emp ? emp.id : String(a.nurseId);
          const shiftStr: 'pagi' | 'siang' = (a.shiftType || '').toLowerCase() === 'siang' ? 'siang' : 'pagi';

          a.assignedMachineIds.forEach((mId) => {
            newMachineAssignments.push({
              id: `${employeeId}_${a.date}_${shiftStr}_${mId}`,
              machineId: String(mId),
              nurseId: employeeId,
              date: a.date,
              shift: shiftStr,
            });
          });
        }
      });

      let updatedMA = [...(machineAssignments || [])];
      if (replaceExisting) {
        updatedMA = updatedMA.filter((m) => !m.date.startsWith(targetMonth));
      }
      onUpdateMachineAssignments([...updatedMA, ...newMachineAssignments]);
    }
  };

  const handleReallocationCompleted = (
    updatedAssignments: ShiftAssignment[],
    summaryMessage: string
  ) => {
    if (onUpdateMachineAssignments) {
      const newMachineAssignments: MachineAssignment[] = [];
      updatedAssignments.forEach((a) => {
        if (a.assignedMachineIds && a.assignedMachineIds.length > 0) {
          const emp = employees.find(
            (e) => String(e.id) === String(a.nurseId) || e.name.toLowerCase() === a.nurseName.toLowerCase()
          );
          const employeeId = emp ? emp.id : String(a.nurseId);
          const shiftStr: 'pagi' | 'siang' = (a.shiftType || '').toLowerCase() === 'siang' ? 'siang' : 'pagi';

          a.assignedMachineIds.forEach((mId) => {
            newMachineAssignments.push({
              id: `${employeeId}_${a.date}_${shiftStr}_${mId}`,
              machineId: String(mId),
              nurseId: employeeId,
              date: a.date,
              shift: shiftStr,
            });
          });
        }
      });

      const datesToReplace = new Set(updatedAssignments.map((a) => a.date));
      const remainingMA = (machineAssignments || []).filter((ma) => !datesToReplace.has(ma.date));
      onUpdateMachineAssignments([...remainingMA, ...newMachineAssignments]);
    }
    alert(summaryMessage);
  };

  const handleSyncToGoogleSheets = async () => {
    if (!effectiveSettings?.googleSheetWebhookUrl) {
      setShowGoogleScriptModal(true);
      return;
    }
    setIsSyncingSheets(true);
    try {
      const result = await GoogleSheetsService.syncToGoogleSheets(
        effectiveSettings.googleSheetWebhookUrl,
        monthPrefix,
        domainNurses,
        domainMachines,
        domainMonthlyAssignments
      );
      if (result.isSuccess) {
        alert('Sinkronisasi Google Sheets berhasil! Seluruh data jadwal dan alokasi mesin telah terkirim.');
      } else {
        alert('Gagal sinkron: ' + result.message);
      }
    } catch (e: any) {
      alert('Terjadi kesalahan saat menghubungi Webhook: ' + (e?.message || e));
    } finally {
      setIsSyncingSheets(false);
    }
  };

  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  const handlePrevMonth = () => {
    if (selectedMonth === 0) {
      setSelectedMonth(11);
      setSelectedYear((prev) => prev - 1);
    } else {
      setSelectedMonth((prev) => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (selectedMonth === 11) {
      setSelectedMonth(0);
      setSelectedYear((prev) => prev + 1);
    } else {
      setSelectedMonth((prev) => prev + 1);
    }
  };

  // Filter employees
  const filteredEmployees = employees.filter((emp) => {
    if (emp.status !== 'aktif') return false;
    if (searchQuery && !emp.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (roleFilter === 'mine') return emp.id === currentUser.id;
    if (roleFilter !== 'all') return emp.role === roleFilter;
    return true;
  });

  // Handle Admin Generate Month (Only for Nurses + Karu pagi, Sunday off, Doctor manual)
  const handleGenerateMonth = () => {
    const generated = generateMonthlySchedule(
      selectedYear,
      selectedMonth,
      employees,
      preserveOverrides,
      schedules
    );

    // Merge or replace schedules for this month
    const monthPrefix = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;
    const otherMonthSchedules = schedules.filter((s) => !s.date.startsWith(monthPrefix));
    const merged = [...otherMonthSchedules, ...generated];

    onUpdateSchedule(merged);
    setShowGenerateModal(false);
  };

  // Handle Reset Schedule (Feature: Reset Jadwal -> Mengubah seluruh jadwal perawat menjadi Libur)
  const handleExecuteReset = () => {
    const daysInCurrentMonth = getDaysInMonth(selectedYear, selectedMonth);
    const monthPrefix = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;
    const nurseEmployees = employees.filter((e) => e.role !== 'dokter');

    if (resetScope === 'month') {
      // Pertahankan jadwal dokter pada bulan ini dan seluruh jadwal di bulan lain
      const otherMonthSchedules = schedules.filter((s) => !s.date.startsWith(monthPrefix));
      const doctorSchedulesThisMonth = schedules.filter(
        (s) => s.date.startsWith(monthPrefix) && employees.find((e) => e.id === s.employeeId)?.role === 'dokter'
      );

      // Ubah SEMUA jadwal perawat bulan ini menjadi 'libur'
      const resetLiburSchedules: ShiftSchedule[] = [];
      daysInCurrentMonth.forEach((day) => {
        nurseEmployees.forEach((nurse) => {
          resetLiburSchedules.push({
            id: `${nurse.id}_${day.dateStr}`,
            employeeId: nurse.id,
            date: day.dateStr,
            shift: 'libur',
            note: 'Libur (Reset Jadwal)',
            isCustomOverride: true,
          });
        });
      });

      const updated = [...otherMonthSchedules, ...doctorSchedulesThisMonth, ...resetLiburSchedules];
      onUpdateSchedule(updated);
      alert(`Semua jadwal perawat bulan ${monthNames[selectedMonth]} ${selectedYear} berhasil diubah menjadi Libur (L).`);
    } else {
      // Pertahankan jadwal dokter di semua bulan
      const doctorSchedules = schedules.filter(
        (s) => employees.find((e) => e.id === s.employeeId)?.role === 'dokter'
      );

      // Ubah seluruh jadwal perawat bulan aktif menjadi 'libur'
      const resetLiburSchedules: ShiftSchedule[] = [];
      daysInCurrentMonth.forEach((day) => {
        nurseEmployees.forEach((nurse) => {
          resetLiburSchedules.push({
            id: `${nurse.id}_${day.dateStr}`,
            employeeId: nurse.id,
            date: day.dateStr,
            shift: 'libur',
            note: 'Libur (Reset Jadwal)',
            isCustomOverride: true,
          });
        });
      });

      const updated = [...doctorSchedules, ...resetLiburSchedules];
      onUpdateSchedule(updated);
      alert('Seluruh jadwal perawat berhasil diubah menjadi Libur (L).');
    }
    setShowResetModal(false);
  };

  // 1-CLICK SHIFT CHANGE (Merubah jadwal setiap perawat & dokter hanya dengan 1 kali klik pada matriks)
  const handleCellSingleClick = (
    employeeId: string, 
    dateStr: string, 
    currentEffectiveShift?: ShiftType
  ) => {
    if (!canEdit) return;

    const targetEmp = employees.find((e) => e.id === employeeId);
    const isDoc = targetEmp?.role === 'dokter';

    // Cycle order:
    // Dokter: Pagi -> Siang -> 2 Shif (Pagi & Siang) -> Libur -> Pagi
    // Perawat: Pagi -> Siang -> Libur -> Pagi
    let nextShift: ShiftType = 'pagi';
    if (currentEffectiveShift === 'pagi') {
      nextShift = 'siang';
    } else if (currentEffectiveShift === 'siang') {
      nextShift = isDoc ? 'pagi_siang' : 'libur';
    } else if (currentEffectiveShift === 'pagi_siang') {
      nextShift = 'libur';
    } else if (currentEffectiveShift === 'libur') {
      nextShift = 'pagi';
    } else {
      nextShift = 'pagi';
    }

    const existingIndex = schedules.findIndex(
      (s) => s.employeeId === employeeId && s.date === dateStr
    );

    const updatedItem: ShiftSchedule = {
      id: `${employeeId}_${dateStr}`,
      employeeId,
      date: dateStr,
      shift: nextShift,
      isCustomOverride: true,
    };

    let updatedList: ShiftSchedule[];
    if (existingIndex >= 0) {
      updatedList = [...schedules];
      updatedList[existingIndex] = updatedItem;
    } else {
      updatedList = [...schedules, updatedItem];
    }

    onUpdateSchedule(updatedList);
  };

  // Handle Edit Single Cell (via Right-click or Detail button)
  const handleSaveCellEdit = (newShift: ShiftType, note: string) => {
    if (!editingCell) return;

    const existingIndex = schedules.findIndex(
      (s) => s.employeeId === editingCell.employeeId && s.date === editingCell.dateStr
    );

    const updatedItem: ShiftSchedule = {
      id: `${editingCell.employeeId}_${editingCell.dateStr}`,
      employeeId: editingCell.employeeId,
      date: editingCell.dateStr,
      shift: newShift,
      note: note || undefined,
      isCustomOverride: true,
    };

    let updatedList: ShiftSchedule[];
    if (existingIndex >= 0) {
      updatedList = [...schedules];
      updatedList[existingIndex] = updatedItem;
    } else {
      updatedList = [...schedules, updatedItem];
    }

    onUpdateSchedule(updatedList);
    setEditingCell(null);
  };

  const isAdmin = currentUser.role === 'admin';
  const isKaru = currentUser.role === 'kepala_ruangan';
  const isPjShift = currentUser.role === 'pj_shift';
  const canEdit = isAdmin || isKaru || isPjShift;

  const currentMonthSchedules = schedules.filter((s) => s.date.startsWith(monthPrefix));

  // Separate Perawat (including Karu & PJ Shift) and Dokter, sorted strictly:
  // 1. Kepala ruang, 2. PJ Shif (L), 3. PJ Shif (P), 4. Pelaksana (L), 5. Pelaksana (P)
  const nurseEmployees = sortNursesByShiftScheduleOrder(
    filteredEmployees.filter(
      (emp) => emp.role === 'perawat' || emp.role === 'pj_shift' || emp.role === 'kepala_ruangan'
    )
  );
  const allDoctorEmployees = employees.filter(
    (emp) => emp.role === 'dokter' && (emp.status === 'aktif' || !emp.status)
  );

  const showNurseTable =
    roleFilter === 'all' ||
    roleFilter === 'perawat' ||
    roleFilter === 'pj_shift' ||
    roleFilter === 'kepala_ruangan' ||
    (roleFilter === 'mine' && currentUser.role !== 'dokter');

  const showDoctorSection =
    roleFilter === 'all' ||
    roleFilter === 'dokter' ||
    (roleFilter === 'mine' && currentUser.role === 'dokter');

  const currentDoctorDate = selectedDoctorDate.startsWith(monthPrefix)
    ? selectedDoctorDate
    : (days[0]?.dateStr || `${monthPrefix}-01`);

  const handleAssignDoctor = (dateStr: string, shift: 'pagi' | 'siang', doctorId: string) => {
    let newSchedules = [...schedules];
    const otherShift: 'pagi' | 'siang' = shift === 'pagi' ? 'siang' : 'pagi';

    allDoctorEmployees.forEach((doc) => {
      const existingIdx = newSchedules.findIndex(
        (s) => s.employeeId === doc.id && s.date === dateStr
      );
      const currentSch = existingIdx >= 0 ? newSchedules[existingIdx] : null;

      if (doc.id === doctorId) {
        // Jika dokter ini sebelumnya sudah bertugas di shift satunya (atau sudah 2 shif):
        let targetShift: ShiftType = shift;
        let note = shift === 'pagi' ? 'Dokter Penanggung Jawab HD (Pagi)' : 'Dokter Jaga HD (Siang)';

        if (currentSch?.shift === otherShift || currentSch?.shift === 'pagi_siang') {
          targetShift = 'pagi_siang';
          note = 'Dokter Jaga 2 Shif (Pagi & Siang)';
        }

        const item: ShiftSchedule = {
          id: `${doc.id}_${dateStr}`,
          employeeId: doc.id,
          date: dateStr,
          shift: targetShift,
          note,
          isCustomOverride: true,
        };
        if (existingIdx >= 0) {
          newSchedules[existingIdx] = item;
        } else {
          newSchedules.push(item);
        }
      } else {
        // Jika dokter lain sebelumnya ada di shift ini:
        if (currentSch) {
          if (currentSch.shift === 'pagi_siang') {
            // Turunkan ke shift satunya saja
            newSchedules[existingIdx] = {
              ...currentSch,
              shift: otherShift,
              note: otherShift === 'pagi' ? 'Dokter Penanggung Jawab HD (Pagi)' : 'Dokter Jaga HD (Siang)',
              isCustomOverride: true,
            };
          } else if (currentSch.shift === shift) {
            newSchedules[existingIdx] = {
              ...currentSch,
              shift: 'libur',
              note: 'Lepas Jaga / Libur Dinas',
              isCustomOverride: true,
            };
          }
        }
      }
    });

    // Jika doctorId dikosongkan ("-- Kosongkan / Lepas Jaga --")
    if (!doctorId) {
      allDoctorEmployees.forEach((doc) => {
        const existingIdx = newSchedules.findIndex(
          (s) => s.employeeId === doc.id && s.date === dateStr
        );
        if (existingIdx >= 0) {
          const current = newSchedules[existingIdx];
          if (current.shift === 'pagi_siang') {
            newSchedules[existingIdx] = {
              ...current,
              shift: otherShift,
              note: otherShift === 'pagi' ? 'Dokter Penanggung Jawab HD (Pagi)' : 'Dokter Jaga HD (Siang)',
              isCustomOverride: true,
            };
          } else if (current.shift === shift) {
            newSchedules[existingIdx] = {
              ...current,
              shift: 'libur',
              note: 'Lepas Jaga / Libur Dinas',
              isCustomOverride: true,
            };
          }
        }
      });
    }

    onUpdateSchedule(newSchedules);
  };

  const getDoctorForShiftAndDate = (dateStr: string, shift: 'pagi' | 'siang') => {
    const scheduled = allDoctorEmployees.find((d) => {
      const sch = schedules.find((s) => s.employeeId === d.id && s.date === dateStr);
      return sch?.shift === shift || sch?.shift === 'pagi_siang';
    });
    if (scheduled) return scheduled;

    const dayObj = days.find((d) => d.dateStr === dateStr);
    if (dayObj?.isSunday) return undefined;

    const anyDoctorScheduled = allDoctorEmployees.some((d) => {
      const sch = schedules.find((s) => s.employeeId === d.id && s.date === dateStr);
      return sch && sch.shift !== 'libur';
    });
    if (!anyDoctorScheduled) {
      if (shift === 'pagi') {
        return allDoctorEmployees.find((d) => d.id === 'emp-dr-reza') || allDoctorEmployees[0];
      } else if (shift === 'siang') {
        return allDoctorEmployees.find((d) => d.id === 'emp-dr-paramitha') || allDoctorEmployees[1];
      }
    }

    return undefined;
  };

  const handleApplyMonthlyDoctorPattern = () => {
    let newSchedules = [...schedules];
    days.forEach((day) => {
      if (day.isSunday) {
        allDoctorEmployees.forEach((doc) => {
          const existingIdx = newSchedules.findIndex(
            (s) => s.employeeId === doc.id && s.date === day.dateStr
          );
          const item: ShiftSchedule = {
            id: `${doc.id}_${day.dateStr}`,
            employeeId: doc.id,
            date: day.dateStr,
            shift: 'libur',
            note: 'Libur Rutin Hari Minggu (Unit HD Tutup)',
            isCustomOverride: true,
          };
          if (existingIdx >= 0) {
            newSchedules[existingIdx] = item;
          } else {
            newSchedules.push(item);
          }
        });
        return;
      }

      let pagiDocId = doctorPagiPattern;
      let siangDocId = doctorSiangPattern;

      if (doctorPatternMode === 'alternating' && day.date.getDate() % 2 === 0) {
        pagiDocId = doctorSiangPattern;
        siangDocId = doctorPagiPattern;
      }

      allDoctorEmployees.forEach((doc) => {
        const existingIdx = newSchedules.findIndex(
          (s) => s.employeeId === doc.id && s.date === day.dateStr
        );
        let shift: ShiftType = 'libur';
        let note = 'Lepas Jaga / Libur Dinas';

        if (doc.id === pagiDocId && doc.id === siangDocId) {
          shift = 'pagi_siang';
          note = 'Dokter Jaga 2 Shif (Pagi & Siang)';
        } else if (doc.id === pagiDocId) {
          shift = 'pagi';
          note = 'Dokter Penanggung Jawab HD (Pagi)';
        } else if (doc.id === siangDocId) {
          shift = 'siang';
          note = 'Dokter Jaga HD (Siang)';
        }

        const item: ShiftSchedule = {
          id: `${doc.id}_${day.dateStr}`,
          employeeId: doc.id,
          date: day.dateStr,
          shift,
          note,
          isCustomOverride: true,
        };

        if (existingIdx >= 0) {
          newSchedules[existingIdx] = item;
        } else {
          newSchedules.push(item);
        }
      });
    });

    onUpdateSchedule(newSchedules);
    setShowDoctorPatternModal(false);
  };

  const handleResetMonthDoctors = () => {
    const newSchedules = schedules.filter((s) => {
      const isCurrentMonth = s.date.startsWith(monthPrefix);
      const isDoctor = allDoctorEmployees.some((d) => d.id === s.employeeId);
      return !(isCurrentMonth && isDoctor);
    });
    onUpdateSchedule(newSchedules);
    setShowDoctorPatternModal(false);
  };

  const handleExportPdf = () => {
    try {
      setIsExportingPdf(true);
      const allActiveNurses = sortNursesByShiftScheduleOrder(
        employees.filter(
          (emp) =>
            (emp.role === 'perawat' || emp.role === 'pj_shift' || emp.role === 'kepala_ruangan') &&
            (emp.status === 'aktif' || !emp.status)
        )
      );
      exportScheduleToPdf({
        year: selectedYear,
        month: selectedMonth,
        monthName: monthNames[selectedMonth],
        days,
        nurseStaff: allActiveNurses,
        doctorStaff: allDoctorEmployees,
        schedules,
        allEmployees: employees,
      });
      setShowPrintModal(false);
    } catch (err) {
      console.error('Failed to export schedule to PDF:', err);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleDirectPrint = () => {
    setShowPrintModal(false);
    setTimeout(() => {
      window.print();
    }, 200);
  };

  const renderNurseMatrixTable = (staffList: UserAccount[]) => {
    const isNurse = true;
    const title = 'Jadwal Shift Perawat, PJ Shift & Kepala Ruangan';
    const subtitle = 'Jadwal dinas operasional perawat pelaksana & supervisi Kepala Ruangan unit hemodialisa';
    const countBadge = `${staffList.length} Perawat`;

    // Precalculate per-staff shift counts (Pagi & Siang)
    const staffStats = new Map<string, { pagi: number; siang: number }>();
    staffList.forEach((emp) => {
      let pagi = 0;
      let siang = 0;
      const isDoc = emp.role === 'dokter';
      days.forEach((day) => {
        const sch = schedules.find((s) => s.employeeId === emp.id && s.date === day.dateStr);
        const isSun = day.isSunday;
        const shift = sch
          ? sch.shift
          : isSun
          ? 'libur'
          : isDoc
          ? undefined
          : getEffectiveShiftForEmployee(emp, day.dateStr, schedules, employees);
        if (shift === 'pagi') pagi++;
        else if (shift === 'siang') siang++;
        else if (shift === 'pagi_siang') {
          pagi++;
          siang++;
        }
      });
      staffStats.set(emp.id, { pagi, siang });
    });

    // Precalculate daily shift counts across all staff in this table
    const dailyStats = days.map((day) => {
      let pagi = 0;
      let siang = 0;
      staffList.forEach((emp) => {
        const isDoc = emp.role === 'dokter';
        const sch = schedules.find((s) => s.employeeId === emp.id && s.date === day.dateStr);
        const isSun = day.isSunday;
        const shift = sch
          ? sch.shift
          : isSun
          ? 'libur'
          : isDoc
          ? undefined
          : getEffectiveShiftForEmployee(emp, day.dateStr, schedules, employees);
        if (shift === 'pagi') pagi++;
        else if (shift === 'siang') siang++;
        else if (shift === 'pagi_siang') {
          pagi++;
          siang++;
        }
      });
      return {
        dateStr: day.dateStr,
        date: day.date,
        isSunday: day.isSunday,
        pagi,
        siang,
      };
    });

    let grandTotalPagi = 0;
    let grandTotalSiang = 0;
    dailyStats.forEach((s) => {
      grandTotalPagi += s.pagi;
      grandTotalSiang += s.siang;
    });

    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {/* Table Section Header */}
        <div className={`p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          isNurse ? 'bg-gradient-to-r from-teal-50/80 via-white to-teal-50/30' : 'bg-gradient-to-r from-blue-50/80 via-white to-blue-50/30'
        }`}>
          <div className="flex items-center space-x-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-2xs shrink-0 ${
              isNurse ? 'bg-teal-600 text-white' : 'bg-blue-600 text-white'
            }`}>
              {isNurse ? <HeartPulse className="w-5 h-5" /> : <Stethoscope className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-sm font-bold text-slate-900">{title}</h3>
                <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                  isNurse ? 'bg-teal-100 text-teal-800 border-teal-200' : 'bg-blue-100 text-blue-800 border-blue-200'
                }`}>
                  {countBadge}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
            </div>
          </div>

          <div className="flex items-center space-x-2 self-end sm:self-auto">
            {isNurse && canEdit && (
              <button
                onClick={() => setShowGenerateModal(true)}
                className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold shadow-2xs flex items-center space-x-1.5 transition"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Auto-Generate Perawat</span>
              </button>
            )}
            {!isNurse && (
              <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200 flex items-center gap-1">
                <Edit3 className="w-3.5 h-3.5" />
                <span>Input Manual 1-Klik</span>
              </span>
            )}
          </div>
        </div>

        {/* Matrix Grid */}
        {staffList.length === 0 ? (
          <div className="p-10 text-center">
            <UserCheck className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h4 className="text-sm font-bold text-slate-700">
              {isNurse ? 'Belum ada data perawat untuk ditampilkan' : 'Belum ada data dokter untuk ditampilkan'}
            </h4>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              {isNurse
                ? 'Tambahkan data perawat melalui menu Manajemen Karyawan untuk mulai menyusun jadwal shift.'
                : 'Tambahkan data dokter spesialis atau dokter jaga melalui menu Manajemen Karyawan untuk mengatur dinas jaga.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[540px]">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-20">
                <tr>
                  <th className="p-3 font-bold text-slate-700 bg-slate-100/95 border-r border-slate-200 min-w-[200px] sticky left-0 z-30">
                    Nama {isNurse ? 'Perawat' : 'Dokter'} &amp; Jabatan
                  </th>
                  {days.map((day) => {
                    const isSun = day.isSunday;
                    return (
                      <th
                        key={day.dateStr}
                        className={`p-1.5 text-center border-r border-slate-200 min-w-[52px] ${
                          isSun ? 'bg-rose-50/90 text-rose-900 font-extrabold' : 'text-slate-700 font-semibold'
                        }`}
                      >
                        <div className="text-[9px] uppercase text-slate-400">{day.dayName.substring(0, 3)}</div>
                        <div className={`text-xs ${isSun ? 'text-rose-600 font-extrabold' : 'text-slate-800'}`}>
                          {day.date.getDate()}
                        </div>
                      </th>
                    );
                  })}
                  {/* Kolom Rekap Perawat: Pagi, Siang, dan Perbandingan */}
                  <th className="p-2 text-center bg-emerald-50 text-emerald-950 border-r border-slate-200 min-w-[55px] font-extrabold text-[11px] sticky top-0 z-20" title="Total Shift Pagi Bulan Ini">
                    Pagi (P)
                  </th>
                  <th className="p-2 text-center bg-pink-50 text-pink-950 border-r border-slate-200 min-w-[55px] font-extrabold text-[11px] sticky top-0 z-20" title="Total Shift Siang Bulan Ini">
                    Siang (S)
                  </th>
                  <th className="p-2 text-center bg-teal-50 text-teal-950 border-r border-slate-200 min-w-[85px] font-extrabold text-[11px] sticky top-0 z-20" title="Perbandingan Shift Pagi dan Siang">
                    Pagi : Siang
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {staffList.map((emp) => {
                  const isCurrent = emp.id === currentUser.id;
                  const isKaruRole = emp.role === 'kepala_ruangan';
                  const isPjRole = emp.role === 'pj_shift';
                  const isDoc = emp.role === 'dokter';
                  const stats = staffStats.get(emp.id) || { pagi: 0, siang: 0 };

                  return (
                    <tr
                      key={emp.id}
                      className={`hover:bg-teal-50/20 transition ${
                        isCurrent ? 'bg-teal-50/40' : ''
                      }`}
                    >
                      {/* Fixed Staff Column */}
                      <td className="p-2.5 border-r border-slate-200 bg-white sticky left-0 z-10 font-medium">
                        <div className="flex items-center space-x-2">
                          <div
                            className={`w-7 h-7 rounded-lg font-bold flex items-center justify-center text-[10px] text-white shrink-0 ${
                              isKaruRole
                                ? 'bg-amber-600'
                                : isPjRole
                                ? 'bg-emerald-600'
                                : isDoc
                                ? 'bg-blue-600'
                                : 'bg-teal-600'
                            }`}
                          >
                            {emp.name.substring(0, 2).toUpperCase()}
                          </div>
                          <div className="truncate max-w-[170px]">
                            <div className="font-bold text-slate-800 text-xs truncate flex items-center gap-1">
                              <span>{emp.name}</span>
                              {isCurrent && (
                                <span className="text-[9px] px-1 bg-teal-100 text-teal-800 rounded font-semibold">
                                  Anda
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-400 capitalize truncate flex items-center gap-1 mt-0.5">
                              <span>
                                {emp.role === 'kepala_ruangan'
                                  ? 'Kepala Ruang HD'
                                  : emp.role === 'pj_shift'
                                  ? 'PJ Shift HD'
                                  : emp.role === 'perawat'
                                  ? 'Perawat Pelaksana'
                                  : emp.role === 'dokter'
                                  ? 'Dokter HD'
                                  : emp.role.replace('_', ' ')}
                              </span>
                              {isDoc && emp.specialization && (
                                <span className="text-[9px] font-semibold text-blue-600">({emp.specialization})</span>
                              )}
                              {isDoc && !emp.specialization && (
                                <span className="text-[9px] font-bold text-blue-600">(Manual)</span>
                              )}
                            </div>
                            {emp.specialDuty && (
                              <div className="mt-0.5">
                                <SpecialDutyBadge duty={emp.specialDuty} size="xs" />
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Date Cells */}
                      {days.map((day) => {
                        const sch = schedules.find(
                          (s) => s.employeeId === emp.id && s.date === day.dateStr
                        );
                        const isSun = day.isSunday;
                        let shift = sch ? sch.shift : isSun ? 'libur' : isDoc ? undefined : getEffectiveShiftForEmployee(emp, day.dateStr, schedules, employees);

                        // Check Special Tasks on this date for this employee
                        const specialTasksForEmpToday = specialTasks.filter(
                          (t) => t.assignedToId === emp.id && t.date === day.dateStr
                        );

                        // Filter tasks that belong to this active shift
                        const staffTasksToday = specialTasksForEmpToday.filter((t) => {
                          if (shift === 'pagi' || shift === 'siang') {
                            return !t.shift || t.shift === shift;
                          }
                          return true;
                        });

                        // Category checks for priority coloring
                        const hasCito = staffTasksToday.some((t) => t.category === 'cito');
                        const hasPj = staffTasksToday.some((t) => t.category === 'pj_shift');
                        const hasBhp = staffTasksToday.some((t) => t.category === 'bhp');
                        const hasFarmasi = staffTasksToday.some((t) => t.category === 'farmasi_logistik');
                        const hasNatrium = staffTasksToday.some((t) => t.category === 'natrium_ro');

                        let cellBadge = 'bg-slate-100 text-slate-400 border-slate-200';
                        let letter = '-';
                        let taskDescription = '';

                        // DYNAMIC SHIFT & SPECIAL TASK COLOR ASSIGNMENT
                        if (shift === 'pagi') {
                          letter = 'P';
                          if (hasCito) {
                            cellBadge = 'bg-rose-600 text-white border-rose-700 ring-2 ring-rose-300 animate-pulse font-black shadow-xs';
                            taskDescription = 'Pagi - Tugas Khusus CITO (Merah)';
                          } else if (hasPj) {
                            cellBadge = 'bg-orange-500 text-white border-orange-600 font-black shadow-xs ring-1 ring-orange-300';
                            taskDescription = 'Pagi - Tugas PJ Shift (Orange)';
                          } else if (hasBhp) {
                            cellBadge = 'bg-blue-600 text-white border-blue-700 font-black shadow-xs ring-1 ring-blue-300';
                            taskDescription = 'Pagi - Tugas Khusus BHP (Biru)';
                          } else if (hasFarmasi) {
                            cellBadge = 'bg-purple-600 text-white border-purple-700 font-black shadow-xs ring-1 ring-purple-300';
                            taskDescription = 'Pagi - Tugas Farmasi & Logistik (Ungu)';
                          } else if (hasNatrium) {
                            cellBadge = 'bg-yellow-400 text-slate-900 border-yellow-500 font-black shadow-xs ring-1 ring-yellow-300';
                            taskDescription = 'Pagi - Tugas Natrium RO (Kuning)';
                          } else {
                            cellBadge = 'bg-emerald-600 text-white border-emerald-700 font-black shadow-xs hover:bg-emerald-700';
                            taskDescription = 'Pagi Reguler (Hijau)';
                          }
                        } else if (shift === 'siang') {
                          letter = 'S';
                          if (hasCito) {
                            cellBadge = 'bg-rose-600 text-white border-rose-700 ring-2 ring-rose-300 animate-pulse font-black shadow-xs';
                            taskDescription = 'Siang - Tugas Khusus CITO (Merah)';
                          } else if (hasPj) {
                            cellBadge = 'bg-orange-500 text-white border-orange-600 font-black shadow-xs ring-1 ring-orange-300';
                            taskDescription = 'Siang - Tugas PJ Shift (Orange)';
                          } else if (hasBhp) {
                            cellBadge = 'bg-blue-600 text-white border-blue-700 font-black shadow-xs ring-1 ring-blue-300';
                            taskDescription = 'Siang - Tugas Khusus BHP (Biru)';
                          } else if (hasFarmasi) {
                            cellBadge = 'bg-purple-600 text-white border-purple-700 font-black shadow-xs ring-1 ring-purple-300';
                            taskDescription = 'Siang - Tugas Farmasi & Logistik (Ungu)';
                          } else if (hasNatrium) {
                            cellBadge = 'bg-yellow-400 text-slate-900 border-yellow-500 font-black shadow-xs ring-1 ring-yellow-300';
                            taskDescription = 'Siang - Tugas Natrium RO (Kuning)';
                          } else {
                            cellBadge = 'bg-pink-500 text-white border-pink-600 font-black shadow-xs hover:bg-pink-600';
                            taskDescription = 'Siang Reguler (Pink)';
                          }
                        } else if (shift === 'pagi_siang') {
                          letter = '2S';
                          cellBadge = 'bg-indigo-600 text-white border-indigo-700 font-black shadow-xs ring-1 ring-indigo-300';
                          taskDescription = '2 Shif (Pagi & Siang: 07:00 - 20:30)';
                        } else if (shift === 'libur') {
                          letter = 'L';
                          cellBadge = isSun
                            ? 'bg-rose-100 text-rose-800 border-rose-300 font-extrabold'
                            : 'bg-slate-100 text-slate-600 border-slate-300 font-bold';
                          taskDescription = isSun ? 'Minggu Libur' : 'Libur';
                        } else if (shift === 'cuti') {
                          letter = 'C';
                          cellBadge = 'bg-amber-100 text-amber-900 border-amber-300 font-bold';
                          taskDescription = 'Cuti';
                        } else if (shift === 'izin') {
                          letter = 'I';
                          cellBadge = 'bg-indigo-100 text-indigo-900 border-indigo-300 font-bold';
                          taskDescription = 'Izin';
                        } else if (shift === 'sakit') {
                          letter = 'SK';
                          cellBadge = 'bg-slate-200 text-slate-800 border-slate-300 font-bold';
                          taskDescription = 'Sakit';
                        } else if (isDoc && !sch) {
                          letter = '+';
                          cellBadge = 'bg-slate-50 text-slate-400 border-dashed border-slate-300 font-bold hover:bg-slate-100';
                          taskDescription = 'Klik untuk isi shift Dokter';
                        }

                        return (
                          <td
                            key={day.dateStr}
                            onClick={() => {
                              if (canEdit) {
                                handleCellSingleClick(emp.id, day.dateStr, shift as ShiftType);
                              }
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              if (canEdit) {
                                setEditingCell({
                                  employeeId: emp.id,
                                  dateStr: day.dateStr,
                                  currentShift: (shift as ShiftType) || 'pagi',
                                  note: sch?.note,
                                });
                              }
                            }}
                            className={`p-1 text-center border-r border-slate-100 align-middle select-none transition ${
                              isSun ? 'bg-rose-50/20' : ''
                            } ${canEdit ? 'cursor-pointer hover:bg-teal-100/30' : ''}`}
                            title={`${emp.name} (${day.date.getDate()} ${monthNames[selectedMonth]}): ${taskDescription} | ${canEdit ? 'Klik 1x untuk ganti: Pagi ➜ Siang ➜ Libur (Klik kanan untuk opsi Cuti/Izin)' : ''}`}
                          >
                            <div className="flex flex-col items-center justify-center space-y-1 min-h-[38px] py-0.5">
                              <div
                                className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs border ${cellBadge} transition-all shadow-2xs relative hover:scale-105 active:scale-95`}
                              >
                                <span className="font-black leading-none">{letter}</span>
                                {sch?.isCustomOverride && (
                                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-400 rounded-full border border-white" title="Jadwal manual"></span>
                                )}
                              </div>

                              {staffTasksToday.length > 1 && (
                                <div className="flex flex-wrap items-center justify-center gap-0.5 max-w-[48px]">
                                  {staffTasksToday.map((task) => {
                                    const def = SPECIAL_TASK_DEFINITIONS[task.category];
                                    if (!def) return null;
                                    return (
                                      <span
                                        key={task.id}
                                        className={`px-1 py-0.2 rounded text-[7px] font-black text-white leading-tight ${def.badgeBg}`}
                                        title={def.name}
                                      >
                                        {def.shortCode}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      })}

                      {/* Right summary cells for this staff: Pagi, Siang, Ratio */}
                      <td className="p-2 text-center border-r border-slate-200 font-extrabold text-xs text-emerald-800 bg-emerald-50/30">
                        {stats.pagi}
                      </td>
                      <td className="p-2 text-center border-r border-slate-200 font-extrabold text-xs text-pink-800 bg-pink-50/30">
                        {stats.siang}
                      </td>
                      <td className="p-2 text-center border-r border-slate-200 bg-slate-50/40">
                        <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-md bg-white font-black text-slate-900 text-[11px] border border-slate-300 shadow-2xs">
                          {stats.pagi} : {stats.siang}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>

              {/* Rekapitulasi Total & Perbandingan Shift di Kolom Bawah Tabel */}
              <tfoot className="border-t-2 border-slate-300">
                {/* BARIS REKAP 1: TOTAL SHIFT PAGI HARIAN */}
                <tr className="border-b border-slate-200 bg-emerald-50/70">
                  <td className="p-2.5 font-bold text-emerald-950 bg-emerald-100 border-r border-slate-200 sticky left-0 z-10 text-xs shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span>Total Shift Pagi (P)</span>
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 shrink-0 ml-1"></span>
                    </div>
                  </td>
                  {dailyStats.map((stat) => (
                    <td
                      key={`pagi-${stat.dateStr}`}
                      className={`p-1 text-center border-r border-slate-200 font-extrabold text-xs ${
                        stat.isSunday ? 'text-slate-400 bg-rose-50/40' : 'text-emerald-800 bg-emerald-50/80'
                      }`}
                    >
                      {stat.isSunday ? '-' : stat.pagi}
                    </td>
                  ))}
                  <td className="p-2 text-center font-black text-xs text-emerald-950 bg-emerald-100 border-r border-slate-200">
                    {grandTotalPagi}
                  </td>
                  <td className="p-2 text-center font-semibold text-xs text-slate-400 bg-slate-50 border-r border-slate-200">
                    -
                  </td>
                  <td className="p-2 text-center font-bold text-[10px] text-emerald-900 bg-emerald-100/60 border-r border-slate-200">
                    Total Pagi
                  </td>
                </tr>

                {/* BARIS REKAP 2: TOTAL SHIFT SIANG HARIAN */}
                <tr className="border-b border-slate-200 bg-pink-50/70">
                  <td className="p-2.5 font-bold text-pink-950 bg-pink-100 border-r border-slate-200 sticky left-0 z-10 text-xs shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span>Total Shift Siang (S)</span>
                      <span className="w-2.5 h-2.5 rounded-full bg-pink-500 shrink-0 ml-1"></span>
                    </div>
                  </td>
                  {dailyStats.map((stat) => (
                    <td
                      key={`siang-${stat.dateStr}`}
                      className={`p-1 text-center border-r border-slate-200 font-extrabold text-xs ${
                        stat.isSunday ? 'text-slate-400 bg-rose-50/40' : 'text-pink-800 bg-pink-50/80'
                      }`}
                    >
                      {stat.isSunday ? '-' : stat.siang}
                    </td>
                  ))}
                  <td className="p-2 text-center font-semibold text-xs text-slate-400 bg-slate-50 border-r border-slate-200">
                    -
                  </td>
                  <td className="p-2 text-center font-black text-xs text-pink-950 bg-pink-100 border-r border-slate-200">
                    {grandTotalSiang}
                  </td>
                  <td className="p-2 text-center font-bold text-[10px] text-pink-900 bg-pink-100/60 border-r border-slate-200">
                    Total Siang
                  </td>
                </tr>

                {/* BARIS REKAP 3: PERBANDINGAN HARIAN (PAGI : SIANG) */}
                <tr className="bg-teal-100/70">
                  <td className="p-2.5 font-black text-teal-950 bg-teal-200 border-r border-slate-200 sticky left-0 z-10 text-xs shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span>Perbandingan Harian (P : S)</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-teal-800 text-white font-bold ml-1">Rasio</span>
                    </div>
                  </td>
                  {dailyStats.map((stat) => (
                    <td
                      key={`ratio-${stat.dateStr}`}
                      className={`p-1 text-center border-r border-slate-200 ${
                        stat.isSunday ? 'bg-rose-50/40 text-slate-400' : 'bg-teal-50/90'
                      }`}
                    >
                      {stat.isSunday ? (
                        <span className="text-[10px] text-slate-400 font-semibold">-</span>
                      ) : (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-black bg-white text-slate-900 border border-teal-300 shadow-2xs">
                          {stat.pagi} : {stat.siang}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="p-2 text-center font-extrabold text-xs text-emerald-950 bg-emerald-100 border-r border-slate-200">
                    {grandTotalPagi}
                  </td>
                  <td className="p-2 text-center font-extrabold text-xs text-pink-950 bg-pink-100 border-r border-slate-200">
                    {grandTotalSiang}
                  </td>
                  <td className="p-2 text-center bg-teal-200 border-r border-slate-200">
                    <span className="px-2 py-0.5 rounded bg-teal-950 text-white font-black text-[11px] shadow-2xs whitespace-nowrap">
                      {grandTotalPagi} : {grandTotalSiang}
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    );
  };

  const renderDoctorScheduleManager = () => {
    const currentDocDateObj = days.find((d) => d.dateStr === currentDoctorDate) || days[0];
    const isSun = currentDocDateObj?.isSunday || false;

    const assignedPagi = getDoctorForShiftAndDate(currentDoctorDate, 'pagi');
    const assignedSiang = getDoctorForShiftAndDate(currentDoctorDate, 'siang');

    // Indonesian formatted date
    const dateParts = currentDoctorDate.split('-');
    const dateObj = new Date(parseInt(dateParts[0]), parseInt(dateParts[1]) - 1, parseInt(dateParts[2]));
    const dayNamesId = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const formattedDocDate = `${dayNamesId[dateObj.getDay()]}, ${dateObj.getDate()} ${monthNames[dateObj.getMonth()]} ${dateObj.getFullYear()}`;

    // Previous & Next Day Navigation within the month
    const currentIndex = days.findIndex((d) => d.dateStr === currentDoctorDate);
    const prevDay = currentIndex > 0 ? days[currentIndex - 1].dateStr : null;
    const nextDay = currentIndex < days.length - 1 ? days[currentIndex + 1].dateStr : null;

    // Doctor stats for this month
    const docMonthlyStats = allDoctorEmployees.map((doc) => {
      let pagiCount = 0;
      let siangCount = 0;
      days.forEach((d) => {
        if (d.isSunday) return;
        const pDoc = getDoctorForShiftAndDate(d.dateStr, 'pagi');
        const sDoc = getDoctorForShiftAndDate(d.dateStr, 'siang');
        if (pDoc?.id === doc.id) pagiCount++;
        if (sDoc?.id === doc.id) siangCount++;
      });
      return {
        doc,
        pagiCount,
        siangCount,
        total: pagiCount + siangCount,
      };
    });

    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {/* Header Card Dokter Jaga */}
        <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-sky-800 p-4 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-white/15 text-white backdrop-blur-xs shrink-0">
              <Stethoscope className="w-5 h-5 text-sky-200" />
            </div>
            <div>
              <div className="flex items-center space-x-2 flex-wrap">
                <h3 className="font-extrabold text-base tracking-tight">Penugasan Dokter Jaga Hemodialisa</h3>
                <span className="text-[11px] px-2 py-0.5 rounded-md bg-white/20 font-bold text-sky-100">
                  1 Dokter per Shif
                </span>
                <span className="text-xs px-2 py-0.5 rounded-md bg-sky-950/40 font-semibold text-sky-200">
                  {monthNames[selectedMonth]} {selectedYear}
                </span>
              </div>
              <p className="text-xs text-sky-100/90 mt-0.5">
                Setiap shif hanya bertugas 1 orang dokter (Pagi &amp; Siang). Input jadwal jauh lebih mudah, cepat, dan rapi tanpa tabel matriks panjang.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            {canEdit && (
              <button
                onClick={() => setShowDoctorPatternModal(true)}
                className="px-3 py-1.5 bg-white/15 hover:bg-white/25 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer backdrop-blur-xs min-h-[32px]"
                title="Atur pola jadwal dokter sebulan sekaligus"
              >
                <Zap className="w-3.5 h-3.5 text-amber-300" />
                <span>Pola Cepat 1 Bulan</span>
              </button>
            )}
            <button
              onClick={() => setShowDoctorMonthlyList(!showDoctorMonthlyList)}
              className="px-3 py-1.5 bg-white/15 hover:bg-white/25 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer backdrop-blur-xs min-h-[32px]"
              title="Lihat jadwal seluruh tanggal dalam bulan ini"
            >
              <ListFilter className="w-3.5 h-3.5 text-sky-200" />
              <span>{showDoctorMonthlyList ? 'Tutup Daftar Sebulan' : 'Lihat / Edit Sebulan'}</span>
            </button>
          </div>
        </div>

        {/* Bar Navigasi Tanggal Operasional */}
        <div className="bg-slate-50/90 p-3 sm:p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center space-x-2 flex-wrap gap-y-2">
            <span className="text-xs font-bold text-slate-700">Pilih Tanggal:</span>
            <button
              onClick={() => prevDay && setSelectedDoctorDate(prevDay)}
              disabled={!prevDay}
              className={`p-1.5 rounded-lg border text-xs font-bold transition flex items-center justify-center ${
                prevDay
                  ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100 cursor-pointer shadow-2xs'
                  : 'bg-slate-100 border-slate-200 text-slate-300 cursor-not-allowed'
              }`}
              title="Hari Sebelumnya"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <input
              type="date"
              value={currentDoctorDate}
              min={days[0]?.dateStr}
              max={days[days.length - 1]?.dateStr}
              onChange={(e) => e.target.value && setSelectedDoctorDate(e.target.value)}
              className="px-2.5 py-1 text-xs font-bold bg-white border border-slate-300 rounded-lg text-slate-800 shadow-2xs focus:ring-2 focus:ring-blue-500 focus:outline-hidden cursor-pointer"
            />

            <button
              onClick={() => nextDay && setSelectedDoctorDate(nextDay)}
              disabled={!nextDay}
              className={`p-1.5 rounded-lg border text-xs font-bold transition flex items-center justify-center ${
                nextDay
                  ? 'bg-white border-slate-300 text-slate-700 hover:bg-slate-100 cursor-pointer shadow-2xs'
                  : 'bg-slate-100 border-slate-200 text-slate-300 cursor-not-allowed'
              }`}
              title="Hari Berikutnya"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            {/* Quick Button Today */}
            <button
              onClick={() => {
                const todayStr = getTodayDateString();
                if (days.some((d) => d.dateStr === todayStr)) {
                  setSelectedDoctorDate(todayStr);
                } else if (days.length > 0) {
                  setSelectedDoctorDate(days[0].dateStr);
                }
              }}
              className="px-2.5 py-1 text-xs font-bold bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg transition shadow-2xs cursor-pointer"
            >
              Hari Ini
            </button>

            <span className="text-xs font-extrabold text-slate-900 bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs">
              {formattedDocDate}
            </span>
          </div>

          {/* Quick Doctor Summary Badges */}
          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
            {docMonthlyStats.map((item) => (
              <span
                key={item.doc.id}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-white border border-slate-200 font-semibold text-slate-700 shadow-2xs"
                title={`${item.doc.name}: ${item.pagiCount} Pagi, ${item.siangCount} Siang`}
              >
                <span className="font-bold text-slate-900">{item.doc.nickname || item.doc.name.split(',')[0]}</span>: {item.total} Shif ({item.pagiCount}P / {item.siangCount}S)
              </span>
            ))}
          </div>
        </div>

        {/* Input & Tampilan Dokter Jaga Tanggal Terpilih */}
        <div className="p-4 sm:p-5">
          {isSun ? (
            <div className="py-8 px-4 text-center rounded-2xl bg-amber-50/80 border border-amber-200">
              <div className="flex flex-col items-center justify-center space-y-1.5">
                <AlertTriangle className="w-8 h-8 text-amber-600 mb-1" />
                <span className="font-extrabold text-slate-900 text-base">Unit Hemodialisa Libur Rutin Hari Minggu</span>
                <span className="text-xs text-slate-600 max-w-md">
                  Pelayanan hemodialisa rutin ditutup pada hari Minggu dan seluruh staf dokter dinas lepas rutin. Silakan pilih hari Senin sampai Sabtu untuk mengatur dokter jaga.
                </span>
                {nextDay && (
                  <button
                    onClick={() => setSelectedDoctorDate(nextDay)}
                    className="mt-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold transition shadow-2xs cursor-pointer flex items-center space-x-1"
                  >
                    <span>Lanjut ke Hari Berikutnya</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {assignedPagi && assignedSiang && assignedPagi.id === assignedSiang.id && (
                <div className="md:col-span-2 p-3 bg-indigo-50 border border-indigo-200 rounded-xl flex items-center justify-between text-xs text-indigo-900 shadow-2xs">
                  <div className="flex items-center space-x-2">
                    <span className="px-2 py-0.5 rounded-md bg-indigo-600 text-white font-extrabold text-[10px]">
                      2 SHIF SEKALIGUS
                    </span>
                    <span className="font-bold">
                      {assignedPagi.name} bertugas 2 shif penuh hari ini (Shif Pagi dan Siang).
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold text-indigo-700">07:00 - 20:30 WIB</span>
                </div>
              )}
              {/* KARTU DOKTER SHIF PAGI (07:00 - 14:00) */}
              <div className="rounded-2xl border-2 border-emerald-300 bg-gradient-to-b from-emerald-50/60 to-white p-4 sm:p-5 flex flex-col justify-between space-y-4 shadow-xs transition hover:border-emerald-400">
                <div>
                  <div className="flex items-center justify-between gap-2 pb-3 border-b border-emerald-200/80">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow-2xs">
                        <Sun className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-extrabold text-emerald-950 uppercase tracking-wide">
                          Dokter Jaga Shif Pagi
                        </h4>
                        <span className="text-xs text-emerald-700 font-semibold">07:00 - 14:00 WIB</span>
                      </div>
                    </div>
                    <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-bold border border-emerald-300 shadow-2xs">
                      1 Dokter Bertugas
                    </span>
                  </div>

                  {/* Form Penginputan / Penggantian Dokter Pagi */}
                  {canEdit && (
                    <div className="mt-3.5 bg-white p-3 rounded-xl border border-emerald-200 shadow-2xs">
                      <label className="text-xs font-bold text-emerald-950 block mb-1.5">
                        Tugaskan Dokter Shif Pagi:
                      </label>
                      <select
                        value={assignedPagi?.id || ''}
                        onChange={(e) => handleAssignDoctor(currentDoctorDate, 'pagi', e.target.value)}
                        className="w-full text-xs font-bold px-3 py-2 rounded-lg border border-emerald-300 bg-emerald-50/30 text-slate-800 shadow-2xs focus:ring-2 focus:ring-emerald-500 focus:outline-hidden cursor-pointer"
                      >
                        <option value="">-- Kosongkan / Lepas Jaga --</option>
                        {allDoctorEmployees.map((doc) => (
                          <option key={doc.id} value={doc.id}>
                            {doc.name} {doc.nickname ? `(${doc.nickname})` : ''} - {doc.specialization || 'Dokter'}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Info Dokter Terpilih */}
                  <div className="mt-4 p-3.5 rounded-xl bg-white border border-emerald-100 shadow-xs flex items-start space-x-3.5">
                    <div className="w-12 h-12 rounded-xl bg-emerald-600 text-white font-black text-base flex items-center justify-center shrink-0 shadow-xs">
                      dr
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
                        Dokter yang Bertugas Hari Ini:
                      </div>
                      <div className="font-extrabold text-slate-900 text-base leading-tight mt-0.5">
                        {assignedPagi ? assignedPagi.name : (
                          <span className="text-slate-400 italic">Belum ditentukan</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-600 font-medium mt-0.5">
                        {assignedPagi?.specialization || 'Dokter Penanggung Jawab Pelayanan HD (DPJP)'}
                      </div>

                      {assignedPagi && (
                        <div className="flex items-center gap-3 mt-2 flex-wrap">
                          {assignedPagi.nip && (
                            <span className="text-[11px] text-slate-500 font-mono">
                              NIP: {assignedPagi.nip}
                            </span>
                          )}
                          {assignedPagi.phone && (
                            <a
                              href={`https://wa.me/${assignedPagi.phone.replace(/[^0-9]/g, '').replace(/^0/, '62')}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center space-x-1.5 text-xs text-emerald-700 hover:text-emerald-800 font-bold hover:underline"
                            >
                              <Phone className="w-3.5 h-3.5 text-emerald-600" />
                              <span>{assignedPagi.phone}</span>
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-emerald-800/90 font-medium flex items-center space-x-1.5 bg-emerald-100/50 p-2 rounded-lg">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Sistem otomatis memastikan hanya ada 1 dokter pada shif ini.</span>
                </div>
              </div>

              {/* KARTU DOKTER SHIF SIANG (13:30 - 20:30) */}
              <div className="rounded-2xl border-2 border-sky-300 bg-gradient-to-b from-sky-50/60 to-white p-4 sm:p-5 flex flex-col justify-between space-y-4 shadow-xs transition hover:border-sky-400">
                <div>
                  <div className="flex items-center justify-between gap-2 pb-3 border-b border-sky-200/80">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-9 h-9 rounded-xl bg-sky-600 text-white flex items-center justify-center font-bold text-sm shadow-2xs">
                        <Moon className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-extrabold text-sky-950 uppercase tracking-wide">
                          Dokter Jaga Shif Siang
                        </h4>
                        <span className="text-xs text-sky-700 font-semibold">13:30 - 20:30 WIB</span>
                      </div>
                    </div>
                    <span className="text-[11px] px-2.5 py-1 rounded-full bg-sky-100 text-sky-800 font-bold border border-sky-300 shadow-2xs">
                      1 Dokter Bertugas
                    </span>
                  </div>

                  {/* Form Penginputan / Penggantian Dokter Siang */}
                  {canEdit && (
                    <div className="mt-3.5 bg-white p-3 rounded-xl border border-sky-200 shadow-2xs">
                      <label className="text-xs font-bold text-sky-950 block mb-1.5">
                        Tugaskan Dokter Shif Siang:
                      </label>
                      <select
                        value={assignedSiang?.id || ''}
                        onChange={(e) => handleAssignDoctor(currentDoctorDate, 'siang', e.target.value)}
                        className="w-full text-xs font-bold px-3 py-2 rounded-lg border border-sky-300 bg-sky-50/30 text-slate-800 shadow-2xs focus:ring-2 focus:ring-sky-500 focus:outline-hidden cursor-pointer"
                      >
                        <option value="">-- Kosongkan / Lepas Jaga --</option>
                        {allDoctorEmployees.map((doc) => (
                          <option key={doc.id} value={doc.id}>
                            {doc.name} {doc.nickname ? `(${doc.nickname})` : ''} - {doc.specialization || 'Dokter'}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Info Dokter Terpilih */}
                  <div className="mt-4 p-3.5 rounded-xl bg-white border border-sky-100 shadow-xs flex items-start space-x-3.5">
                    <div className="w-12 h-12 rounded-xl bg-sky-600 text-white font-black text-base flex items-center justify-center shrink-0 shadow-xs">
                      dr
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-sky-700 uppercase tracking-wider">
                        Dokter yang Bertugas Hari Ini:
                      </div>
                      <div className="font-extrabold text-slate-900 text-base leading-tight mt-0.5">
                        {assignedSiang ? assignedSiang.name : (
                          <span className="text-slate-400 italic">Belum ditentukan</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-600 font-medium mt-0.5">
                        {assignedSiang?.specialization || 'Dokter Jaga Hemodialisa (Siang)'}
                      </div>

                      {assignedSiang && (
                        <div className="flex items-center gap-3 mt-2 flex-wrap">
                          {assignedSiang.nip && (
                            <span className="text-[11px] text-slate-500 font-mono">
                              NIP: {assignedSiang.nip}
                            </span>
                          )}
                          {assignedSiang.phone && (
                            <a
                              href={`https://wa.me/${assignedSiang.phone.replace(/[^0-9]/g, '').replace(/^0/, '62')}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center space-x-1.5 text-xs text-sky-700 hover:text-sky-800 font-bold hover:underline"
                            >
                              <Phone className="w-3.5 h-3.5 text-sky-600" />
                              <span>{assignedSiang.phone}</span>
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-sky-800/90 font-medium flex items-center space-x-1.5 bg-sky-100/50 p-2 rounded-lg">
                  <CheckCircle2 className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                  <span>Sistem otomatis memastikan hanya ada 1 dokter pada shif ini.</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* DAFTAR LENGKAP SEBULAN (EXPANDABLE) */}
        {showDoctorMonthlyList && (
          <div className="border-t border-slate-200 p-4 sm:p-5 bg-slate-50/50">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="font-bold text-slate-900 text-sm">
                  Daftar Penugasan Dokter Sebulan ({monthNames[selectedMonth]} {selectedYear})
                </h4>
                <p className="text-xs text-slate-500">
                  Ubah dokter untuk tanggal mana pun secara langsung melalui pilihan dropdown di bawah.
                </p>
              </div>
              <button
                onClick={() => setShowDoctorMonthlyList(false)}
                className="text-xs text-slate-500 hover:text-slate-800 font-bold underline cursor-pointer"
              >
                Tutup Daftar
              </button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs max-h-[420px]">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-100 border-b border-slate-200 text-slate-700 font-bold uppercase text-[11px] z-10">
                  <tr>
                    <th className="py-2.5 px-3 w-12 text-center">No</th>
                    <th className="py-2.5 px-3 min-w-[150px]">Tanggal &amp; Hari</th>
                    <th className="py-2.5 px-3 min-w-[240px]">🌅 Dokter Shif Pagi (1 Dokter)</th>
                    <th className="py-2.5 px-3 min-w-[240px]">🌙 Dokter Shif Siang (1 Dokter)</th>
                    <th className="py-2.5 px-3 w-28 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {days.map((day, idx) => {
                    const isSunDay = day.isSunday;
                    const docP = getDoctorForShiftAndDate(day.dateStr, 'pagi');
                    const docS = getDoctorForShiftAndDate(day.dateStr, 'siang');
                    const isSelectedDay = day.dateStr === currentDoctorDate;

                    return (
                      <tr
                        key={day.dateStr}
                        className={`transition hover:bg-slate-50 ${
                          isSelectedDay ? 'bg-blue-50/60 font-bold' : isSunDay ? 'bg-rose-50/30' : ''
                        }`}
                      >
                        <td className="py-2.5 px-3 text-center text-slate-400 font-mono">
                          {idx + 1}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center space-x-2">
                            <span
                              className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold ${
                                isSunDay
                                  ? 'bg-rose-100 text-rose-700'
                                  : isSelectedDay
                                  ? 'bg-blue-600 text-white shadow-2xs'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {day.date.getDate()}
                            </span>
                            <div>
                              <span className={`font-bold ${isSunDay ? 'text-rose-700' : 'text-slate-900'}`}>
                                {day.dayName}
                              </span>
                              <span className="text-[10px] text-slate-400 block font-mono">
                                {day.dateStr}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Dropdown Dokter Pagi */}
                        <td className="py-2.5 px-3">
                          {isSunDay ? (
                            <span className="text-[11px] font-semibold text-rose-600 italic">
                              Libur Rutin HD (Minggu)
                            </span>
                          ) : canEdit ? (
                            <select
                              value={docP?.id || ''}
                              onChange={(e) => handleAssignDoctor(day.dateStr, 'pagi', e.target.value)}
                              className="w-full text-xs font-semibold px-2 py-1 rounded-md border border-emerald-200 bg-emerald-50/40 text-slate-800 shadow-2xs focus:ring-1 focus:ring-emerald-500 focus:outline-hidden cursor-pointer"
                            >
                              <option value="">-- Kosongkan --</option>
                              {allDoctorEmployees.map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.name} {d.nickname ? `(${d.nickname})` : ''}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="font-bold text-slate-800 text-xs">
                              {docP ? docP.name : '-'}
                            </span>
                          )}
                        </td>

                        {/* Dropdown Dokter Siang */}
                        <td className="py-2.5 px-3">
                          {isSunDay ? (
                            <span className="text-[11px] font-semibold text-rose-600 italic">
                              Libur Rutin HD (Minggu)
                            </span>
                          ) : canEdit ? (
                            <select
                              value={docS?.id || ''}
                              onChange={(e) => handleAssignDoctor(day.dateStr, 'siang', e.target.value)}
                              className="w-full text-xs font-semibold px-2 py-1 rounded-md border border-sky-200 bg-sky-50/40 text-slate-800 shadow-2xs focus:ring-1 focus:ring-sky-500 focus:outline-hidden cursor-pointer"
                            >
                              <option value="">-- Kosongkan --</option>
                              {allDoctorEmployees.map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.name} {d.nickname ? `(${d.nickname})` : ''}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="font-bold text-slate-800 text-xs">
                              {docS ? docS.name : '-'}
                            </span>
                          )}
                        </td>

                        {/* Tombol Pilih Hari */}
                        <td className="py-2.5 px-3 text-center">
                          <button
                            onClick={() => setSelectedDoctorDate(day.dateStr)}
                            className={`px-2 py-1 text-[11px] font-bold rounded-md transition cursor-pointer ${
                              isSelectedDay
                                ? 'bg-blue-600 text-white'
                                : 'bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700'
                            }`}
                          >
                            {isSelectedDay ? 'Dipilih' : 'Pilih Hari'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* KOP SURAT KHUSUS OUTPUT PRINT LANGSUNG BROWSER */}
      <div className="hidden print:block mb-6 text-center border-b-2 border-slate-900 pb-3">
        <h1 className="text-base font-black tracking-wide text-slate-950 uppercase">
          RUMAH SAKIT UMUM DAERAH - INSTALASI HEMODIALISA
        </h1>
        <h2 className="text-xs font-bold text-slate-800">
          JADWAL DINAS SHIFT OPERASIONAL PERAWAT &amp; DOKTER JAGA HD
        </h2>
        <p className="text-[11px] font-semibold text-slate-600 mt-0.5">
          Periode: {monthNames[selectedMonth]} {selectedYear} | Unit Hemodialisa
        </p>
      </div>

      {/* Top Header & Actions */}
      <div className="bg-gradient-to-r from-teal-50/90 via-teal-50/40 to-teal-100/50 rounded-2xl p-4 sm:p-5 border border-teal-200/80 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4">
        <div>
          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
            <h2 className="text-base sm:text-lg font-extrabold text-slate-900">
              Jadwal Shift Bulanan Unit Hemodialisa
            </h2>
            <span className="text-[11px] sm:text-xs px-2.5 py-0.5 rounded-full bg-teal-100 text-teal-800 font-semibold border border-teal-200">
              Shift Pagi &amp; Siang
            </span>
          </div>
          <p className="text-xs text-slate-600 mt-1 leading-relaxed">
            Dilengkapi <strong>Mode 1-Klik Langsung</strong> ubah shift dan <strong>Warna Khusus Tombol Shift</strong> sesuai penugasan tugas khusus perawat.
          </p>
        </div>

        {/* Month Selector & Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Month Navigator */}
          <div className="flex items-center bg-white/90 rounded-xl p-1 border border-teal-200/80 shadow-2xs">
            <button
              onClick={handlePrevMonth}
              className="p-1.5 hover:bg-teal-50 rounded-lg text-teal-800 transition min-w-[32px] min-h-[32px] flex items-center justify-center cursor-pointer"
              title="Bulan Sebelumnya"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="px-2 sm:px-3 text-xs font-bold text-slate-800 min-w-[120px] sm:min-w-[140px] text-center flex items-center justify-center gap-1">
              <CalendarIcon className="w-3.5 h-3.5 text-teal-600 shrink-0" />
              <span className="truncate">
                {monthNames[selectedMonth]} {selectedYear}
              </span>
            </div>
            <button
              onClick={handleNextMonth}
              className="p-1.5 hover:bg-teal-50 rounded-lg text-teal-800 transition min-w-[32px] min-h-[32px] flex items-center justify-center cursor-pointer"
              title="Bulan Berikutnya"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Feature: Reset Jadwal Button */}
          {canEdit && (
            <button
              onClick={() => setShowResetModal(true)}
              className="px-3 py-2 bg-white/90 border border-rose-200 hover:bg-rose-50 text-rose-700 rounded-xl text-xs font-bold shadow-2xs flex items-center space-x-1.5 transition min-h-[36px] active:scale-95 cursor-pointer"
              title="Reset Jadwal Shift"
            >
              <RotateCcw className="w-3.5 h-3.5 text-rose-600 shrink-0" />
              <span>Reset</span>
            </button>
          )}

          {/* Admin Generate Button (Khusus Perawat) */}
          {canEdit && (
            <button
              onClick={() => setShowGenerateModal(true)}
              className="px-3.5 py-2 bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center space-x-1.5 transition min-h-[36px] active:scale-95 cursor-pointer"
            >
              <Sparkles className="w-4 h-4 shrink-0" />
              <span>Generate Jadwal</span>
            </button>
          )}

          {/* Atur Alokasi Mesin Button */}
          {canEdit && (
            <button
              onClick={() => setShowRegenerateAllocationModal(true)}
              className="px-3 py-2 bg-white/95 border border-indigo-200 hover:bg-indigo-50 text-indigo-800 rounded-xl text-xs font-bold shadow-2xs flex items-center space-x-1.5 transition min-h-[36px] active:scale-95 cursor-pointer"
              title="Atur & Optimalkan Alokasi Mesin HD (Pagi / Siang / Sebulan)"
            >
              <Cpu className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span>Atur Mesin</span>
            </button>
          )}

          {/* Import Jadwal Button */}
          {canEdit && (
            <button
              onClick={() => setShowImportModal(true)}
              className="px-3 py-2 bg-white/95 border border-emerald-300 hover:bg-emerald-50 text-emerald-800 rounded-xl text-xs font-bold shadow-2xs flex items-center space-x-1.5 transition min-h-[36px] active:scale-95 cursor-pointer"
              title="Import Jadwal dari Excel (.xlsx), CSV, atau Google Spreadsheet"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Import</span>
            </button>
          )}

          {/* Google Sheets Sync Button */}
          {canEdit && (
            <button
              onClick={handleSyncToGoogleSheets}
              disabled={isSyncingSheets}
              className="px-3 py-2 bg-white/95 border border-teal-300 hover:bg-teal-50 text-teal-800 rounded-xl text-xs font-bold shadow-2xs flex items-center space-x-1.5 transition min-h-[36px] active:scale-95 cursor-pointer disabled:opacity-50"
              title="Sinkronisasi Jadwal ke Google Sheets Real-time"
            >
              {isSyncingSheets ? (
                <Loader2 className="w-3.5 h-3.5 text-teal-600 animate-spin shrink-0" />
              ) : (
                <Share2 className="w-3.5 h-3.5 text-teal-600 shrink-0" />
              )}
              <span>Sync Sheets</span>
            </button>
          )}

          {/* Laporan Kepala Ruangan (WhatsApp) Button */}
          <button
            onClick={() => setShowHeadNurseReportModal(true)}
            className="px-3 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center space-x-1.5 transition min-h-[36px] active:scale-95 cursor-pointer"
            title="Kirim Laporan Harian Terpadu ke WhatsApp Direktur / Manajemen RS"
          >
            <Send className="w-3.5 h-3.5 text-white shrink-0" />
            <span>Laporan Karu</span>
          </button>

          {/* Cetak & PDF Button */}
          <button
            onClick={() => setShowPrintModal(true)}
            className="px-3 py-2 bg-white/95 border border-teal-300 hover:bg-teal-50 text-teal-900 rounded-xl text-xs font-bold shadow-2xs flex items-center space-x-1.5 transition min-h-[36px] active:scale-95 cursor-pointer"
            title="Cetak Jadwal Langsung atau Simpan ke PDF"
          >
            <Printer className="w-4 h-4 text-teal-700 shrink-0" />
            <span>Cetak / PDF</span>
          </button>
        </div>
      </div>

      {/* Filters and Search Bar */}
      <div className="bg-gradient-to-r from-teal-50/80 via-teal-50/40 to-teal-50/70 rounded-2xl p-3.5 sm:p-4 border border-teal-200/80 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold text-teal-800 mr-1 flex items-center">
            <Filter className="w-3.5 h-3.5 mr-1 text-teal-600" />
            Filter:
          </span>
          <button
            onClick={() => setRoleFilter('all')}
            className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold transition min-h-[32px] cursor-pointer ${
              roleFilter === 'all'
                ? 'bg-teal-600 text-white shadow-2xs'
                : 'bg-white/90 text-teal-900 border border-teal-200/60 hover:bg-teal-100/70'
            }`}
          >
            Semua ({employees.length})
          </button>
          <button
            onClick={() => setRoleFilter('mine')}
            className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold transition min-h-[32px] cursor-pointer ${
              roleFilter === 'mine'
                ? 'bg-teal-600 text-white shadow-2xs'
                : 'bg-white/90 text-teal-900 border border-teal-200/60 hover:bg-teal-100/70'
            }`}
          >
            Jadwal Saya
          </button>
          <button
            onClick={() => setRoleFilter('kepala_ruangan')}
            className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold transition min-h-[32px] cursor-pointer ${
              roleFilter === 'kepala_ruangan'
                ? 'bg-amber-600 text-white shadow-2xs'
                : 'bg-white/90 text-teal-900 border border-teal-200/60 hover:bg-teal-100/70'
            }`}
          >
            Karu
          </button>
          <button
            onClick={() => setRoleFilter('pj_shift')}
            className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold transition min-h-[32px] cursor-pointer ${
              roleFilter === 'pj_shift'
                ? 'bg-emerald-600 text-white shadow-2xs'
                : 'bg-white/90 text-teal-900 border border-teal-200/60 hover:bg-teal-100/70'
            }`}
          >
            PJ Shift
          </button>
          <button
            onClick={() => setRoleFilter('dokter')}
            className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold transition min-h-[32px] cursor-pointer ${
              roleFilter === 'dokter'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'bg-white/90 text-teal-900 border border-teal-200/60 hover:bg-teal-100/70'
            }`}
          >
            Dokter HD
          </button>
          <button
            onClick={() => setRoleFilter('perawat')}
            className={`px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold transition min-h-[32px] cursor-pointer ${
              roleFilter === 'perawat'
                ? 'bg-teal-600 text-white shadow-2xs'
                : 'bg-white/90 text-teal-900 border border-teal-200/60 hover:bg-teal-100/70'
            }`}
          >
            Perawat HD
          </button>
        </div>

        <div className="flex items-center space-x-2 w-full md:w-auto">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari nama karyawan..."
            className="px-3 py-1.5 text-xs bg-white border border-teal-200/80 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-teal-500 w-full md:w-56 text-slate-800 placeholder:text-slate-400 shadow-2xs min-h-[34px]"
          />
        </div>
      </div>

      {/* COMPREHENSIVE COLOR LEGENDS AS SPECIFIED BY USER */}
      <div className="bg-gradient-to-r from-teal-50/80 via-white to-teal-50/60 rounded-2xl p-4 border border-teal-200/80 shadow-xs space-y-3 text-xs">
        <div className="font-bold text-slate-800 text-xs flex items-center justify-between pb-2 border-b border-teal-100">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-teal-600" />
            <span>Panduan Warna Tombol Shift &amp; Tugas Khusus pada Matriks</span>
          </div>
          <span className="text-[11px] text-slate-400 font-normal">
            * Warna tombol otomatis menyesuaikan saat tugas khusus diinput
          </span>
        </div>

        {/* Shif Pagi (Tombol P) */}
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-bold text-slate-700 min-w-[70px]">Shift Pagi (P):</span>
          
          <div className="flex items-center space-x-1">
            <span className="w-5 h-5 rounded-md bg-emerald-600 text-white font-black text-[11px] flex items-center justify-center shadow-2xs">P</span>
            <span className="text-slate-700 text-[11px]">Pagi Reguler (Hijau)</span>
          </div>

          <div className="flex items-center space-x-1">
            <span className="w-5 h-5 rounded-md bg-orange-500 text-white font-black text-[11px] flex items-center justify-center shadow-2xs">P</span>
            <span className="text-slate-700 text-[11px]">PJ Shift (Orange)</span>
          </div>

          <div className="flex items-center space-x-1">
            <span className="w-5 h-5 rounded-md bg-blue-600 text-white font-black text-[11px] flex items-center justify-center shadow-2xs">P</span>
            <span className="text-slate-700 text-[11px]">BHP (Biru)</span>
          </div>

          <div className="flex items-center space-x-1">
            <span className="w-5 h-5 rounded-md bg-purple-600 text-white font-black text-[11px] flex items-center justify-center shadow-2xs">P</span>
            <span className="text-slate-700 text-[11px]">Farmasi &amp; Logistik (Ungu)</span>
          </div>

          <div className="flex items-center space-x-1">
            <span className="w-5 h-5 rounded-md bg-yellow-400 text-slate-900 font-black text-[11px] flex items-center justify-center shadow-2xs">P</span>
            <span className="text-slate-700 text-[11px]">Natrium RO (Kuning)</span>
          </div>

          <div className="flex items-center space-x-1">
            <span className="w-5 h-5 rounded-md bg-rose-600 text-white font-black text-[11px] flex items-center justify-center shadow-2xs animate-pulse ring-1 ring-rose-400">P</span>
            <span className="text-slate-700 text-[11px] font-bold text-rose-700">CITO Isolasi (Merah)</span>
          </div>
        </div>

        {/* Shif Siang (Tombol S) */}
        <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-teal-100/70">
          <span className="font-bold text-slate-700 min-w-[70px]">Shift Siang (S):</span>
          
          <div className="flex items-center space-x-1">
            <span className="w-5 h-5 rounded-md bg-pink-500 text-white font-black text-[11px] flex items-center justify-center shadow-2xs">S</span>
            <span className="text-slate-700 text-[11px]">Siang Reguler (Pink)</span>
          </div>

          <div className="flex items-center space-x-1">
            <span className="w-5 h-5 rounded-md bg-orange-500 text-white font-black text-[11px] flex items-center justify-center shadow-2xs">S</span>
            <span className="text-slate-700 text-[11px]">PJ Shift (Orange)</span>
          </div>

          <div className="flex items-center space-x-1">
            <span className="w-5 h-5 rounded-md bg-blue-600 text-white font-black text-[11px] flex items-center justify-center shadow-2xs">S</span>
            <span className="text-slate-700 text-[11px]">BHP (Biru)</span>
          </div>

          <div className="flex items-center space-x-1">
            <span className="w-5 h-5 rounded-md bg-purple-600 text-white font-black text-[11px] flex items-center justify-center shadow-2xs">S</span>
            <span className="text-slate-700 text-[11px]">Farmasi &amp; Logistik (Ungu)</span>
          </div>

          <div className="flex items-center space-x-1">
            <span className="w-5 h-5 rounded-md bg-yellow-400 text-slate-900 font-black text-[11px] flex items-center justify-center shadow-2xs">S</span>
            <span className="text-slate-700 text-[11px]">Natrium RO (Kuning)</span>
          </div>

          <div className="flex items-center space-x-1">
            <span className="w-5 h-5 rounded-md bg-rose-600 text-white font-black text-[11px] flex items-center justify-center shadow-2xs animate-pulse ring-1 ring-rose-400">S</span>
            <span className="text-slate-700 text-[11px] font-bold text-rose-700">CITO Isolasi (Merah)</span>
          </div>
        </div>

        {/* Status Lain */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-teal-100/70 text-[11px]">
          <span className="font-bold text-slate-500">Status Lain:</span>
          <div className="flex items-center space-x-1">
            <span className="w-5 h-5 rounded-md bg-rose-100 text-rose-800 border border-rose-300 font-extrabold flex items-center justify-center">L</span>
            <span className="text-slate-700">Libur Rutin / Minggu</span>
          </div>
          <div className="flex items-center space-x-1">
            <span className="w-5 h-5 rounded-md bg-amber-100 text-amber-900 border border-amber-300 font-bold flex items-center justify-center">C</span>
            <span className="text-slate-700">Cuti</span>
          </div>
          <div className="flex items-center space-x-1">
            <span className="w-5 h-5 rounded-md bg-indigo-100 text-indigo-900 border border-indigo-300 font-bold flex items-center justify-center">I</span>
            <span className="text-slate-700">Izin</span>
          </div>
          <div className="flex items-center space-x-1">
            <span className="w-5 h-5 rounded-md bg-slate-200 text-slate-800 border border-slate-300 font-bold flex items-center justify-center">SK</span>
            <span className="text-slate-700">Sakit</span>
          </div>
        </div>
      </div>

      {/* Schedule Tables - Separated for Nurses and Doctors */}
      <div className="space-y-6">
        {/* Table 1: Perawat & Kepala Ruangan */}
        {showNurseTable && renderNurseMatrixTable(nurseEmployees)}

        {/* Section 2: Penugasan Dokter Jaga HD (1 Dokter per Shif) */}
        {showDoctorSection && renderDoctorScheduleManager()}

        {/* If neither matches (e.g. search query not found) */}
        {!showNurseTable && !showDoctorSection && (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
            <UserCheck className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <h4 className="text-sm font-bold text-slate-700">Tidak ada staf yang sesuai dengan filter</h4>
            <p className="text-xs text-slate-400 mt-1">Coba sesuaikan kata kunci pencarian atau ganti pilihan filter.</p>
          </div>
        )}
      </div>

      {/* MODAL: RESET JADWAL (Requirement 2) */}
      {showResetModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2 text-rose-600">
                <RotateCcw className="w-5 h-5" />
                <h3 className="text-base font-bold text-slate-900">
                  Reset Jadwal Shift
                </h3>
              </div>
              <button
                onClick={() => setShowResetModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900 flex items-start space-x-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <p>
                  Tindakan ini akan mengosongkan data jadwal shift pada periode yang dipilih. Jadwal yang telah direset dapat di-generate ulang kapan saja.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">
                  Pilih Lingkup Reset:
                </label>
                <div className="space-y-2">
                  <label
                    onClick={() => setResetScope('month')}
                    className={`p-3 rounded-xl border flex items-center space-x-3 cursor-pointer transition ${
                      resetScope === 'month'
                        ? 'bg-rose-50/50 border-rose-400 ring-2 ring-rose-500/20'
                        : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <input
                      type="radio"
                      name="resetScope"
                      checked={resetScope === 'month'}
                      onChange={() => setResetScope('month')}
                      className="text-rose-600 focus:ring-rose-500"
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-800">
                        Hanya Bulan Ini: {monthNames[selectedMonth]} {selectedYear}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Mereset jadwal pada bulan yang sedang aktif ({currentMonthSchedules.length} entri).
                      </div>
                    </div>
                  </label>

                  <label
                    onClick={() => setResetScope('all')}
                    className={`p-3 rounded-xl border flex items-center space-x-3 cursor-pointer transition ${
                      resetScope === 'all'
                        ? 'bg-rose-50/50 border-rose-400 ring-2 ring-rose-500/20'
                        : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <input
                      type="radio"
                      name="resetScope"
                      checked={resetScope === 'all'}
                      onChange={() => setResetScope('all')}
                      className="text-rose-600 focus:ring-rose-500"
                    />
                    <div>
                      <div className="text-xs font-bold text-slate-800">
                        Seluruh Jadwal di Sistem
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Menghapus seluruh jadwal shift semua bulan ({schedules.length} total entri).
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleExecuteReset}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition shadow-xs flex items-center space-x-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Konfirmasi Reset</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: SINGLE CELL DETAIL EDIT (Accessible via right click or double click) */}
      {editingCell && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Edit3 className="w-4 h-4 text-teal-600" />
                <span>Pengaturan Rinci Shift Karyawan</span>
              </h3>
              <button
                onClick={() => setEditingCell(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-3 text-xs text-slate-600">
              <p>
                <strong>Nama Staf:</strong>{' '}
                {employees.find((e) => e.id === editingCell.employeeId)?.name}
              </p>
              <p className="mt-1">
                <strong>Jabatan:</strong>{' '}
                <span className="capitalize">{employees.find((e) => e.id === editingCell.employeeId)?.role.replace('_', ' ')}</span>
              </p>
              <p className="mt-1">
                <strong>Tanggal:</strong> {editingCell.dateStr}
              </p>
            </div>

            <div className="mt-4">
              <label className="block text-xs font-bold text-slate-700 mb-2">
                Pilih Shift / Status:
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['pagi', 'siang', 'pagi_siang', 'libur', 'cuti', 'izin', 'sakit'] as ShiftType[]).map((st) => {
                  const def = SHIFT_DEFINITIONS[st];
                  const isSelected = editingCell.currentShift === st;
                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() =>
                        setEditingCell({ ...editingCell, currentShift: st })
                      }
                      className={`p-2 rounded-xl text-xs font-bold text-left border flex items-center justify-between transition ${
                        isSelected
                          ? 'border-teal-600 bg-teal-50 text-teal-900 ring-2 ring-teal-500/20'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <span>{def.name}</span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-teal-600" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Catatan Penyesuaian (Opsional):
              </label>
              <input
                type="text"
                value={editingCell.note || ''}
                onChange={(e) =>
                  setEditingCell({ ...editingCell, note: e.target.value })
                }
                placeholder="Misal: Dokter jaga pagi, tukar dinas"
                className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <div className="mt-5 flex items-center justify-end space-x-2">
              <button
                type="button"
                onClick={() => setEditingCell(null)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() =>
                  handleSaveCellEdit(editingCell.currentShift, editingCell.note || '')
                }
                className="px-4 py-1.5 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition shadow-xs"
              >
                Simpan Perubahan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: GENERATE JADWAL BULANAN (Khusus Perawat) */}
      {showGenerateModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-xl bg-teal-100 text-teal-700 font-bold">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Generate Jadwal Bulanan Perawat
                  </h3>
                  <p className="text-xs text-slate-500">
                    Otomasi penyusunan shift perawat sesuai aturan Pagi &lt; Siang
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowGenerateModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3.5">
              <div className="p-3.5 rounded-xl bg-teal-50 border border-teal-200 text-xs text-teal-950">
                <div className="font-bold mb-1 flex items-center gap-1.5">
                  <Info className="w-4 h-4 text-teal-700" />
                  <span>Periode Target Pembuatan Jadwal:</span>
                </div>
                <p className="font-bold text-base text-teal-800">
                  {monthNames[selectedMonth]} {selectedYear} ({days.length} Hari)
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-bold text-slate-700">
                  Aturan Operasional yang Diterapkan:
                </p>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2.5 text-slate-700">
                  <div className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>Khusus Perawat:</strong> Generate otomatis hanya memproses Perawat HD dan Kepala Ruangan.
                    </span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>Pagi Lebih Sedikit:</strong> Jumlah perawat shift pagi selalu lebih sedikit daripada shift siang (Pagi &lt; Siang).
                    </span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>Anti-Kelelahan &amp; Pola Blok Teratur:</strong> Dilarang keras pola selang-seling 1-harian (<em>P S P S P S L</em> &amp; <em>S P S P S P L</em>) serta pola monoton tanpa variasi (<em>P P P P P P L</em> &amp; <em>S S S S S S L</em>).
                    </span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>Dokter HD Manual:</strong> Jadwal dokter TIDAK digenerate otomatis; dokter diatur secara manual oleh admin/karu.
                    </span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>Kepala Ruangan:</strong> Shift Pagi setiap hari Senin s/d Sabtu.
                    </span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>
                      <strong>Hari Minggu:</strong> Wajib LIBUR untuk seluruh staf unit hemodialisa.
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <label className="flex items-center space-x-2.5 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preserveOverrides}
                    onChange={(e) => setPreserveOverrides(e.target.checked)}
                    className="w-4 h-4 rounded text-teal-600 focus:ring-teal-500 border-slate-300"
                  />
                  <span>
                    Pertahankan jadwal yang sebelumnya telah diedit secara manual
                  </span>
                </label>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end space-x-2.5 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowGenerateModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleGenerateMonth}
                className="px-5 py-2 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-xl transition shadow-md shadow-teal-600/20 flex items-center space-x-1.5"
              >
                <Sparkles className="w-4 h-4" />
                <span>Generate &amp; Terapkan Jadwal</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ATUR POLA DOKTER 1 BULAN */}
      {showDoctorPatternModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2.5 text-blue-700">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Zap className="w-4 h-4 text-blue-700" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Atur Pola Cepat Dokter 1 Bulan
                  </h3>
                  <p className="text-xs text-slate-500">
                    Bulan: {monthNames[selectedMonth]} {selectedYear}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDoctorPatternModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="bg-blue-50/70 p-3 rounded-xl border border-blue-200 text-xs text-blue-900">
                <span className="font-bold">Ketentuan 1 Dokter / Shif:</span> Setiap hari operasional (Senin - Sabtu), tepat 1 dokter bertugas di Shif Pagi (07:00-14:00) dan 1 dokter bertugas di Shif Siang (13:30-20:30). Hari Minggu unit HD libur otomatis.
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1.5">
                  Pilih Dokter Utama Shif Pagi:
                </label>
                <select
                  value={doctorPagiPattern}
                  onChange={(e) => setDoctorPagiPattern(e.target.value)}
                  className="w-full text-xs font-semibold px-3 py-2 rounded-xl border border-slate-300 bg-white shadow-2xs focus:ring-2 focus:ring-blue-500 focus:outline-hidden cursor-pointer"
                >
                  {allDoctorEmployees.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} {d.nickname ? `(${d.nickname})` : ''} - {d.specialization || 'Dokter'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1.5">
                  Pilih Dokter Utama Shif Siang:
                </label>
                <select
                  value={doctorSiangPattern}
                  onChange={(e) => setDoctorSiangPattern(e.target.value)}
                  className="w-full text-xs font-semibold px-3 py-2 rounded-xl border border-slate-300 bg-white shadow-2xs focus:ring-2 focus:ring-blue-500 focus:outline-hidden cursor-pointer"
                >
                  {allDoctorEmployees.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} {d.nickname ? `(${d.nickname})` : ''} - {d.specialization || 'Dokter'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1.5">
                  Pilihan Pola Jadwal:
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setDoctorPatternMode('fixed')}
                    className={`p-3 rounded-xl border text-left text-xs transition cursor-pointer ${
                      doctorPatternMode === 'fixed'
                        ? 'border-blue-600 bg-blue-50/80 text-blue-900 font-bold ring-2 ring-blue-500/20 shadow-2xs'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-extrabold mb-0.5">Pola Tetap Rutin</div>
                    <div className="text-[11px] font-normal text-slate-500">
                      Pagi &amp; Siang konsisten setiap hari kerja
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setDoctorPatternMode('alternating')}
                    className={`p-3 rounded-xl border text-left text-xs transition cursor-pointer ${
                      doctorPatternMode === 'alternating'
                        ? 'border-blue-600 bg-blue-50/80 text-blue-900 font-bold ring-2 ring-blue-500/20 shadow-2xs'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="font-extrabold mb-0.5">Selang-Seling (Ganjil-Genap)</div>
                    <div className="text-[11px] font-normal text-slate-500">
                      Tukar shif pagi/siang setiap pergantian tanggal
                    </div>
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleResetMonthDoctors}
                className="w-full sm:w-auto px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-xl transition cursor-pointer"
              >
                Kosongkan Jadwal Dokter Bulan Ini
              </button>
              <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => setShowDoctorPatternModal(false)}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleApplyMonthlyDoctorPattern}
                  className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition shadow-md shadow-blue-600/20 flex items-center space-x-1.5 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>Terapkan ke Seluruh Bulan</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LEMBAR PENGESAHAN KHUSUS CETAK LANGSUNG PRINTER */}
      <div className="hidden print:flex justify-between mt-10 pt-4 px-12 text-xs text-slate-900 break-inside-avoid">
        <div className="text-center">
          <p>Mengetahui,</p>
          <p className="font-bold">Kepala Ruangan Hemodialisa</p>
          <div className="h-16"></div>
          <p className="font-bold underline">
            {nurseEmployees.find((n) => n.role === 'kepala_ruangan')?.name || 'Ns. Haikal, S.Kep'}
          </p>
          <p className="text-[10px] text-slate-600">
            NIP. {nurseEmployees.find((n) => n.role === 'kepala_ruangan')?.nip || '198503152010011005'}
          </p>
        </div>

        <div className="text-center">
          <p>{monthNames[selectedMonth]} {selectedYear}</p>
          <p className="font-bold">Dokter Penanggung Jawab Pelayanan HD</p>
          <div className="h-16"></div>
          <p className="font-bold underline">
            {allDoctorEmployees[0]?.name || 'dr. Reza Sp.PD-KGH'}
          </p>
          <p className="text-[10px] text-slate-600">
            NIP. {allDoctorEmployees[0]?.nip || '197908122005011003'}
          </p>
        </div>
      </div>

      {/* MODAL CETAK & SIMPAN JADWAL DALAM BENTUK PDF */}
      {showPrintModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 sm:p-6 shadow-2xl border border-slate-100">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-teal-100 text-teal-700 flex items-center justify-center shadow-2xs">
                  <Printer className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Cetak &amp; Simpan Jadwal Bulanan
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Periode: <strong className="text-teal-700">{monthNames[selectedMonth]} {selectedYear}</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowPrintModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Options */}
            <div className="space-y-3.5 my-5">
              {/* Option 1: Simpan PDF */}
              <div className="p-4 rounded-xl border-2 border-teal-200 bg-gradient-to-r from-teal-50/70 to-emerald-50/40 hover:border-teal-400 transition">
                <div className="flex items-start space-x-3">
                  <div className="p-2.5 rounded-xl bg-teal-600 text-white shrink-0 mt-0.5 shadow-2xs">
                    <FileDown className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-bold text-teal-950">
                        Simpan dalam Bentuk PDF (.pdf)
                      </h4>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 border border-teal-300">
                        Disarankan
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      Download file PDF resmi berorientasi Landscape A4 lengkap dengan Kop Surat Instalasi Hemodialisa, Matrik Shift Perawat (P/S/L), Daftar Dokter Jaga, dan Kolom Tanda Tangan Pengesahan.
                    </p>
                    <button
                      onClick={handleExportPdf}
                      disabled={isExportingPdf}
                      className="mt-3 w-full sm:w-auto px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold transition flex items-center justify-center space-x-2 shadow-xs active:scale-95 cursor-pointer disabled:opacity-50"
                    >
                      {isExportingPdf ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Menyiapkan Dokumen PDF...</span>
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4" />
                          <span>Download Jadwal PDF</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Option 2: Print Langsung */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/80 hover:bg-white hover:border-slate-300 transition">
                <div className="flex items-start space-x-3">
                  <div className="p-2.5 rounded-xl bg-slate-700 text-white shrink-0 mt-0.5 shadow-2xs">
                    <Printer className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <h4 className="text-sm font-bold text-slate-900">
                      Print Langsung (Mesin Printer)
                    </h4>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      Buka dialog cetak browser untuk langsung mencetak dokumen ke printer fisik atau printer bawaan sistem dalam format landscape.
                    </p>
                    <button
                      onClick={handleDirectPrint}
                      className="mt-3 w-full sm:w-auto px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold transition flex items-center justify-center space-x-2 shadow-xs active:scale-95 cursor-pointer"
                    >
                      <Printer className="w-4 h-4" />
                      <span>Buka Dialog Cetak Langsung</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setShowPrintModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL IMPORT JADWAL (Excel / CSV / Google Sheets) */}
      {showImportModal && (
        <ImportScheduleModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          defaultMonth={monthPrefix}
          nurses={domainNurses}
          machines={domainMachines}
          settings={settings}
          onImportCompleted={handleImportCompleted}
        />
      )}

      {/* MODAL REGENERASI ALOKASI MESIN (Pagi / Siang / Sebulan) */}
      {showRegenerateAllocationModal && (
        <RegenerateMachineAllocationModal
          isOpen={showRegenerateAllocationModal}
          onClose={() => setShowRegenerateAllocationModal(false)}
          selectedDate={activeDateForReport}
          currentMonth={monthPrefix}
          nurses={domainNurses}
          machines={domainMachines}
          assignments={domainMonthlyAssignments}
          onReallocationCompleted={handleReallocationCompleted}
        />
      )}

      {/* MODAL LAPORAN KEPALA RUANGAN (WhatsApp) */}
      {showHeadNurseReportModal && (
        <HeadNurseReportModal
          isOpen={showHeadNurseReportModal}
          onClose={() => setShowHeadNurseReportModal(false)}
          dailyAssignments={currentDailyAssignments}
          machines={domainMachines}
          selectedDate={activeDateForReport}
          settings={effectiveSettings}
          onUpdateSettings={onUpdateSettings}
          doctorDuties={{
            [activeDateForReport]: {
              date: activeDateForReport,
              pagiDoctorName: getDoctorForShiftAndDate(activeDateForReport, 'pagi')?.name,
              siangDoctorName: getDoctorForShiftAndDate(activeDateForReport, 'siang')?.name,
            },
          }}
        />
      )}

      {/* MODAL PANDUAN GOOGLE APPS SCRIPT WEBHOOK */}
      {showGoogleScriptModal && (
        <GoogleScriptGuideModal
          isOpen={showGoogleScriptModal}
          onClose={() => setShowGoogleScriptModal(false)}
        />
      )}
    </div>
  );
};
