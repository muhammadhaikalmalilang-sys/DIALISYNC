import { SpecialDutyOption } from '../types';

export interface SpecialDutyDotStyle {
  bgClass: string;
  ringClass: string;
  textClass: string;
  label: string;
  shortCode: string;
  dotColorHex: string;
  description: string;
}

/**
 * Returns distinct dot style and color classes based on Special Duty name
 * Supports dynamic options passed from HemoContext or falls back to system presets
 */
export const getSpecialDutyDotStyle = (
  dutyName?: string | null,
  dynamicOptions?: SpecialDutyOption[]
): SpecialDutyDotStyle => {
  if (!dutyName) {
    return {
      bgClass: 'bg-slate-400',
      ringClass: 'ring-1 ring-white dark:ring-slate-900',
      textClass: 'text-slate-700',
      label: 'Tugas Khusus',
      shortCode: 'TK',
      dotColorHex: '#94a3b8',
      description: 'Tugas Khusus',
    };
  }

  const normalized = dutyName.trim().toUpperCase();

  // 0. Check dynamic options first if available
  if (dynamicOptions && dynamicOptions.length > 0) {
    const matched = dynamicOptions.find(
      (opt) =>
        opt.code.toUpperCase() === normalized ||
        opt.id.toUpperCase() === normalized ||
        opt.shortName.toUpperCase() === normalized ||
        opt.label.toUpperCase() === normalized ||
        normalized.includes(opt.code.toUpperCase()) ||
        normalized.includes(opt.shortName.toUpperCase())
    );

    if (matched) {
      return {
        bgClass: `${matched.bgClass} shadow-xs`,
        ringClass: 'ring-1 ring-white dark:ring-slate-900',
        textClass: matched.textClass || 'text-slate-700 dark:text-slate-200',
        label: matched.label,
        shortCode: matched.shortName || matched.code.slice(0, 4),
        dotColorHex: matched.dotColorHex,
        description: matched.description || matched.label,
      };
    }
  }

  // 1. Dot Biru : Tugas Khusus BHP
  if (normalized.includes('BHP')) {
    return {
      bgClass: 'bg-blue-500 shadow-xs shadow-blue-500/50',
      ringClass: 'ring-1 ring-white dark:ring-slate-900',
      textClass: 'text-blue-700 dark:text-blue-300',
      label: 'Tugas Khusus BHP',
      shortCode: 'BHP',
      dotColorHex: '#3b82f6',
      description: 'Bahan Habis Pakai (Spuit, Bloodline, AV Fistula, Dialyzer, Desinfektan)',
    };
  }

  // 2. Dot Merah : Tugas Khusus Farmasi Logistik
  if (
    normalized.includes('FARMASI') ||
    normalized.includes('LOGISTIK') ||
    normalized.includes('OBAT')
  ) {
    return {
      bgClass: 'bg-rose-500 shadow-xs shadow-rose-500/50',
      ringClass: 'ring-1 ring-white dark:ring-slate-900',
      textClass: 'text-rose-700 dark:text-rose-300',
      label: 'Tugas Khusus Farmasi Logistik',
      shortCode: 'FAR',
      dotColorHex: '#f43f5e',
      description: 'Farmasi & Logistik (Obat Emergensi, EPO, Zat Besi, Amprah)',
    };
  }

  // 3. Dot Kuning : Natrium RO
  if (
    normalized.includes('NATRIUM') ||
    normalized.includes('RO') ||
    normalized.includes('WATER') ||
    normalized.includes('BIKARBONAT')
  ) {
    return {
      bgClass: 'bg-amber-400 shadow-xs shadow-amber-400/50',
      ringClass: 'ring-1 ring-white dark:ring-slate-900',
      textClass: 'text-amber-700 dark:text-amber-300',
      label: 'Tugas Khusus Natrium RO',
      shortCode: 'RO',
      dotColorHex: '#fbbf24',
      description: 'Natrium RO & Water Treatment (Bikarbonat, Uji TDS/Klorin)',
    };
  }

  // 4. Dot Hijau : Tugas Khusus PJ Shif
  if (
    normalized.includes('PJ SHIF') ||
    normalized.includes('PJ SIF') ||
    normalized.includes('KATIM') ||
    normalized.includes('LEADER') ||
    normalized.includes('PENANGGUNG JAWAB')
  ) {
    return {
      bgClass: 'bg-emerald-500 shadow-xs shadow-emerald-500/50',
      ringClass: 'ring-1 ring-white dark:ring-slate-900',
      textClass: 'text-emerald-700 dark:text-emerald-300',
      label: 'Tugas Khusus PJ Shif',
      shortCode: 'PJ',
      dotColorHex: '#10b981',
      description: 'Penanggung Jawab Sif (Katim / Leader Dinas)',
    };
  }

  // 5. CITO & Isolasi: Dot Merah Tua
  if (normalized.includes('CITO') || normalized.includes('ISOLASI')) {
    return {
      bgClass: 'bg-red-600 shadow-xs shadow-red-600/50',
      ringClass: 'ring-1 ring-white dark:ring-slate-900',
      textClass: 'text-red-700 dark:text-red-300',
      label: 'CITO & Isolasi',
      shortCode: 'CITO',
      dotColorHex: '#dc2626',
      description: 'HD Darurat / CITO & Penanggung Jawab Isolasi',
    };
  }

  // 6. Reuse Dialyzer: Dot Oranye
  if (
    normalized.includes('REUSE') ||
    normalized.includes('TABUNG') ||
    normalized.includes('REPROCESSING')
  ) {
    return {
      bgClass: 'bg-orange-500 shadow-xs shadow-orange-500/50',
      ringClass: 'ring-1 ring-white dark:ring-slate-900',
      textClass: 'text-orange-700 dark:text-orange-300',
      label: 'Reuse Dialyzer',
      shortCode: 'REU',
      dotColorHex: '#f97316',
      description: 'Reprocessing & Uji Tabung Dialyzer Reuse',
    };
  }

  // 7. IPCN / PPI HD: Dot Ungu
  if (normalized.includes('IPCN') || normalized.includes('PPI') || normalized.includes('INFEKSI')) {
    return {
      bgClass: 'bg-purple-600 shadow-xs shadow-purple-600/50',
      ringClass: 'ring-1 ring-white dark:ring-slate-900',
      textClass: 'text-purple-700 dark:text-purple-300',
      label: 'IPCN / PPI HD',
      shortCode: 'PPI',
      dotColorHex: '#9333ea',
      description: 'Pengendalian & Pencegahan Infeksi (Audit APD, Limbah Medis)',
    };
  }

  // 8. Klaim & Dokumen BPJS: Dot Indigo
  if (
    normalized.includes('BPJS') ||
    normalized.includes('KLAIM') ||
    normalized.includes('SEP') ||
    normalized.includes('DOKUMEN')
  ) {
    return {
      bgClass: 'bg-indigo-500 shadow-xs shadow-indigo-500/50',
      ringClass: 'ring-1 ring-white dark:ring-slate-900',
      textClass: 'text-indigo-700 dark:text-indigo-300',
      label: 'Klaim & Dokumen BPJS',
      shortCode: 'BPJS',
      dotColorHex: '#6366f1',
      description: 'Verifikasi SEP, Resep HD & Berkas Klaim BPJS',
    };
  }

  // 9. Lainnya / Custom: Dot Teal
  return {
    bgClass: 'bg-teal-500 shadow-xs shadow-teal-500/50',
    ringClass: 'ring-1 ring-white dark:ring-slate-900',
    textClass: 'text-teal-700 dark:text-teal-300',
    label: dutyName,
    shortCode: dutyName.slice(0, 3).toUpperCase(),
    dotColorHex: '#14b8a6',
    description: `Tugas Khusus: ${dutyName}`,
  };
};

