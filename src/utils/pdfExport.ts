import jsPDF from 'jspdf';
import autoTable, { RowInput } from 'jspdf-autotable';
import { UserAccount, ShiftSchedule } from '../types';
import { getEffectiveShiftForEmployee, getNurseScheduleGroupInfo } from './scheduler';

export interface GeneratePdfOptions {
  year: number;
  month: number; // 0-indexed
  monthName: string;
  days: Array<{
    dateStr: string;
    date: Date;
    dayName: string;
    isSunday: boolean;
  }>;
  nurseStaff: UserAccount[];
  doctorStaff: UserAccount[];
  schedules: ShiftSchedule[];
  allEmployees: UserAccount[];
}

/**
 * Builds a jsPDF document for the monthly hemodialysis shift schedule.
 */
export function buildSchedulePdf(options: GeneratePdfOptions): jsPDF {
  const {
    year,
    month,
    monthName,
    days,
    nurseStaff,
    doctorStaff,
    schedules,
    allEmployees,
  } = options;

  // A4 Landscape: 297mm x 210mm
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // 1. HEADER KOP SURAT
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.text('INSTALASI HEMODIALISA - JADWAL DINAS SHIFT BULANAN', pageWidth / 2, 14, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(13, 148, 136); // teal-600
  doc.text(`PERIODE: ${monthName.toUpperCase()} ${year}`, pageWidth / 2, 20, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139); // slate-500
  const printedDateStr = new Date().toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  doc.text(`Dicetak pada: ${printedDateStr} | Sistem Penjadwalan Unit Hemodialisa`, pageWidth - 14, 25, { align: 'right' });
  doc.text('Ket: P = Pagi (07.00 - 14.00) | S = Siang (13.00 - 20.00) | L = Libur (Minggu)', 14, 25);

  // 2. DATA TABLE NURSES
  // Table Columns: No, Nama & Kelompok, [Day 1 .. Day N], P, S, Tot
  const headDays = days.map((d) => `${d.date.getDate()}`);
  const headers = [['No', 'Nama Perawat & Kelompok', ...headDays, 'P', 'S', 'Tot']];

  // Calculate stats
  const dailyPagiCount: number[] = new Array(days.length).fill(0);
  const dailySiangCount: number[] = new Array(days.length).fill(0);

  const tableRows: RowInput[] = nurseStaff.map((nurse, index) => {
    const groupInfo = getNurseScheduleGroupInfo(nurse);
    let totalP = 0;
    let totalS = 0;

    const dayShifts = days.map((d, dIdx) => {
      const shift = getEffectiveShiftForEmployee(nurse, d.dateStr, schedules, allEmployees);
      if (d.isSunday) {
        return 'L';
      }
      if (shift === 'pagi') {
        totalP++;
        dailyPagiCount[dIdx]++;
        return 'P';
      }
      if (shift === 'siang') {
        totalS++;
        dailySiangCount[dIdx]++;
        return 'S';
      }
      if (shift === 'pagi_siang') {
        totalP++;
        totalS++;
        dailyPagiCount[dIdx]++;
        dailySiangCount[dIdx]++;
        return 'P/S';
      }
      return 'L';
    });

    const displayName = `${nurse.nickname || nurse.name.split(' ')[0]} (#${groupInfo.groupNumber})`;
    return [
      String(index + 1),
      displayName,
      ...dayShifts,
      String(totalP),
      String(totalS),
      String(totalP + totalS),
    ];
  });

  // Footer rows:
  // Row 1: Total Pagi
  const totalPagiRow: RowInput = [
    '',
    'Total Pagi',
    ...dailyPagiCount.map((cnt, idx) => (days[idx].isSunday ? '-' : String(cnt))),
    String(dailyPagiCount.reduce((a, b) => a + b, 0)),
    '-',
    String(dailyPagiCount.reduce((a, b) => a + b, 0)),
  ];

  // Row 2: Total Siang
  const totalSiangRow: RowInput = [
    '',
    'Total Siang',
    ...dailySiangCount.map((cnt, idx) => (days[idx].isSunday ? '-' : String(cnt))),
    '-',
    String(dailySiangCount.reduce((a, b) => a + b, 0)),
    String(dailySiangCount.reduce((a, b) => a + b, 0)),
  ];

  tableRows.push(totalPagiRow);
  tableRows.push(totalSiangRow);

  // Column width calculations
  // Total available width = 297 - 28 = 269mm
  // No: 7mm, Name: 38mm, Stats (P, S, Tot): 8mm each = 24mm
  // Remaining for days (28-31 days): (269 - 7 - 38 - 24) = 200mm / 31 = ~6.4mm per day
  const dayColWidth = Math.max(5.5, (pageWidth - 28 - 7 - 38 - 24) / days.length);

  autoTable(doc, {
    startY: 28,
    margin: { left: 14, right: 14 },
    head: headers,
    body: tableRows,
    theme: 'grid',
    styles: {
      fontSize: 6.5,
      cellPadding: 1,
      halign: 'center',
      valign: 'middle',
      textColor: [30, 41, 59], // slate-800
      lineColor: [203, 213, 225], // slate-300
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: [15, 118, 110], // teal-700
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 6.5,
      halign: 'center',
    },
    columnStyles: {
      0: { cellWidth: 7, halign: 'center' }, // No
      1: { cellWidth: 38, halign: 'left', fontStyle: 'bold' }, // Name
      // Remaining columns will be sized dynamically
    },
    didParseCell: (data) => {
      const colIndex = data.column.index;
      const rowIndex = data.row.index;
      const isHeader = data.section === 'head';

      // Days columns: index 2 to 2 + days.length - 1
      if (colIndex >= 2 && colIndex < 2 + days.length) {
        const dayIdx = colIndex - 2;
        const day = days[dayIdx];

        if (day?.isSunday) {
          if (isHeader) {
            data.cell.styles.fillColor = [225, 29, 72]; // rose-600
            data.cell.styles.textColor = [255, 255, 255];
          } else {
            data.cell.styles.fillColor = [255, 228, 230]; // rose-100
            data.cell.styles.textColor = [190, 18, 60];
            data.cell.styles.fontStyle = 'bold';
          }
        } else if (!isHeader && rowIndex < nurseStaff.length) {
          const val = data.cell.raw;
          if (val === 'P') {
            data.cell.styles.fillColor = [209, 250, 229]; // emerald-100
            data.cell.styles.textColor = [6, 95, 70];
            data.cell.styles.fontStyle = 'bold';
          } else if (val === 'S') {
            data.cell.styles.fillColor = [252, 231, 243]; // pink-100
            data.cell.styles.textColor = [157, 23, 77];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      }

      // Summary columns (P, S, Tot)
      if (colIndex >= 2 + days.length) {
        if (!isHeader) {
          data.cell.styles.fontStyle = 'bold';
          if (colIndex === 2 + days.length) {
            data.cell.styles.fillColor = [240, 253, 244]; // emerald-50
            data.cell.styles.textColor = [6, 95, 70];
          } else if (colIndex === 2 + days.length + 1) {
            data.cell.styles.fillColor = [253, 242, 248]; // pink-50
            data.cell.styles.textColor = [157, 23, 77];
          } else {
            data.cell.styles.fillColor = [241, 245, 249]; // slate-100
            data.cell.styles.textColor = [15, 23, 42];
          }
        }
      }

      // Footer Rows (Total Pagi, Total Siang)
      if (!isHeader && rowIndex >= nurseStaff.length) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [248, 250, 252];
        if (colIndex === 1) {
          data.cell.styles.halign = 'right';
          data.cell.styles.textColor = rowIndex === nurseStaff.length ? [6, 95, 70] : [157, 23, 77];
        }
      }
    },
  });

  // 3. DOCTOR ASSIGNMENT SUMMARY
  // Check position after Nurse table
  const finalY = (doc as any).lastAutoTable?.finalY || 140;

  // If there's not enough room for signatures and doctor table, add page
  let docStartY = finalY + 6;
  if (docStartY > pageHeight - 50) {
    doc.addPage();
    docStartY = 14;
  }

  // Doctor Table Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(30, 58, 138); // blue-900
  doc.text('PENUGASAN DOKTER JAGA HEMODIALISA (1 Dokter per Shif):', 14, docStartY);

  // Group Doctor assignments by operational days (excluding Sunday)
  const doctorTableRows: RowInput[] = days
    .filter((d) => !d.isSunday)
    .slice(0, 16) // compact display in PDF
    .map((day) => {
      const pSch = schedules.find((s) => s.date === day.dateStr && (s.shift === 'pagi' || s.shift === 'pagi_siang'));
      const sSch = schedules.find((s) => s.date === day.dateStr && (s.shift === 'siang' || s.shift === 'pagi_siang'));
      
      const docPagi = pSch ? doctorStaff.find((d) => d.id === pSch.employeeId) : null;
      const docSiang = sSch ? doctorStaff.find((d) => d.id === sSch.employeeId) : null;

      return [
        `${day.dayName}, ${day.date.getDate()} ${monthName.slice(0, 3)}`,
        docPagi ? docPagi.name : 'Dr. Reza (DPJP)',
        docSiang ? docSiang.name : 'Dr. Paramitha (Jaga)',
      ];
    });

  // Second column of dates (Day 17 onwards) to save space side-by-side
  const doctorTableRowsCol2: RowInput[] = days
    .filter((d) => !d.isSunday)
    .slice(16)
    .map((day) => {
      const pSch = schedules.find((s) => s.date === day.dateStr && (s.shift === 'pagi' || s.shift === 'pagi_siang'));
      const sSch = schedules.find((s) => s.date === day.dateStr && (s.shift === 'siang' || s.shift === 'pagi_siang'));
      
      const docPagi = pSch ? doctorStaff.find((d) => d.id === pSch.employeeId) : null;
      const docSiang = sSch ? doctorStaff.find((d) => d.id === sSch.employeeId) : null;

      return [
        `${day.dayName}, ${day.date.getDate()} ${monthName.slice(0, 3)}`,
        docPagi ? docPagi.name : 'Dr. Reza (DPJP)',
        docSiang ? docSiang.name : 'Dr. Paramitha (Jaga)',
      ];
    });

  // Render Doctor table side-by-side or compact
  autoTable(doc, {
    startY: docStartY + 2,
    margin: { left: 14, right: pageWidth / 2 + 5 },
    head: [['Tanggal & Hari', 'Dokter Shif Pagi', 'Dokter Shif Siang']],
    body: doctorTableRows,
    theme: 'grid',
    styles: {
      fontSize: 6,
      cellPadding: 0.8,
      halign: 'left',
      lineColor: [226, 232, 240],
    },
    headStyles: {
      fillColor: [37, 99, 235], // blue-600
      textColor: [255, 255, 255],
      fontSize: 6,
      fontStyle: 'bold',
    },
  });

  const docFinalY1 = (doc as any).lastAutoTable?.finalY || docStartY + 25;

  if (doctorTableRowsCol2.length > 0) {
    autoTable(doc, {
      startY: docStartY + 2,
      margin: { left: pageWidth / 2 + 5, right: 14 },
      head: [['Tanggal & Hari', 'Dokter Shif Pagi', 'Dokter Shif Siang']],
      body: doctorTableRowsCol2,
      theme: 'grid',
      styles: {
        fontSize: 6,
        cellPadding: 0.8,
        halign: 'left',
        lineColor: [226, 232, 240],
      },
      headStyles: {
        fillColor: [37, 99, 235], // blue-600
        textColor: [255, 255, 255],
        fontSize: 6,
        fontStyle: 'bold',
      },
    });
  }

  const docFinalY2 = (doc as any).lastAutoTable?.finalY || docStartY + 25;
  const afterDocY = Math.max(docFinalY1, docFinalY2);

  // 4. SIGNATURE SECTION
  let signY = afterDocY + 8;
  if (signY > pageHeight - 35) {
    doc.addPage();
    signY = 20;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85); // slate-700

  // Left: Kepala Ruangan Hemodialisa
  doc.text('Mengetahui,', 40, signY);
  doc.text('Kepala Ruangan Hemodialisa', 40, signY + 4);
  doc.setFont('helvetica', 'bold');
  const karu = nurseStaff.find((n) => n.role === 'kepala_ruangan') || { name: 'Ns. Haikal, S.Kep', nip: '198503152010011005' };
  doc.text(karu.name, 40, signY + 22);
  doc.setFont('helvetica', 'normal');
  doc.text(`NIP. ${karu.nip}`, 40, signY + 26);

  // Right: Dokter Penanggung Jawab HD
  const rightX = pageWidth - 80;
  doc.text(`${monthName} ${year}`, rightX, signY);
  doc.text('Dokter Penanggung Jawab Hemodialisa', rightX, signY + 4);
  doc.setFont('helvetica', 'bold');
  const dpjp = doctorStaff.find((d) => d.id === 'emp-dr-reza') || doctorStaff[0] || { name: 'dr. Reza Sp.PD-KGH', nip: '197908122005011003' };
  doc.text(dpjp.name, rightX, signY + 22);
  doc.setFont('helvetica', 'normal');
  doc.text(`NIP. ${dpjp.nip}`, rightX, signY + 26);

  return doc;
}

/**
 * Downloads the PDF directly to the user's computer.
 */
export function exportScheduleToPdf(options: GeneratePdfOptions): void {
  const doc = buildSchedulePdf(options);
  const fileName = `Jadwal_Shift_HD_${options.monthName}_${options.year}.pdf`;
  doc.save(fileName);
}

/**
 * Opens the PDF in a new tab or triggers direct browser printing.
 */
export function printScheduleDirectly(options: GeneratePdfOptions): void {
  const doc = buildSchedulePdf(options);
  const blobUrl = doc.output('bloburl');
  const printWindow = window.open(blobUrl, '_blank');
  if (printWindow) {
    printWindow.focus();
  } else {
    // If popup blocked, fallback to standard window.print()
    window.print();
  }
}
