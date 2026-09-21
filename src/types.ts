export type UserRole = 'admin' | 'kepala_ruangan' | 'pj_shift' | 'dokter' | 'perawat';

export type ShiftType = 'pagi' | 'siang' | 'libur' | 'cuti' | 'izin' | 'sakit' | 'pagi_siang';

export interface UserAccount {
  id: string;
  username: string;
  password: string; // Plaintext for demo/management by administrator
  name: string;
  nickname?: string; // Nama panggilan (e.g. "Fransisca", "Haikal", "Karu")
  gender?: 'L' | 'P'; // Jenis kelamin: 'L' = Laki-laki, 'P' = Perempuan
  role: UserRole;
  nip: string;
  phone: string;
  email: string;
  status: 'aktif' | 'nonaktif';
  specialization?: string; // e.g. "Sp.PD-KGH", "Perawat Mahir HD"
  createdAt: string;
}

export interface ShiftSchedule {
  id: string; // `${employeeId}_${date}`
  employeeId: string;
  date: string; // YYYY-MM-DD
  shift: ShiftType;
  note?: string;
  isCustomOverride?: boolean;
}

export type MachineStatus = 'siap' | 'dipakai' | 'maintenance' | 'perbaikan';

export type MachineZone = string;

export interface MachineZoneConfig {
  id: string;
  name: string;
  type: 'reguler' | 'isolasi';
  order: number;
  description?: string;
}

export const DEFAULT_ZONES: MachineZoneConfig[] = [
  { id: 'zone-a', name: 'Zona A (Reguler)', type: 'reguler', order: 1, description: 'Deretan 12 Bed Sisi A (A01 s/d A12)' },
  { id: 'zone-b', name: 'Zona B (Reguler)', type: 'reguler', order: 2, description: 'Blok Mesin Sisi B (B01-B04 Lorong, B05-B09 Dinding)' },
  { id: 'zone-c', name: 'Zona C (Reguler)', type: 'reguler', order: 3, description: 'Blok Mesin Sisi C (C01-C04 Lorong, C05-C08 Dinding)' },
  { id: 'zone-d', name: 'Zona D (Reguler)', type: 'reguler', order: 4, description: 'Blok Mesin Sisi D (D01 s/d D03)' },
  { id: 'zone-e', name: 'Zona E (Reguler)', type: 'reguler', order: 5, description: 'Blok Mesin Sisi E (E01 & E02)' },
  { id: 'zone-f', name: 'Zona F (Reguler)', type: 'reguler', order: 6, description: 'Blok Mesin Sisi F (F01 & F02)' },
  { id: 'zone-iso', name: 'Zona Isolasi', type: 'isolasi', order: 7, description: 'Ruang Isolasi Khusus (ISO 01 s/d ISO 04)' },
];

export interface HDMachine {
  id: string;
  code: string; // e.g. "HD-01"
  brand: string; // e.g. "Fresenius Medical Care 4008S"
  model: string;
  zone: MachineZone;
  status: MachineStatus;
  serialNumber: string;
  lastMaintenance: string; // YYYY-MM-DD
  notes?: string;
}

export interface MachineAssignment {
  id: string; // `${date}_${shift}_${machineId}`
  date: string; // YYYY-MM-DD
  shift: 'pagi' | 'siang';
  machineId: string;
  nurseId?: string;
  isOff?: boolean; // Fitur matikan mesin untuk shift ini
  offReason?: string; // Alasan mesin dimatikan
  patientName?: string;
  medicalRecordNo?: string;
  targetUF?: string; // e.g. "2.5 L"
  dialyzerType?: string; // e.g. "Hi-Flux F7HPS"
  notes?: string;
}

export type TaskPriority = 'rendah' | 'normal' | 'penting' | 'mendesak';
export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export type SpecialTaskCategory = 'pj_shift' | 'bhp' | 'farmasi_logistik' | 'natrium_ro' | 'cito';

export interface SpecialTaskDefinition {
  category: SpecialTaskCategory;
  name: string;
  shortCode: string;
  badgeBg: string;
  badgeBorder: string;
  textColor: string;
  lightBg: string;
  lightText: string;
  lightBorder: string;
  description: string;
}

