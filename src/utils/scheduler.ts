import { UserAccount, ShiftSchedule, HDMachine, MachineAssignment, ShiftType } from '../types';

export function getDaysInMonth(year: number, month: number): { date: Date; dateStr: string; dayOfWeek: number; dayName: string; isSunday: boolean }[] {
  // month is 0-indexed (0 = Jan, 8 = Sep)
  const date = new Date(year, month, 1);
  const days = [];
  const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

  while (date.getMonth() === month) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    const dayOfWeek = date.getDay();

    days.push({
      date: new Date(date),
      dateStr,
      dayOfWeek,
      dayName: dayNames[dayOfWeek],
      isSunday: dayOfWeek === 0,
    });

    date.setDate(date.getDate() + 1);
  }

  return days;
}

/**
 * Return current active date formatted as YYYY-MM-DD
 */
export function getTodayDateString(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Generate monthly schedule adhering strictly to operational rules:
 * 1. HARI MINGGU: Selalu LIBUR untuk semua staf (Kepala Ruang, Perawat).
 * 2. KEPALA RUANG: Selalu SHIFT PAGI setiap hari Senin - Sabtu.
 * 3. DOKTER: Diinput secara MANUAL (1 dokter bisa bertugas 2 shif Pagi & Siang).
 * 4. GENERATE HANYA UNTUK PERAWAT:
 *    - Proporsi: Jumlah perawat shift pagi LEBIH SEDIKIT daripada shift siang (Pagi < Siang).
 *    - Keseimbangan Beban Kerja (Fair & Balanced): Jumlah total shif Pagi & Siang dibagi merata.
 *    - Anti-Kelelahan: DILARANG membuat pola selang-seling harian P-S-P-S-P-S.
 *    - Menggunakan sistem blok shift (2-3 hari berturut-turut pada shift yang sama) dan
 *      mencegah transisi langsung Siang -> Pagi (S -> P) tanpa hari libur/Minggu agar durasi istirahat cukup.
 */
/**
 * Valid weekly block patterns for full 6 working days (Senin s/d Sabtu).
 * Setiap pola menjamin:
 * 1. BUKAN P S P S P S L (tidak ada selang-seling 1 harian)
 * 2. BUKAN S P S P S P L (tidak ada selang-seling 1 harian)
 * 3. BUKAN P P P P P P L (memiliki minimal 2 shift siang)
 * 4. BUKAN S S S S S S L (memiliki minimal 2 shift pagi)
 * 5. Menggunakan blok shift (minimal 2 hari berurutan pada shift yang sama)
 */
const VALID_6DAY_PATTERNS: ShiftType[][] = [
  // 3 Pagi, 3 Siang (Keseimbangan 50:50)
  ['pagi', 'pagi', 'pagi', 'siang', 'siang', 'siang'], // Pola 0: Mon-Wed P, Thu-Sat S
  ['siang', 'siang', 'siang', 'pagi', 'pagi', 'pagi'], // Pola 1: Mon-Wed S, Thu-Sat P
  
  // 2 Pagi, 4 Siang (Sesuai rasio perawat Pagi < Siang)
  ['pagi', 'pagi', 'siang', 'siang', 'siang', 'siang'], // Pola 2: Mon-Tue P, Wed-Sat S
  ['siang', 'siang', 'pagi', 'pagi', 'siang', 'siang'], // Pola 3: Mon-Tue S, Wed-Thu P, Fri-Sat S
  ['siang', 'siang', 'siang', 'siang', 'pagi', 'pagi'], // Pola 4: Mon-Thu S, Fri-Sat P

  // 4 Pagi, 2 Siang
  ['pagi', 'pagi', 'pagi', 'pagi', 'siang', 'siang'], // Pola 5: Mon-Thu P, Fri-Sat S
  ['siang', 'siang', 'pagi', 'pagi', 'pagi', 'pagi'], // Pola 6: Mon-Tue S, Wed-Sat P
  ['pagi', 'pagi', 'siang', 'siang', 'pagi', 'pagi'], // Pola 7: Mon-Tue P, Wed-Thu S, Fri-Sat P
];

/**
 * Valid block patterns for partial weeks (1 to 5 working days)
 */
function getValidPartialPatterns(numDays: number): ShiftType[][] {
  switch (numDays) {
    case 5:
      return [
        ['pagi', 'pagi', 'pagi', 'siang', 'siang'],
        ['siang', 'siang', 'pagi', 'pagi', 'pagi'],
        ['pagi', 'pagi', 'siang', 'siang', 'siang'],
        ['siang', 'siang', 'siang', 'pagi', 'pagi'],
        ['siang', 'siang', 'pagi', 'pagi', 'siang'],
      ];
    case 4:
      return [
        ['pagi', 'pagi', 'siang', 'siang'],
        ['siang', 'siang', 'pagi', 'pagi'],
        ['pagi', 'pagi', 'pagi', 'siang'],
        ['siang', 'siang', 'siang', 'pagi'],
      ];
    case 3:
      return [
        ['pagi', 'pagi', 'siang'],
        ['siang', 'siang', 'pagi'],
        ['pagi', 'siang', 'siang'],
        ['siang', 'pagi', 'pagi'],
      ];
    case 2:
      return [
        ['pagi', 'pagi'],
        ['siang', 'siang'],
        ['pagi', 'siang'],
        ['siang', 'pagi'],
      ];
    case 1:
      return [
        ['pagi'],
        ['siang'],
      ];
    default:
      return [];
  }
}

/**
 * Validates whether a weekly sequence of 6 working days (Mon-Sat) matches any of the 4 forbidden patterns.
 */
export function isForbiddenWeeklySequence(shifts: ShiftType[]): { isForbidden: boolean; reason?: string } {
  if (shifts.length < 6) return { isForbidden: false };
  const s = shifts.slice(0, 6);

  // 1. P S P S P S
  if (
    s[0] === 'pagi' && s[1] === 'siang' &&
    s[2] === 'pagi' && s[3] === 'siang' &&
    s[4] === 'pagi' && s[5] === 'siang'
  ) {
    return { isForbidden: true, reason: 'P S P S P S L (Selang-seling harian P-S)' };
  }

  // 2. S P S P S P
  if (
    s[0] === 'siang' && s[1] === 'pagi' &&
    s[2] === 'siang' && s[3] === 'pagi' &&
    s[4] === 'siang' && s[5] === 'pagi'
  ) {
    return { isForbidden: true, reason: 'S P S P S P L (Selang-seling harian S-P)' };
  }

  // 3. P P P P P P
  if (s.every((x) => x === 'pagi')) {
    return { isForbidden: true, reason: 'P P P P P P L (Monoton Pagi penuh tanpa Siang)' };
  }

  // 4. S S S S S S
  if (s.every((x) => x === 'siang')) {
    return { isForbidden: true, reason: 'S S S S S S L (Monoton Siang penuh tanpa Pagi)' };
  }

  return { isForbidden: false };
}

/**
 * Generate monthly schedule adhering strictly to operational rules:
 * 1. HARI MINGGU: Selalu LIBUR ('L') untuk seluruh staf (Kepala Ruang, Perawat).
 * 2. KEPALA RUANG: Selalu SHIFT PAGI ('P') setiap hari Senin s/d Sabtu.
 * 3. DOKTER: Diinput secara MANUAL (1 dokter bisa bertugas 2 shif Pagi & Siang).
 * 4. GENERATE PERAWAT DENGAN POLA BLOK BEBAS KELELAHAN:
 *    - Proporsi: Jumlah perawat shift pagi LEBIH SEDIKIT daripada shift siang (Pagi < Siang).
 *    - Keseimbangan Beban Kerja (Fair & Balanced): Total shif Pagi & Siang terbagi adil merata.
 *    - ATURAN KETAT MINGGUAN:
 *      1. Dalam satu minggu DILARANG: P S P S P S L
 *      2. Dalam satu minggu DILARANG: S P S P S P L
 *      3. Dalam satu minggu DILARANG: P P P P P P L
 *      4. Dalam satu minggu DILARANG: S S S S S S L
 *    - Menggunakan sistem blok shift teratur (kombinasi 2-4 hari berturut-turut pada shift yang sama).
 */
export function generateMonthlySchedule(
  year: number,
  month: number, // 0-indexed
  employees: UserAccount[],
  preserveCustomOverrides = false,
  existingSchedules: ShiftSchedule[] = []
): ShiftSchedule[] {
  const days = getDaysInMonth(year, month);
  const overrideMap = new Map<string, ShiftSchedule>();

  existingSchedules.forEach((sch) => {
    if (preserveCustomOverrides && sch.isCustomOverride) {
      overrideMap.set(`${sch.employeeId}_${sch.date}`, sch);
    }
  });

  const activeEmployees = employees.filter((e) => e.status === 'aktif');
  const kepalaRuang = activeEmployees.filter((e) => e.role === 'kepala_ruangan');
  const nurses = activeEmployees.filter((e) => e.role === 'perawat' || e.role === 'pj_shift');

  // Keep existing doctor schedules intact (Doctors are manual only)
  const doctorSchedules = existingSchedules.filter((sch) => {
    const emp = employees.find((e) => e.id === sch.employeeId);
    return emp?.role === 'dokter';
  });

  const newSchedules: ShiftSchedule[] = [...doctorSchedules];

  // 1. Jadwal Hari Minggu: Libur Otomatis untuk Semua Staf
  days.forEach((day) => {
    if (day.isSunday) {
      activeEmployees.forEach((emp) => {
        if (emp.role === 'dokter') {
          const key = `${emp.id}_${day.dateStr}`;
          const existing = newSchedules.find((s) => s.id === key);
          if (!existing) {
            newSchedules.push({
              id: key,
              employeeId: emp.id,
              date: day.dateStr,
              shift: 'libur',
              note: 'Libur Rutin Hari Minggu (Unit HD Tutup)',
            });
          }
          return;
        }

        const key = `${emp.id}_${day.dateStr}`;
        if (preserveCustomOverrides && overrideMap.has(key)) {
          newSchedules.push(overrideMap.get(key)!);
          return;
        }

        newSchedules.push({
          id: key,
          employeeId: emp.id,
          date: day.dateStr,
          shift: 'libur',
          note: 'Libur Rutin Hari Minggu (Unit HD Tutup)',
        });
      });
    } else {
      // Kepala Ruangan: Selalu Pagi Senin - Sabtu
      kepalaRuang.forEach((karu) => {
        const key = `${karu.id}_${day.dateStr}`;
        if (preserveCustomOverrides && overrideMap.has(key)) {
          newSchedules.push(overrideMap.get(key)!);
          return;
        }

        newSchedules.push({
          id: key,
          employeeId: karu.id,
          date: day.dateStr,
          shift: 'pagi',
          note: 'Kepala Ruangan (Shift Pagi Rutin)',
        });
      });
    }
  });

  // 2. Generate Khusus Perawat HD
  const totalNurses = nurses.length;
  if (totalNurses === 0) {
    return newSchedules;
  }

  // Strict hospital operational rule: morningCount < afternoonCount
  const morningCount = totalNurses <= 2 ? 1 : Math.floor((totalNurses - 1) / 2);

  // Group days of the month into calendar weeks (starting on Monday, ending on Sunday)
  interface MonthWeek {
    weekIndex: number;
    days: typeof days;
    workingDays: typeof days;
  }

  const calendarWeeks: MonthWeek[] = [];
  let currentWeekDays: typeof days = [];

  days.forEach((day) => {
    currentWeekDays.push(day);
    if (day.isSunday) {
      calendarWeeks.push({
        weekIndex: calendarWeeks.length,
        days: currentWeekDays,
        workingDays: currentWeekDays.filter((d) => !d.isSunday),
      });
      currentWeekDays = [];
    }
  });

  if (currentWeekDays.length > 0) {
    calendarWeeks.push({
      weekIndex: calendarWeeks.length,
      days: currentWeekDays,
      workingDays: currentWeekDays.filter((d) => !d.isSunday),
    });
  }

  // Cumulative state tracker for each nurse across the month
  const nurseState: Record<
    string,
    {
      pagiCount: number;
      siangCount: number;
    }
  > = {};

  nurses.forEach((n) => {
    nurseState[n.id] = { pagiCount: 0, siangCount: 0 };
  });

  // Process each week using rotating block-shift allocation
  calendarWeeks.forEach((week, weekIdx) => {
    const workingDays = week.workingDays;
    const numWorkingDays = workingDays.length;

    if (numWorkingDays === 0) {
      return;
    }

    // Sort nurses by cumulative pagiCount ascending to balance morning workload across the month
    // Tie-break with consistent nurse index + week offset for smooth pattern variety
    const sortedNurses = [...nurses].sort((a, b) => {
      const diff = nurseState[a.id].pagiCount - nurseState[b.id].pagiCount;
      if (diff !== 0) return diff;
      return (nurses.indexOf(a) + weekIdx) % totalNurses - ((nurses.indexOf(b) + weekIdx) % totalNurses);
    });

    // Check pre-existing overrides for each nurse in this week
    const nurseOverrides = new Map<string, Map<number, ShiftType>>();
    workingDays.forEach((day, dayIndex) => {
      sortedNurses.forEach((nurse) => {
        const key = `${nurse.id}_${day.dateStr}`;
        if (preserveCustomOverrides && overrideMap.has(key)) {
          if (!nurseOverrides.has(nurse.id)) {
            nurseOverrides.set(nurse.id, new Map());
          }
          nurseOverrides.get(nurse.id)!.set(dayIndex, overrideMap.get(key)!.shift);
        }
      });
    });

    const candidatePool =
      numWorkingDays === 6
        ? VALID_6DAY_PATTERNS
        : getValidPartialPatterns(numWorkingDays);

    // Nurse assigned shifts for this week: nurseId -> ShiftType[]
    const weekAssignment = new Map<string, ShiftType[]>();

    // CASE 1: Standard 12 Nurses, full 6-day week without conflicting overrides
    // Uses the optimal closed-form rotating assignment where every day has EXACTLY 5 Pagi & 7 Siang,
    // and NO nurse ever has P-S-P-S-P-S-L, S-P-S-P-S-P-L, P-P-P-P-P-P-L, or S-S-S-S-S-S-L.
    const hasOverridesThisWeek = nurseOverrides.size > 0;
    if (totalNurses === 12 && numWorkingDays === 6 && !hasOverridesThisWeek) {
      // 3 nurses: Pattern 0 ('P P P S S S') -> 3 Pagi
      // 3 nurses: Pattern 1 ('S S S P P P') -> 3 Pagi
      // 2 nurses: Pattern 2 ('P P S S S S') -> 2 Pagi
      // 2 nurses: Pattern 3 ('S S P P S S') -> 2 Pagi
      // 2 nurses: Pattern 4 ('S S S S P P') -> 2 Pagi
      // Daily Pagi sum:
      // Mon: 3 + 0 + 2 + 0 + 0 = 5
      // Tue: 3 + 0 + 2 + 0 + 0 = 5
      // Wed: 3 + 0 + 0 + 2 + 0 = 5
      // Thu: 0 + 3 + 0 + 2 + 0 = 5
      // Fri: 0 + 3 + 0 + 0 + 2 = 5
      // Sat: 0 + 3 + 0 + 0 + 2 = 5
      const patternSlots: ShiftType[][] = [
        VALID_6DAY_PATTERNS[0], // 0: P P P S S S (3P)
        VALID_6DAY_PATTERNS[0], // 1: P P P S S S (3P)
        VALID_6DAY_PATTERNS[0], // 2: P P P S S S (3P)
        VALID_6DAY_PATTERNS[1], // 3: S S S P P P (3P)
        VALID_6DAY_PATTERNS[1], // 4: S S S P P P (3P)
        VALID_6DAY_PATTERNS[1], // 5: S S S P P P (3P)
        VALID_6DAY_PATTERNS[2], // 6: P P S S S S (2P)
        VALID_6DAY_PATTERNS[2], // 7: P P S S S S (2P)
        VALID_6DAY_PATTERNS[3], // 8: S S P P S S (2P)
        VALID_6DAY_PATTERNS[3], // 9: S S P P S S (2P)
        VALID_6DAY_PATTERNS[4], // 10: S S S S P P (2P)
        VALID_6DAY_PATTERNS[4], // 11: S S S S P P (2P)
      ];

      sortedNurses.forEach((nurse, idx) => {
        weekAssignment.set(nurse.id, [...patternSlots[idx]]);
      });
    } else {
      // CASE 2: General solver for any nurse count, partial weeks, or custom overrides
      // Step A: Initial assignment from candidate pool
      sortedNurses.forEach((nurse, idx) => {
        const overrides = nurseOverrides.get(nurse.id);
        let bestPattern: ShiftType[] | null = null;
        let bestMatchScore = -999;

        // Try candidate patterns that best match nurse overrides and rotation
        const preferredIndices = [
          (idx + weekIdx * 2) % candidatePool.length,
          (idx + 1) % candidatePool.length,
          (idx + 3) % candidatePool.length,
        ];

        for (const pIdx of preferredIndices) {
          const pat = candidatePool[pIdx] || candidatePool[0];
          let match = 0;
          let conflict = false;

          if (overrides) {
            overrides.forEach((ovShift, dIdx) => {
              if (pat[dIdx] === ovShift) {
                match += 10;
              } else {
                conflict = true;
              }
            });
          }

          if (!conflict && match >= bestMatchScore) {
            bestPattern = pat;
            bestMatchScore = match;
          }
        }

        if (!bestPattern) {
          // If no candidate directly matched custom overrides, create a customized block pattern
          const basePattern = [...(candidatePool[idx % candidatePool.length] || candidatePool[0])];
          if (overrides) {
            overrides.forEach((ovShift, dIdx) => {
              basePattern[dIdx] = ovShift;
            });
          }
          bestPattern = basePattern;
        }

        weekAssignment.set(nurse.id, [...bestPattern]);
      });

      // Step B: Quota balancing per day (reach exact morningCount per day)
      for (let dayIdx = 0; dayIdx < numWorkingDays; dayIdx++) {
        let currentMorningNurses = sortedNurses.filter(
          (n) => weekAssignment.get(n.id)![dayIdx] === 'pagi'
        );
        let neededChanges = currentMorningNurses.length - morningCount;

        if (neededChanges > 0) {
          // Too many morning shifts on this day -> change some to siang
          // Pick nurses who don't have override on this day, prioritized by highest cumulative pagiCount
          const candidatesToSiang = sortedNurses
            .filter((n) => {
              const hasOv = nurseOverrides.get(n.id)?.has(dayIdx);
              return !hasOv && weekAssignment.get(n.id)![dayIdx] === 'pagi';
            })
            .sort(
              (a, b) =>
                nurseState[b.id].pagiCount - nurseState[a.id].pagiCount
            );

          for (let c = 0; c < neededChanges && c < candidatesToSiang.length; c++) {
            weekAssignment.get(candidatesToSiang[c].id)![dayIdx] = 'siang';
          }
        } else if (neededChanges < 0) {
          // Too few morning shifts on this day -> change some to pagi
          // Pick nurses who don't have override on this day, prioritized by lowest cumulative pagiCount
          const deficit = Math.abs(neededChanges);
          const candidatesToPagi = sortedNurses
            .filter((n) => {
              const hasOv = nurseOverrides.get(n.id)?.has(dayIdx);
              return !hasOv && weekAssignment.get(n.id)![dayIdx] === 'siang';
            })
            .sort(
              (a, b) =>
                nurseState[a.id].pagiCount - nurseState[b.id].pagiCount
            );

          for (let c = 0; c < deficit && c < candidatesToPagi.length; c++) {
            weekAssignment.get(candidatesToPagi[c].id)![dayIdx] = 'pagi';
          }
        }
      }
    }

    // Step C: STRICT ENFORCEMENT & SAFETY REPAIR PASS FOR 6-DAY WEEKS
    // Checks that NO nurse ever has:
    // 1. P S P S P S L
    // 2. S P S P S P L
    // 3. P P P P P P L
    // 4. S S S S S S L
    if (numWorkingDays === 6) {
      sortedNurses.forEach((nurse) => {
        const shifts = weekAssignment.get(nurse.id)!;
        const check = isForbiddenWeeklySequence(shifts);

        if (check.isForbidden) {
          // Find a replacement block pattern that is completely valid
          // If nurse has all Pagi (P P P P P P), give them 2 or 3 Siang shifts
          if (shifts.every((x) => x === 'pagi')) {
            // Swap days 3, 4, 5 with a nurse who currently has Siang on those days
            for (const dIdx of [3, 4, 5]) {
              if (nurseOverrides.get(nurse.id)?.has(dIdx)) continue;
              const partner = sortedNurses.find(
                (other) =>
                  other.id !== nurse.id &&
                  !nurseOverrides.get(other.id)?.has(dIdx) &&
                  weekAssignment.get(other.id)![dIdx] === 'siang'
              );
              if (partner) {
                weekAssignment.get(nurse.id)![dIdx] = 'siang';
                weekAssignment.get(partner.id)![dIdx] = 'pagi';
              }
            }
          } else if (shifts.every((x) => x === 'siang')) {
            // If nurse has all Siang (S S S S S S), give them 2 or 3 Pagi shifts
            // Swap days 0, 1, 2 with a nurse who currently has Pagi on those days
            for (const dIdx of [0, 1, 2]) {
              if (nurseOverrides.get(nurse.id)?.has(dIdx)) continue;
              const partner = sortedNurses.find(
                (other) =>
                  other.id !== nurse.id &&
                  !nurseOverrides.get(other.id)?.has(dIdx) &&
                  weekAssignment.get(other.id)![dIdx] === 'pagi'
              );
              if (partner) {
                weekAssignment.get(nurse.id)![dIdx] = 'pagi';
                weekAssignment.get(partner.id)![dIdx] = 'siang';
              }
            }
          } else {
            // Alternating patterns (P S P S P S or S P S P S P)
            // Repair into contiguous blocks (e.g. [P, P, P, S, S, S] or [S, S, S, P, P, P])
            const targetBlock: ShiftType[] =
              shifts[0] === 'pagi'
                ? ['pagi', 'pagi', 'pagi', 'siang', 'siang', 'siang']
                : ['siang', 'siang', 'siang', 'pagi', 'pagi', 'pagi'];

            for (let dIdx = 0; dIdx < 6; dIdx++) {
              if (nurseOverrides.get(nurse.id)?.has(dIdx)) continue;
              const desired = targetBlock[dIdx];
              if (weekAssignment.get(nurse.id)![dIdx] !== desired) {
                // Swap with a partner nurse on day dIdx
                const partner = sortedNurses.find(
                  (other) =>
                    other.id !== nurse.id &&
                    !nurseOverrides.get(other.id)?.has(dIdx) &&
                    weekAssignment.get(other.id)![dIdx] === desired
                );
                if (partner) {
                  const temp = weekAssignment.get(nurse.id)![dIdx];
                  weekAssignment.get(nurse.id)![dIdx] = desired;
                  weekAssignment.get(partner.id)![dIdx] = temp;
                }
              }
            }
          }
        }
      });
    }

    // Step D: Commit week schedules and update cumulative state
    workingDays.forEach((day, dayIndex) => {
      sortedNurses.forEach((nurse) => {
        const assignedShift = weekAssignment.get(nurse.id)![dayIndex];
        const key = `${nurse.id}_${day.dateStr}`;

        if (assignedShift === 'pagi') {
          nurseState[nurse.id].pagiCount++;
        } else {
          nurseState[nurse.id].siangCount++;
        }

        if (preserveCustomOverrides && overrideMap.has(key)) {
          newSchedules.push(overrideMap.get(key)!);
        } else {
          newSchedules.push({
            id: key,
            employeeId: nurse.id,
            date: day.dateStr,
            shift: assignedShift,
            note: `${nurse.role === 'pj_shift' ? 'PJ Shift HD' : 'Perawat Pelaksana HD'} - Shift ${assignedShift === 'pagi' ? 'Pagi' : 'Siang'} (${morningCount} Pagi : ${totalNurses - morningCount} Siang)`,
          });
        }
      });
    });
  });

  return newSchedules;
}

/**
 * Urutan Resmi Plotingan Mesin Hemodialisis (Sesuai Denah Fisik & Alur Klinis RS Happy Land):
 * 1. A01 sd A12 (Deretan tunggal sisi A menghadap lorong utama)
 * 2. C01 sd B04 (Lorong tengah sisi dalam: C01-C04 lalu B01-B04)
 * 3. B05 sd C08 (Lorong sisi dinding barat: B05-B09 lalu C05-C08)
 * 4. Area D (D01, D02, D03)
 * 5. Area E (E01, E02)
 * 6. Area F (F01, F02)
 * 7. Ruang Isolasi (ISO 01, ISO 02, ISO 03, ISO 04)
 */
export const CLINICAL_MACHINE_ORDER: string[] = [
  // 1. A01 sd A12
  'A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10', 'A11', 'A12',
  // 2. C01 sd B04 (Lorong tengah sisi dalam)
  'C01', 'C02', 'C03', 'C04', 'B01', 'B02', 'B03', 'B04',
  // 3. B05 sd C08 (Lorong sisi dinding barat)
  'B05', 'B06', 'B07', 'B08', 'B09', 'C05', 'C06', 'C07', 'C08',
  // 4. Area D
  'D01', 'D02', 'D03',
  // 5. Area E
  'E01', 'E02',
  // 6. Area F
  'F01', 'F02',
  // 7. Ruang Isolasi
  'ISO 01', 'ISO 02', 'ISO 03', 'ISO 04',
];

export function normalizeMachineCode(code: string): string {
  if (!code) return '';
  const cleaned = code.trim().toUpperCase();
  const isoMatch = cleaned.match(/^ISO\s*(\d+)$/);
  if (isoMatch) {
    return `ISO ${isoMatch[1].padStart(2, '0')}`;
  }
  const letterMatch = cleaned.match(/^([A-F])\s*(\d+)$/);
  if (letterMatch) {
    return `${letterMatch[1]}${letterMatch[2].padStart(2, '0')}`;
  }
  return cleaned;
}

export function getMachineSortOrder(code: string): number {
  const norm = normalizeMachineCode(code);
  const idx = CLINICAL_MACHINE_ORDER.findIndex(
    (c) => c === norm || c.replace(/\s+/g, '') === norm.replace(/\s+/g, '')
  );
  return idx !== -1 ? idx : 999;
}

/**
 * Auto-assign available operational machines to nurses on duty for a specific date and shift.
 * Aturan Plotingan:
 * 1. Plotingan berurutan sesuai urutan mesin:
 *    A01 sd A12 -> C01 sd B04 -> B05 sd C08 -> Area D -> Area E -> Area F -> Isolasi.
 * 2. Mesin non-aktif (isOff / pemeliharaan) dilewati dan dipertahankan statusnya.
 * 3. Jika ada perawat dengan tugas CITO, mesin isolasi (ISO 01 s/d ISO 04) dialokasikan khusus ke perawat CITO.
 *    Mesin reguler sisanya dibagi secara berurutan dalam blok bersambung (contiguous block) kepada perawat lainnya.
 * 4. Jika tidak ada tugas CITO, seluruh mesin aktif dibagi secara berurutan dalam blok bersambung kepada seluruh staf bertugas (termasuk Karu/PJ Shift).
 */
export function autoAssignMachinesForShift(
  date: string,
  shift: 'pagi' | 'siang',
  nursesOnDuty: UserAccount[],
  machines: HDMachine[],
  existingAssignments: MachineAssignment[] = [],
  specialTasksOnDuty: { nurseId: string; category: string }[] = [],
  randomize: boolean = true
): MachineAssignment[] {
  if (machines.length === 0) {
    return [];
  }

  // Create a map of machine isOff status for this shift from existing assignments
  const offMachineMap = new Map<string, { isOff: boolean; offReason?: string }>();
  existingAssignments
    .filter((a) => a.date === date && a.shift === shift)
    .forEach((a) => {
      if (a.isOff) {
        offMachineMap.set(a.machineId, { isOff: true, offReason: a.offReason });
      }
    });

  // Find nurse(s) assigned to CITO task on this shift
  const citoNurseIds = new Set(
    specialTasksOnDuty
      .filter((t) => t.category === 'cito')
      .map((t) => t.nurseId)
  );

  // Find if any of the nurses on duty has CITO
  const citoNurse = nursesOnDuty.find((n) => citoNurseIds.has(n.id));

  // Urutkan semua mesin secara ketat sesuai alur klinis & denah fisik:
  // A01 s/d A12 -> C01 s/d B04 -> B05 s/d C08 -> Area D -> Area E -> Area F -> Isolasi
  const sortedMachines = [...machines].sort(
    (a, b) => getMachineSortOrder(a.code) - getMachineSortOrder(b.code)
  );

  // Pisahkan mesin aktif (bukan maintenance & bukan OFF)
  const activeIsolationMachines: HDMachine[] = [];
  const activeRegularMachines: HDMachine[] = [];

  sortedMachines.forEach((m) => {
    // Lewati mesin yang dalam status maintenance / perbaikan
    if (m.status === 'maintenance' || m.status === 'perbaikan') return;

    // Lewati mesin yang dimatikan (isOff) pada shift ini
    const offInfo = offMachineMap.get(m.id);
    if (offInfo?.isOff) return;

    const isIsolation =
      m.zone.toLowerCase().includes('isolasi') ||
      m.zone.includes('HBsAg') ||
      m.zone.includes('HCV') ||
      normalizeMachineCode(m.code).startsWith('ISO');

    if (isIsolation) {
      activeIsolationMachines.push(m);
    } else {
      activeRegularMachines.push(m);
    }
  });

  // Helper untuk membagi mesin ke dalam blok-blok bersambung (contiguous) secara adil & merata
  const partitionIntoContiguousClusters = (
    machinesList: HDMachine[],
    numClusters: number
  ): HDMachine[][] => {
    if (numClusters <= 0 || machinesList.length === 0) return [];
    const total = machinesList.length;
    const baseCount = Math.floor(total / numClusters);
    const remainder = total % numClusters;

    const clusters: HDMachine[][] = [];
    let currentIndex = 0;
    for (let i = 0; i < numClusters; i++) {
      const clusterSize = baseCount + (i < remainder ? 1 : 0);
      clusters.push(machinesList.slice(currentIndex, currentIndex + clusterSize));
      currentIndex += clusterSize;
    }
    return clusters;
  };

  // Helper untuk mengacak perawat dengan adil (Fisher-Yates) dan menjamin rotasi bila diklik ulang
  const shuffleNurses = (nursesList: UserAccount[], previousFirstId?: string): UserAccount[] => {
    if (nursesList.length <= 1 || !randomize) {
      return [...nursesList];
    }
    const shuffled = [...nursesList];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Jika diklik ulang dan urutan pertamanya sama persis dengan yang sebelumnya, rotasikan agar hasil acak selalu baru
    if (previousFirstId && shuffled[0].id === previousFirstId && shuffled.length > 1) {
      const swapIdx = 1 + Math.floor(Math.random() * (shuffled.length - 1));
      [shuffled[0], shuffled[swapIdx]] = [shuffled[swapIdx], shuffled[0]];
    }

    return shuffled;
  };

  const assignments: MachineAssignment[] = [];

  if (citoNurse) {
    // 1. HITUNG KUOTA ADIL UNTUK SEMUA PERAWAT
    // Perawat tugas khusus CITO mendapatkan mesin isolasi PLUS mesin di luar area isolasi secara adil
    const totalActiveCount = activeIsolationMachines.length + activeRegularMachines.length;
    const numNurses = nursesOnDuty.length;
    const baseQuota = Math.floor(totalActiveCount / numNurses);
    const remQuota = totalActiveCount % numNurses;

    const citoIdx = nursesOnDuty.findIndex((n) => n.id === citoNurse.id);
    const targetCitoTotal = baseQuota + (citoIdx !== -1 && citoIdx < remQuota ? 1 : 0);
    const isoCount = activeIsolationMachines.length;

    // Perawat CITO juga mendapatkan plot mesin di luar area isolasi:
    let citoRegularCount = 0;
    if (activeRegularMachines.length > 0) {
      if (isoCount === 0) {
        citoRegularCount = targetCitoTotal;
      } else {
        citoRegularCount = Math.max(1, targetCitoTotal - isoCount);
      }
      citoRegularCount = Math.min(citoRegularCount, activeRegularMachines.length);
      const otherNursesCount = nursesOnDuty.filter((n) => n.id !== citoNurse.id).length;
      if (otherNursesCount > 0 && activeRegularMachines.length <= citoRegularCount) {
        citoRegularCount = Math.max(1, activeRegularMachines.length - otherNursesCount);
      }
    }

    // 2. ALOKASIKAN MESIN ISOLASI KE PERAWAT CITO
    activeIsolationMachines.forEach((isoMach) => {
      assignments.push({
        id: `${date}_${shift}_${isoMach.id}`,
        date,
        shift,
        machineId: isoMach.id,
        nurseId: citoNurse.id,
        targetUF: '2.5 L',
        dialyzerType: 'Hi-Flux F7HPS (Isolasi)',
        notes: `Alokasi Khusus CITO & Ruang Isolasi (${citoNurse.name})`,
      });
    });

    // 3. PISAHKAN MESIN REGULER:
    // Mesin reguler paling dekat dengan Ruang Isolasi (Area F, E, D) diberikan ke perawat CITO
    const regularForOthers = activeRegularMachines.slice(
      0,
      activeRegularMachines.length - citoRegularCount
    );
    const regularForCito = activeRegularMachines.slice(
      activeRegularMachines.length - citoRegularCount
    );

    // Alokasikan mesin di luar isolasi untuk perawat CITO
    regularForCito.forEach((mach) => {
      assignments.push({
        id: `${date}_${shift}_${mach.id}`,
        date,
        shift,
        machineId: mach.id,
        nurseId: citoNurse.id,
        targetUF: '2.5 L',
        dialyzerType: 'Hi-Flux F7HPS',
        notes: `Alokasi Perawat CITO di luar Isolasi (${mach.code}) - ${citoNurse.name}`,
      });
    });

    // 4. BAGI MESIN REGULER LAINNYA DALAM BLOK BERSAMBUNG KEPADA PERAWAT BERTUGAS LAINNYA DENGAN ACAK ADIL & MERATA
    const otherNurses = nursesOnDuty.filter((n) => n.id !== citoNurse.id);
    if (otherNurses.length > 0 && regularForOthers.length > 0) {
      const clusters = partitionIntoContiguousClusters(regularForOthers, otherNurses.length);
      
      // Ambil riwayat perawat pertama sebelumnya untuk memastikan pengacakan baru
      const prevFirstOther = existingAssignments.find(
        (a) => a.date === date && a.shift === shift && a.nurseId && a.nurseId !== citoNurse.id
      )?.nurseId;

      const randomizedOtherNurses = shuffleNurses(otherNurses, prevFirstOther);

      clusters.forEach((cluster, clusterIdx) => {
        const assignedNurse = randomizedOtherNurses[clusterIdx] || randomizedOtherNurses[0];
        cluster.forEach((mach) => {
          assignments.push({
            id: `${date}_${shift}_${mach.id}`,
            date,
            shift,
            machineId: mach.id,
            nurseId: assignedNurse.id,
            targetUF: '2.5 L',
            dialyzerType: 'Hi-Flux F7HPS',
            notes: `Plotting Berurutan (${mach.code}) - ${assignedNurse.name}`,
          });
        });
      });
    } else if (otherNurses.length === 0 && regularForOthers.length > 0) {
      regularForOthers.forEach((mach) => {
        assignments.push({
          id: `${date}_${shift}_${mach.id}`,
          date,
          shift,
          machineId: mach.id,
          nurseId: citoNurse.id,
          targetUF: '2.5 L',
          dialyzerType: 'Hi-Flux F7HPS',
          notes: `Plotting Berurutan (${mach.code}) - ${citoNurse.name}`,
        });
      });
    }
  } else {
    // TIDAK ADA PERAWAT CITO:
    // Seluruh mesin aktif (A01-A12 -> C01-B04 -> B05-C08 -> Area D -> Area E -> Area F -> Isolasi)
    // dibagi ke dalam blok-blok bersambung (contiguous) lalu diacak secara adil & merata kepada staf bertugas
    const allActiveOrderedMachines = [...activeRegularMachines, ...activeIsolationMachines].sort(
      (a, b) => getMachineSortOrder(a.code) - getMachineSortOrder(b.code)
    );

    if (nursesOnDuty.length > 0 && allActiveOrderedMachines.length > 0) {
      const clusters = partitionIntoContiguousClusters(allActiveOrderedMachines, nursesOnDuty.length);

      // Ambil perawat pertama sebelumnya untuk memastikan setiap klik ulang menghasilkan variasi baru
      const prevFirstNurse = existingAssignments.find(
        (a) => a.date === date && a.shift === shift && a.nurseId
      )?.nurseId;

      const randomizedNurses = shuffleNurses(nursesOnDuty, prevFirstNurse);

      clusters.forEach((cluster, clusterIdx) => {
        const assignedNurse = randomizedNurses[clusterIdx] || randomizedNurses[0];
        cluster.forEach((mach) => {
          const isIso =
            mach.zone.toLowerCase().includes('isolasi') ||
            normalizeMachineCode(mach.code).startsWith('ISO');

          assignments.push({
            id: `${date}_${shift}_${mach.id}`,
            date,
            shift,
            machineId: mach.id,
            nurseId: assignedNurse.id,
            targetUF: '2.5 L',
            dialyzerType: isIso ? 'Hi-Flux F7HPS (Isolasi)' : 'Hi-Flux F7HPS',
            notes: isIso
              ? `Plotting Berurutan (${mach.code} Isolasi) - ${assignedNurse.name}`
              : `Plotting Berurutan (${mach.code}) - ${assignedNurse.name}`,
          });
        });
      });
    } else {
      allActiveOrderedMachines.forEach((mach) => {
        assignments.push({
          id: `${date}_${shift}_${mach.id}`,
          date,
          shift,
          machineId: mach.id,
          nurseId: undefined,
          targetUF: '2.5 L',
          dialyzerType: 'Hi-Flux F7HPS',
          notes: 'Belum ada staf dialokasikan',
        });
      });
    }
  }

  // Pertahankan mesin yang dimatikan (OFF) pada shift ini
  machines.forEach((m) => {
    const offInfo = offMachineMap.get(m.id);
    if (offInfo?.isOff) {
      assignments.push({
        id: `${date}_${shift}_${m.id}`,
        date,
        shift,
        machineId: m.id,
        isOff: true,
        offReason: offInfo.offReason || 'Dimatikan pada shift ini',
        notes: 'Mesin tidak digunakan pada shift ini (OFF)',
      });
    }
  });

  return assignments;
}

/**
 * Single source of truth to resolve effective shift of any employee for a specific date:
 * 1. Checks Matrik Jadwal (schedules) first for an explicit entry.
 * 2. If no schedule entry exists:
 *    - Sunday: 'libur'
 *    - Kepala Ruang: 'pagi' (Mon-Sat)
 *    - Dokter: 'libur' (manual input only)
 *    - Perawat: deterministic rotation matching generateMonthlySchedule (Pagi < Siang)
 */
export function getEffectiveShiftForEmployee(
  employee: UserAccount,
  dateStr: string,
  schedules: ShiftSchedule[] = [],
  allEmployees: UserAccount[] = []
): ShiftType {
  const sch = schedules.find((s) => s.employeeId === employee.id && s.date === dateStr);
  if (sch) {
    return sch.shift;
  }

  const d = new Date(dateStr + 'T00:00:00');
  if (d.getDay() === 0) return 'libur';
  if (employee.role === 'dokter') return 'libur';
  if (employee.role === 'kepala_ruangan') return 'pagi';

  // Clinical perawat & PJ Shift fallback calculation
  const regularNurses = (allEmployees.length > 0 ? allEmployees : [employee])
    .filter((e) => (e.role === 'perawat' || e.role === 'pj_shift') && e.status === 'aktif');
  const nurseIdx = regularNurses.findIndex((n) => n.id === employee.id);
  if (nurseIdx === -1) return 'siang';

  const totalNurses = regularNurses.length;
  if (totalNurses === 0) return 'pagi';
  const morningCount = totalNurses <= 2 ? 1 : Math.floor((totalNurses - 1) / 2);
  const dayIndex = d.getDate() - 1;
  const rollingOffset = (dayIndex * morningCount) % totalNurses;
  const morningIndices = new Set<number>();
  for (let i = 0; i < morningCount; i++) {
    morningIndices.add((rollingOffset + i) % totalNurses);
  }

  return morningIndices.has(nurseIdx) ? 'pagi' : 'siang';
}

/**
 * Known hospital staff nicknames mapping (RS Happy Land Unit Hemodialisa)
 */
export const KNOWN_NURSE_NICKNAMES: Record<string, string> = {
  'emp-admin': 'Admin',
  'emp-karu': 'Karu',
  'emp-fransisca': 'Fransisca',
  'emp-rizky': 'Rizky',
  'emp-twis': 'Twis',
  'emp-annisa': 'Annisa',
  'emp-haikal': 'Haikal',
  'emp-nita': 'Nita',
  'emp-dea': 'Dea',
  'emp-siswantini': 'Siswantini',
  'emp-ayu-w': 'Ayu W',
  'emp-hari': 'Hari',
  'emp-brilli': 'Brilli',
  'emp-ayu-p': 'Ayu P',
  'emp-aprillia': 'Aprillia',
  'emp-rini': 'Rini',
  'emp-novialita': 'Novialita',
  'emp-khoirudin': 'Khoirudin',
  'emp-reni': 'Reni',
};

export const NAME_TO_NICKNAME: Record<string, string> = {
  'ADMINISTRATOR UNIT HD': 'Admin',
  'ADMIN': 'Admin',
  'FRANSISCA RANI L': 'Fransisca',
  'RIZKY WAHYU A': 'Rizky',
  'TWIS FERTILIANTI P W': 'Twis',
  'ANNISA NUR FAJRI M': 'Annisa',
  'M. HAIKAL MALILANG': 'Haikal',
  'M HAIKAL MALILANG': 'Haikal',
  'NITA RESTIANA': 'Nita',
  'DEA IKA P': 'Dea',
  'SISWANTINI CATUR P': 'Siswantini',
  'AYU WULANDARI': 'Ayu W',
  'HARI ENDAH': 'Hari',
  'Y. BRILLISANTO': 'Brilli',
  'Y BRILLISANTO': 'Brilli',
  'AYU PUSPITA R': 'Ayu P',
  'APRILLIA DWI N': 'Aprillia',
  'RINI WULANDARI': 'Rini',
  'NOVIALITA ARYADI': 'Novialita',
  'M NOR KHOIRUDIN': 'Khoirudin',
  'M. NOR KHOIRUDIN': 'Khoirudin',
  'RENI DWI A': 'Reni',
  'KEPALA RUANG HD': 'Karu',
  'KEPALA RUANGAN HD': 'Karu',
  'KEPALA RUANG': 'Karu',
};

/**
 * Return only the short nickname (nama panggilan) of a nurse / staff member.
 * E.g.:
 * - "FRANSISCA RANI L" -> "Fransisca"
 * - "M. HAIKAL MALILANG" -> "Haikal"
 * - "Y. BRILLISANTO" -> "Brilli"
 * - "AYU WULANDARI" -> "Ayu W"
 * - "AYU PUSPITA R" -> "Ayu P"
 * - "KEPALA RUANG HD" -> "Karu"
 */
export function getNurseNickname(
  nurse?: UserAccount | { name: string; nickname?: string; id?: string } | string | null
): string {
  if (!nurse) return '';

  if (typeof nurse === 'string') {
    const trimmed = nurse.trim();
    if (NAME_TO_NICKNAME[trimmed.toUpperCase()]) return NAME_TO_NICKNAME[trimmed.toUpperCase()];
    const clean = trimmed.replace(/^(dr\.|ns\.|m\.|m\s+|y\.|y\s+|s\.kep)\s+/i, '');
    const parts = clean.split(/\s+/);
    return parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase() : trimmed;
  }

  if (nurse.nickname && nurse.nickname.trim()) {
    return nurse.nickname.trim();
  }

  const nameUpper = (nurse.name || '').trim().toUpperCase();
  if (NAME_TO_NICKNAME[nameUpper]) {
    return NAME_TO_NICKNAME[nameUpper];
  }

  // Derive nickname from the employee's current name
  const cleanName = (nurse.name || '')
    .trim()
    .replace(/^(dr\.|ns\.|m\.|m\s+|y\.|y\s+|s\.kep)\s+/i, '');
  const words = cleanName.split(/\s+/);
  if (words.length > 0 && words[0]) {
    const first = words[0];
    return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  }

  if (nurse.id && KNOWN_NURSE_NICKNAMES[nurse.id]) {
    return KNOWN_NURSE_NICKNAMES[nurse.id];
  }

  return nurse.name || '';
}

/**
 * Detect or retrieve gender of an employee ('L' for Laki-laki, 'P' for Perempuan).
 */
export function getEmployeeGender(emp: UserAccount): 'L' | 'P' {
  if (emp.gender === 'L' || emp.gender === 'P') {
    return emp.gender;
  }
  // Check NIP (in Indonesian civil service / hospital NIP standard, character 15 is 1 for male, 2 for female)
  if (emp.nip && emp.nip.length >= 15) {
    const char15 = emp.nip.charAt(14);
    if (char15 === '1') return 'L';
    if (char15 === '2') return 'P';
  }
  // Fallbacks by ID or Name
  const idLower = (emp.id || '').toLowerCase();
  const nameLower = (emp.name || '').toLowerCase();
  if (
    idLower.includes('haikal') ||
    idLower.includes('rizky') ||
    idLower.includes('brilli') ||
    idLower.includes('khoirudin') ||
    idLower.includes('dr-reza') ||
    idLower.includes('admin') ||
    nameLower.includes('haikal') ||
    nameLower.includes('rizky') ||
    nameLower.includes('brilli') ||
    nameLower.includes('khoirudin') ||
    nameLower.includes('reza') ||
    nameLower.startsWith('m.') ||
    nameLower.startsWith('m ') ||
    nameLower.startsWith('muhammad')
  ) {
    return 'L';
  }
  return 'P';
}

/**
 * Urutan nama perawat pada Jadwal shif:
 * 1. Kepala ruang
 * 2. PJ Shif Laki-laki
 * 3. PJ Shif Perempuan
 * 4. Perawat pelaksana Laki-laki
 * 5. Perawat pelaksana perempuan
 */
export function getNurseScheduleSortPriority(emp: UserAccount): number {
  const gender = getEmployeeGender(emp);

  // 1. Kepala ruang
  if (emp.role === 'kepala_ruangan') {
    return 1;
  }
  // 2. PJ Shif Laki-laki
  if (emp.role === 'pj_shift' && gender === 'L') {
    return 2;
  }
  // 3. PJ Shif Perempuan
  if (emp.role === 'pj_shift' && gender === 'P') {
    return 3;
  }
  // 4. Perawat pelaksana Laki-laki
  if (emp.role === 'perawat' && gender === 'L') {
    return 4;
  }
  // 5. Perawat pelaksana perempuan
  if (emp.role === 'perawat' && gender === 'P') {
    return 5;
  }
  // Other roles (e.g. dokter, admin)
  if (emp.role === 'dokter') {
    return 6;
  }
  return 7;
}

export function getNurseScheduleGroupInfo(emp: UserAccount): {
  groupNumber: number;
  label: string;
  badgeClass: string;
  genderLabel: string;
} {
  const priority = getNurseScheduleSortPriority(emp);
  const gender = getEmployeeGender(emp);
  const genderLabel = gender === 'L' ? 'Laki-laki' : 'Perempuan';

  switch (priority) {
    case 1:
      return {
        groupNumber: 1,
        label: 'Kepala Ruang HD',
        badgeClass: 'bg-amber-100 text-amber-800 border-amber-300',
        genderLabel,
      };
    case 2:
      return {
        groupNumber: 2,
        label: 'PJ Shif (Laki-laki)',
        badgeClass: 'bg-blue-100 text-blue-800 border-blue-300',
        genderLabel: 'Laki-laki',
      };
    case 3:
      return {
        groupNumber: 3,
        label: 'PJ Shif (Perempuan)',
        badgeClass: 'bg-pink-100 text-pink-800 border-pink-300',
        genderLabel: 'Perempuan',
      };
    case 4:
      return {
        groupNumber: 4,
        label: 'Perawat Pelaksana (L)',
        badgeClass: 'bg-sky-100 text-sky-800 border-sky-300',
        genderLabel: 'Laki-laki',
      };
    case 5:
      return {
        groupNumber: 5,
        label: 'Perawat Pelaksana (P)',
        badgeClass: 'bg-rose-100 text-rose-800 border-rose-300',
        genderLabel: 'Perempuan',
      };
    default:
      return {
        groupNumber: priority,
        label: emp.role === 'dokter' ? 'Dokter HD' : emp.role,
        badgeClass: 'bg-slate-100 text-slate-700 border-slate-300',
        genderLabel,
      };
  }
}

/**
 * Sort nurses according to the 5 mandatory priority rules:
 * 1. Kepala ruang
 * 2. PJ Shif Laki-laki
 * 3. PJ Shif Perempuan
 * 4. Perawat pelaksana Laki-laki
 * 5. Perawat pelaksana perempuan
 */
export function sortNursesByShiftScheduleOrder(employees: UserAccount[]): UserAccount[] {
  return [...employees].sort((a, b) => {
    const pA = getNurseScheduleSortPriority(a);
    const pB = getNurseScheduleSortPriority(b);
    if (pA !== pB) {
      return pA - pB;
    }
    // Secondary sort: Alphabetical by Name
    return a.name.localeCompare(b.name, 'id');
  });
}