export const SPECIAL_DUTY_DOT_LEGENDS = [
  {
    name: 'BHP',
    label: 'Tugas Khusus BHP',
    colorName: 'Biru',
    dotBg: 'bg-blue-500',
    borderClass: 'border-blue-200 dark:border-blue-800',
    textClass: 'text-blue-800 dark:text-blue-300',
  },
  {
    name: 'FARMASI LOGISTIK',
    label: 'Farmasi Logistik',
    colorName: 'Merah',
    dotBg: 'bg-rose-500',
    borderClass: 'border-rose-200 dark:border-rose-800',
    textClass: 'text-rose-800 dark:text-rose-300',
  },
  {
    name: 'NATRIUM RO',
    label: 'Natrium RO',
    colorName: 'Kuning',
    dotBg: 'bg-amber-400',
    borderClass: 'border-amber-200 dark:border-amber-800',
    textClass: 'text-amber-800 dark:text-amber-300',
  },
  {
    name: 'PJ SHIF',
    label: 'PJ Shif (Katim)',
    colorName: 'Hijau',
    dotBg: 'bg-emerald-500',
    borderClass: 'border-emerald-200 dark:border-emerald-800',
    textClass: 'text-emerald-800 dark:text-emerald-300',
  },
  {
    name: 'CITO',
    label: 'CITO & Isolasi',
    colorName: 'Merah Tua',
    dotBg: 'bg-red-600',
    borderClass: 'border-red-200 dark:border-red-800',
    textClass: 'text-red-800 dark:text-red-300',
  },
  {
    name: 'LAINNYA',
    label: 'Lainnya / PIC',
    colorName: 'Teal',
    dotBg: 'bg-teal-500',
    borderClass: 'border-teal-200 dark:border-teal-800',
    textClass: 'text-teal-800 dark:text-teal-300',
  },
];

export const getSpecialDutyLegends = (dynamicOptions?: SpecialDutyOption[]) => {
  if (!dynamicOptions || dynamicOptions.length === 0) {
    return SPECIAL_DUTY_DOT_LEGENDS;
  }
  return dynamicOptions.map((opt) => ({
    name: opt.code,
    label: opt.shortName || opt.label,
    colorName: opt.colorName || 'Kustom',
    dotBg: opt.bgClass,
    borderClass: opt.borderClass || 'border-slate-200 dark:border-slate-800',
    textClass: opt.textClass || 'text-slate-800 dark:text-slate-300',
  }));
};