export const SPECIAL_TASK_DEFINITIONS: Record<SpecialTaskCategory, SpecialTaskDefinition> = {
  pj_shift: {
    category: 'pj_shift',
    name: 'PJ Shift',
    shortCode: 'PJ',
    badgeBg: 'bg-orange-500',
    badgeBorder: 'border-orange-600',
    textColor: 'text-white',
    lightBg: 'bg-orange-100',
    lightText: 'text-orange-900',
    lightBorder: 'border-orange-300',
    description: 'Penanggung Jawab Shift (Koordinasi alur pasien, supervisi, laporan)',
  },
  bhp: {
    category: 'bhp',
    name: 'BHP',
    shortCode: 'BHP',
    badgeBg: 'bg-blue-600',
    badgeBorder: 'border-blue-700',
    textColor: 'text-white',
    lightBg: 'bg-blue-100',
    lightText: 'text-blue-900',
    lightBorder: 'border-blue-300',
    description: 'Barang Habis Pakai (Bloodline, AV Fistula Needle, Dialyzer, Spuit)',
  },
  farmasi_logistik: {
    category: 'farmasi_logistik',
    name: 'Farmasi & Logistik',
    shortCode: 'FARM',
    badgeBg: 'bg-purple-600',
    badgeBorder: 'border-purple-700',
    textColor: 'text-white',
    lightBg: 'bg-purple-100',
    lightText: 'text-purple-900',
    lightBorder: 'border-purple-300',
    description: 'Farmasi & Logistik (Konsentrat Asid, Bikarbonat, Heparin, Obat Emergensi)',
  },
  natrium_ro: {
    category: 'natrium_ro',
    name: 'Natrium RO',
    shortCode: 'RO',
    badgeBg: 'bg-yellow-400',
    badgeBorder: 'border-yellow-500',
    textColor: 'text-slate-900',
    lightBg: 'bg-yellow-100',
    lightText: 'text-yellow-900',
    lightBorder: 'border-yellow-300',
    description: 'Pengawasan Water Treatment RO & Uji Profil Natrium / Klorin',
  },
  cito: {
    category: 'cito',
    name: 'CITO',
    shortCode: 'CITO',
    badgeBg: 'bg-rose-600',
    badgeBorder: 'border-rose-700',
    textColor: 'text-white',
    lightBg: 'bg-rose-100',
    lightText: 'text-rose-900',
    lightBorder: 'border-rose-300',
    description: 'Tindakan HD CITO / Emergency HD (Otomatis Mendapatkan Alokasi Mesin ISOLASI)',
  },
};

export interface SpecialTask {
  id: string;
  title: string;
  description: string;
  assignedToId: string;
  assignedByName: string;
  date: string; // YYYY-MM-DD
  shift: 'pagi' | 'siang';
  priority: TaskPriority;
  status: TaskStatus;
  category: SpecialTaskCategory;
  createdAt: string;
  completedAt?: string;
  completionNotes?: string;
}

export interface ShiftDefinition {
  type: ShiftType;
  name: string;
  startTime: string;
  endTime: string;
  badgeBg: string;
  badgeText: string;
  description: string;
}

export const SHIFT_DEFINITIONS: Record<ShiftType, ShiftDefinition> = {
  pagi: {
    type: 'pagi',
    name: 'Shift Pagi',
    startTime: '07:00',
    endTime: '14:00',
    badgeBg: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    badgeText: 'Pagi (07:00-14:00)',
    description: 'Sesi Hemodialisa 1 (Priming, Kanulasi, Monitoring HD Pagi)',
  },
  siang: {
    type: 'siang',
    name: 'Shift Siang',
    startTime: '13:30',
    endTime: '20:30',
    badgeBg: 'bg-blue-100 text-blue-800 border-blue-300',
    badgeText: 'Siang (13:30-20:30)',
    description: 'Sesi Hemodialisa 2 (Disinfeksi antar sesi, Monitoring HD Siang, Desinfeksi Akhir)',
  },
  libur: {
    type: 'libur',
    name: 'Libur Rutin',
    startTime: '-',
    endTime: '-',
    badgeBg: 'bg-rose-100 text-rose-800 border-rose-300',
    badgeText: 'Libur',
    description: 'Hari Libur Kerja (Wajib Minggu untuk semua staf)',
  },
  cuti: {
    type: 'cuti',
    name: 'Cuti Tahunan',
    startTime: '-',
    endTime: '-',
    badgeBg: 'bg-amber-100 text-amber-800 border-amber-300',
    badgeText: 'Cuti',
    description: 'Cuti Tahunan / Alasan Resmi',
  },
  izin: {
    type: 'izin',
    name: 'Izin',
    startTime: '-',
    endTime: '-',
    badgeBg: 'bg-purple-100 text-purple-800 border-purple-300',
    badgeText: 'Izin',
    description: 'Izin resmi kepentingan mendesak',
  },
  sakit: {
    type: 'sakit',
    name: 'Sakit',
    startTime: '-',
    endTime: '-',
    badgeBg: 'bg-slate-200 text-slate-700 border-slate-300',
    badgeText: 'Sakit',
    description: 'Istirahat sakit dengan surat dokter',
  },
  pagi_siang: {
    type: 'pagi_siang',
    name: '2 Shif (Pagi & Siang)',
    startTime: '07:00',
    endTime: '20:30',
    badgeBg: 'bg-indigo-100 text-indigo-900 border-indigo-300',
    badgeText: 'Pagi & Siang (2 Shif)',
    description: 'Dinas Jaga 2 Sesi Penuh (1 Dokter melaksanakan Shif Pagi dan Siang)',
  },
};
