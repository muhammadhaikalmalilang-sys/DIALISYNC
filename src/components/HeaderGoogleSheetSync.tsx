import React, { useState } from 'react';
import { 
  FileSpreadsheet, 
  ArrowDownToLine, 
  ArrowUpFromLine, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink, 
  Settings2, 
  Check, 
  Copy, 
  HelpCircle,
  X,
  Radio,
  Calendar,
  Layers,
  Sparkles
} from 'lucide-react';
import { 
  ShiftSchedule, 
  HDMachine, 
  MachineAssignment, 
  UserAccount, 
  AppSettings,
  DoctorShiftDuty
} from '../types';
import { GoogleSheetsService } from '../domain/GoogleSheetsService';
import { 
  prepareSyncPayload, 
  pushToGoogleSheets, 
  pullFromGoogleSheets, 
  applyPulledDataToApp 
} from '../utils/googleSheetsSyncHelper';
import { GoogleScriptGuideModal } from './GoogleScriptGuideModal';

interface HeaderGoogleSheetSyncProps {
  schedules: ShiftSchedule[];
  employees: UserAccount[];
  machines: HDMachine[];
  machineAssignments: MachineAssignment[];
  settings: AppSettings;
  onUpdateSettings: (newSettings: AppSettings) => void;
  onUpdateSchedule: (newSchedules: ShiftSchedule[]) => void;
  onUpdateMachineAssignments: (newAssignments: MachineAssignment[]) => void;
  onUpdateEmployees: (newEmployees: UserAccount[]) => void;
  onUpdateMachines?: (newMachines: HDMachine[]) => void;
  operationalDate?: string;
  canEdit?: boolean;
}

export const HeaderGoogleSheetSync: React.FC<HeaderGoogleSheetSyncProps> = ({
  schedules,
  employees,
  machines,
  machineAssignments,
  settings,
  onUpdateSettings,
  onUpdateSchedule,
  onUpdateMachineAssignments,
  onUpdateEmployees,
  operationalDate,
  canEdit = true,
}) => {
  // Determine active month (e.g. "2026-09")
  const defaultMonth = operationalDate
    ? operationalDate.substring(0, 7)
    : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

  const [selectedMonth, setSelectedMonth] = useState<string>(defaultMonth);
  const [isPulling, setIsPulling] = useState<boolean>(false);
  const [isPushing, setIsPushing] = useState<boolean>(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [showPullConfirmModal, setShowPullConfirmModal] = useState<boolean>(false);
  const [showGuideModal, setShowGuideModal] = useState<boolean>(false);
  const [pulledDataPreview, setPulledDataPreview] = useState<any>(null);

  // Form states for config
  const [editWebhookUrl, setEditWebhookUrl] = useState<string>(settings?.googleSheetWebhookUrl || '');
  const [editSpreadsheetUrl, setEditSpreadsheetUrl] = useState<string>(settings?.googleSpreadsheetIdOrUrl || '');
  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ isSuccess: boolean; message: string } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  };

  const hasWebhook = Boolean(settings?.googleSheetWebhookUrl?.trim());
  const hasSpreadsheet = Boolean(settings?.googleSpreadsheetIdOrUrl?.trim());
  const isConfigured = hasWebhook || hasSpreadsheet;

  // Format month for display (e.g. "September 2026")
  const [yearStr, monthStr] = selectedMonth.split('-');
  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  const monthIdx = parseInt(monthStr, 10) - 1;
  const displayMonthName = `${monthNames[monthIdx] || 'Bulan'} ${yearStr}`;

  // Count active schedules for this month
  const currentMonthSchedulesCount = schedules.filter((s) => s.date.startsWith(selectedMonth)).length;

  // Handler: Kirim Data ke Google Sheets (Push)
  const handlePushData = async () => {
    if (!settings?.googleSheetWebhookUrl?.trim()) {
      setShowConfigModal(true);
      showToast('Konfigurasikan Webhook URL Google Apps Script terlebih dahulu.', 'info');
      return;
    }

    setIsPushing(true);
    try {
      const payloadData = prepareSyncPayload(
        schedules,
        employees,
        machines,
        machineAssignments,
        selectedMonth
      );

      const result = await pushToGoogleSheets(settings, payloadData);
      if (result.isSuccess) {
        const updatedSettings: AppSettings = {
          ...settings,
          lastSyncTimestamp: Date.now(),
          lastSyncStatus: `Terkirim: ${displayMonthName} (${payloadData.domainMonthlyAssignments.length} jadwal)`,
        };
        onUpdateSettings(updatedSettings);
        showToast(`Berhasil mengirim ${payloadData.domainMonthlyAssignments.length} jadwal shift bulan ${displayMonthName} ke Google Sheets!`, 'success');
      } else {
        showToast(result.message, 'error');
      }
    } catch (err: any) {
      showToast('Terjadi kesalahan saat mengirim: ' + (err?.message || err), 'error');
    } finally {
      setIsPushing(false);
    }
  };

  // Handler: Tarik Data dari Google Sheets (Pull)
  const handleInitiatePull = async () => {
    if (!isConfigured) {
      setShowConfigModal(true);
      showToast('Masukkan Webhook URL atau Link Google Spreadsheet terlebih dahulu.', 'info');
      return;
    }

    setIsPulling(true);
    try {
      const result = await pullFromGoogleSheets(settings, selectedMonth, employees, machines);
      if (result.isSuccess && result.assignments.length > 0) {
        setPulledDataPreview({
          assignments: result.assignments,
          nurses: result.nurses,
          machines: result.machines,
          month: selectedMonth,
          message: result.message,
        });
        setShowPullConfirmModal(true);
      } else if (result.isSuccess) {
        showToast(result.message || 'Tidak ada jadwal ditemukan untuk bulan yang dipilih.', 'info');
      } else {
        showToast(result.message, 'error');
      }
    } catch (err: any) {
      showToast('Gagal menarik data dari Google Sheets: ' + (err?.message || err), 'error');
    } finally {
      setIsPulling(false);
    }
  };

  // Apply pulled data after confirmation
  const handleConfirmApplyPulledData = () => {
    if (!pulledDataPreview || !pulledDataPreview.assignments) return;

    const { updatedSchedules, updatedMachineAssignments, updatedEmployees } = applyPulledDataToApp(
      pulledDataPreview.assignments,
      pulledDataPreview.month,
      schedules,
      employees,
      machines,
      machineAssignments
    );

    onUpdateSchedule(updatedSchedules);
    onUpdateMachineAssignments(updatedMachineAssignments);
    onUpdateEmployees(updatedEmployees);

    const updatedSettings: AppSettings = {
      ...settings,
      lastSyncTimestamp: Date.now(),
      lastSyncStatus: `Ditarik: ${displayMonthName} (${pulledDataPreview.assignments.length} jadwal)`,
    };
    onUpdateSettings(updatedSettings);

    showToast(`Berhasil menerapkan ${pulledDataPreview.assignments.length} jadwal shift & alokasi mesin dari Google Sheets!`, 'success');
    setShowPullConfirmModal(false);
    setPulledDataPreview(null);
  };

  // Test connection
  const handleTestConnection = async () => {
    if (!editWebhookUrl.trim()) {
      setTestResult({ isSuccess: false, message: 'Silakan isi Webhook URL terlebih dahulu.' });
      return;
    }
    setIsTestingConnection(true);
    setTestResult(null);
    try {
      const result = await GoogleSheetsService.testConnection(editWebhookUrl.trim());
      setTestResult({
        isSuccess: result.isSuccess,
        message: result.message + (result.latencyMs ? ` (${result.latencyMs}ms)` : ''),
      });
    } catch (err: any) {
      setTestResult({
        isSuccess: false,
        message: 'Gagal terhubung: ' + (err?.message || err),
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  // Save config
  const handleSaveConfig = () => {
    const updated: AppSettings = {
      ...settings,
      googleSheetWebhookUrl: editWebhookUrl.trim(),
      googleSpreadsheetIdOrUrl: editSpreadsheetUrl.trim(),
    };
    onUpdateSettings(updated);
    setShowConfigModal(false);
    showToast('Pengaturan Google Sheets berhasil disimpan.', 'success');
  };

  return (
    <div id="header-google-sheet-sync-bar" className="w-full bg-slate-900/90 text-white border-b border-teal-800/40 backdrop-blur-md px-3 sm:px-6 py-2 transition-all">
      <div className="max-w-[1680px] mx-auto flex flex-wrap items-center justify-between gap-2.5">
        {/* Left: Google Sheets Status & Month selector */}
        <div className="flex items-center space-x-2 sm:space-x-3 overflow-x-auto scrollbar-none py-0.5">
          <div className="flex items-center space-x-2 bg-emerald-950/70 border border-emerald-700/60 px-2.5 py-1 rounded-xl shrink-0 shadow-2xs">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="flex flex-col">
              <div className="flex items-center space-x-1.5 leading-none">
                <span className="text-[11px] sm:text-xs font-bold text-emerald-300">Google Sheets Sync</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              </div>
              <span className="text-[9px] text-emerald-200/80 font-medium mt-0.5 hidden xs:inline">
                Integrasi 2-Arah Otomatis
              </span>
            </div>
          </div>

          {/* Month Selector */}
          <div className="flex items-center space-x-1.5 bg-slate-800/90 border border-slate-700/80 px-2.5 py-1 rounded-xl shrink-0">
            <Calendar className="w-3.5 h-3.5 text-teal-400 shrink-0" />
            <span className="text-[10px] text-slate-300 font-semibold hidden sm:inline">Bulan:</span>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-transparent text-teal-200 text-xs font-bold border-none outline-hidden cursor-pointer p-0"
              title="Pilih bulan untuk menarik atau mengirim jadwal"
            />
          </div>

          {/* Sync status info badge */}
          {settings?.lastSyncTimestamp ? (
            <div className="hidden lg:flex items-center space-x-1.5 text-[11px] text-slate-300 bg-slate-800/60 px-2.5 py-1 rounded-xl border border-slate-700/60">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="truncate max-w-[220px]">
                {settings.lastSyncStatus || `Sinkron: ${new Date(settings.lastSyncTimestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB`}
              </span>
            </div>
          ) : (
            <div className="hidden lg:flex items-center space-x-1 text-[11px] text-amber-300/90 bg-amber-950/40 px-2.5 py-1 rounded-xl border border-amber-800/50">
              <span>Matriks Siap: {currentMonthSchedulesCount} jadwal</span>
            </div>
          )}
        </div>

        {/* Right: Actions (Tarik Data, Kirim Data, Buka Sheet, Pengaturan) */}
        <div className="flex items-center space-x-1.5 sm:space-x-2 ml-auto shrink-0">
          {/* TARIK DATA BUTTON */}
          <button
            id="btn-sync-pull-google-sheets"
            onClick={handleInitiatePull}
            disabled={isPulling || isPushing}
            className="px-3 py-1.5 bg-gradient-to-r from-teal-700 to-cyan-700 hover:from-teal-600 hover:to-cyan-600 text-white font-bold rounded-xl text-xs shadow-xs flex items-center space-x-1.5 transition active:scale-95 cursor-pointer disabled:opacity-50 min-h-[34px] border border-teal-500/30"
            title="Tarik data jadwal, perawat, dan alokasi mesin terbaru dari Google Sheets"
          >
            {isPulling ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-200 shrink-0" />
            ) : (
              <ArrowDownToLine className="w-3.5 h-3.5 text-cyan-200 shrink-0" />
            )}
            <span>{isPulling ? 'Menarik...' : 'Tarik Data'}</span>
          </button>

          {/* KIRIM DATA BUTTON */}
          {canEdit && (
            <button
              id="btn-sync-push-google-sheets"
              onClick={handlePushData}
              disabled={isPulling || isPushing}
              className="px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl text-xs shadow-xs flex items-center space-x-1.5 transition active:scale-95 cursor-pointer disabled:opacity-50 min-h-[34px] border border-emerald-400/30"
              title="Kirim seluruh matriks jadwal, alokasi mesin, dan daftar perawat bulan ini ke Google Sheets"
            >
              {isPushing ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-100 shrink-0" />
              ) : (
                <ArrowUpFromLine className="w-3.5 h-3.5 text-emerald-100 shrink-0" />
              )}
              <span>{isPushing ? 'Mengirim...' : 'Kirim Data'}</span>
            </button>
          )}

          {/* LINK TO OPEN SPREADSHEET */}
          {settings?.googleSpreadsheetIdOrUrl && (
            <a
              href={settings.googleSpreadsheetIdOrUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center space-x-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-xs font-semibold border border-slate-700 transition min-h-[34px]"
              title="Buka Spreadsheet di Tab Baru"
            >
              <ExternalLink className="w-3.5 h-3.5 text-teal-400 shrink-0" />
              <span className="hidden md:inline">Buka Sheet</span>
            </a>
          )}

          {/* CONFIGURATION / GUIDE BUTTON */}
          <button
            onClick={() => setShowConfigModal(true)}
            className="p-1.5 sm:px-2.5 sm:py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-teal-300 rounded-xl text-xs font-semibold border border-slate-700 transition flex items-center space-x-1 min-h-[34px] cursor-pointer"
            title="Konfigurasi URL Webhook & Spreadsheet Google"
          >
            <Settings2 className="w-4 h-4 text-teal-400 shrink-0" />
            <span className="hidden md:inline">Pengaturan</span>
          </button>
        </div>
      </div>

      {/* Floating Notification Toast */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-3 duration-200 max-w-md">
          <div
            className={`px-4 py-3 rounded-2xl shadow-2xl border flex items-center space-x-3 text-xs font-semibold ${
              notification.type === 'success'
                ? 'bg-emerald-950 text-emerald-100 border-emerald-500/50 shadow-emerald-950/50'
                : notification.type === 'error'
                ? 'bg-rose-950 text-rose-100 border-rose-500/50 shadow-rose-950/50'
                : 'bg-slate-900 text-cyan-100 border-cyan-500/50 shadow-slate-950/50'
            }`}
          >
            {notification.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
            {notification.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
            {notification.type === 'info' && <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />}
            <p className="flex-1 leading-snug">{notification.message}</p>
            <button
              onClick={() => setNotification(null)}
              className="text-slate-400 hover:text-white text-xs font-bold p-1 cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* MODAL: KONFIRMASI PENERAPAN DATA SETELAH TARIK DARI GOOGLE SHEETS */}
      {showPullConfirmModal && pulledDataPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-teal-50/70 dark:bg-teal-950/40">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-teal-100 dark:bg-teal-900/60 text-teal-700 dark:text-teal-300 rounded-xl">
                  <ArrowDownToLine className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">
                    Terapkan Data dari Google Sheets
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Bulan Target: <span className="font-bold text-teal-600 dark:text-teal-400">{displayMonthName}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowPullConfirmModal(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs overflow-y-auto">
              <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700/60 space-y-2">
                <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  <span>Ringkasan Data yang Ditemukan:</span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1 text-slate-700 dark:text-slate-300">
                  <div className="bg-white dark:bg-slate-850 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-400 block text-[10px]">Total Jadwal Shift:</span>
                    <span className="text-sm font-black text-teal-600 dark:text-teal-400">
                      {pulledDataPreview.assignments.length} Sif
                    </span>
                  </div>
                  <div className="bg-white dark:bg-slate-850 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-400 block text-[10px]">Alokasi Mesin:</span>
                    <span className="text-sm font-black text-indigo-600 dark:text-indigo-400">
                      {pulledDataPreview.assignments.filter((a: any) => a.assignedMachineIds?.length > 0).length} Petugas Terisi
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                  Catatan: Jadwal shift untuk bulan {displayMonthName} di aplikasi akan diperbarui sesuai data terbaru dari Google Sheets.
                </p>
              </div>

              {/* Sample list of first 5 items */}
              <div>
                <span className="font-bold text-slate-700 dark:text-slate-300 block mb-1.5">
                  Sampel Cuplikan Jadwal:
                </span>
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {pulledDataPreview.assignments.slice(0, 5).map((a: any, i: number) => (
                    <div
                      key={i}
                      className="p-2 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/80 dark:border-slate-700/60 flex items-center justify-between text-[11px]"
                    >
                      <div className="truncate pr-2">
                        <span className="font-bold text-slate-800 dark:text-slate-200">{a.nurseName}</span>
                        <span className="text-slate-400 text-[10px] ml-2 font-mono">{a.date}</span>
                      </div>
                      <div className="flex items-center space-x-1.5 shrink-0">
                        <span className="px-2 py-0.5 rounded-md font-bold text-[10px] bg-teal-100 dark:bg-teal-900/60 text-teal-800 dark:text-teal-300">
                          {a.shiftType}
                        </span>
                        {a.assignedMachineIds?.length > 0 && (
                          <span className="px-1.5 py-0.5 rounded-md font-semibold text-[10px] bg-indigo-100 dark:bg-indigo-900/60 text-indigo-800 dark:text-indigo-300">
                            {a.assignedMachineIds.length} Mesin
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {pulledDataPreview.assignments.length > 5 && (
                    <p className="text-center text-[10px] text-slate-400 pt-1">
                      ...dan {pulledDataPreview.assignments.length - 5} baris jadwal lainnya.
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end space-x-2 bg-slate-50/70 dark:bg-slate-850">
              <button
                onClick={() => setShowPullConfirmModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer"
              >
                Batal
              </button>
              <button
                onClick={handleConfirmApplyPulledData}
                className="px-4 py-2 text-xs font-bold bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white rounded-xl shadow-md transition flex items-center space-x-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Terapkan Sekarang</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: PENGATURAN GOOGLE SHEETS & TES KONEKSI */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 w-full max-w-xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[92vh]">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-850">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 rounded-xl">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base">
                    Pengaturan Sinkronisasi Google Sheets
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Konfigurasi integrasi 2-arah untuk menarik dan mengirim jadwal
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowConfigModal(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs overflow-y-auto">
              {/* Webhook Apps Script URL */}
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                  Google Apps Script Webhook URL (2-Arah Kirim & Tarik):
                </label>
                <input
                  type="url"
                  value={editWebhookUrl}
                  onChange={(e) => setEditWebhookUrl(e.target.value)}
                  placeholder="https://script.google.com/macros/s/.../exec"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-500 focus:outline-hidden"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Webhook memungkinkan pengiriman matriks kalender, format warna sif, dan penarikan data jadwal otomatis tanpa kuota.
                </p>
              </div>

              {/* Test Connection Button */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleTestConnection}
                  disabled={isTestingConnection || !editWebhookUrl.trim()}
                  className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl border border-slate-300 dark:border-slate-700 transition flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isTestingConnection ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-teal-500" />
                  ) : (
                    <Radio className="w-3.5 h-3.5 text-teal-500" />
                  )}
                  <span>{isTestingConnection ? 'Menguji...' : 'Uji Koneksi Webhook'}</span>
                </button>

                <button
                  onClick={() => setShowGuideModal(true)}
                  className="px-3 py-1.5 bg-teal-50 dark:bg-teal-950/60 hover:bg-teal-100 dark:hover:bg-teal-900/60 text-teal-700 dark:text-teal-300 font-bold rounded-xl border border-teal-200 dark:border-teal-800 transition flex items-center space-x-1.5 cursor-pointer"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                  <span>Lihat Kode Apps Script</span>
                </button>
              </div>

              {/* Test Result Message */}
              {testResult && (
                <div
                  className={`p-3 rounded-xl border text-xs font-semibold flex items-center space-x-2 ${
                    testResult.isSuccess
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700'
                      : 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 border-rose-300 dark:border-rose-700'
                  }`}
                >
                  {testResult.isSuccess ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                  )}
                  <span>{testResult.message}</span>
                </div>
              )}

              {/* Spreadsheet URL */}
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-bold mb-1">
                  URL Google Spreadsheet (Tautan Akses Cepat):
                </label>
                <input
                  type="url"
                  value={editSpreadsheetUrl}
                  onChange={(e) => setEditSpreadsheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-500 focus:outline-hidden"
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Digunakan untuk membuka langsung lembar kerja Google Sheets via tombol header dan sebagai sumber cadangan penarikan jadwal.
                </p>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end space-x-2 bg-slate-50/70 dark:bg-slate-850">
              <button
                onClick={() => setShowConfigModal(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition cursor-pointer"
              >
                Batal
              </button>
              <button
                onClick={handleSaveConfig}
                className="px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md transition flex items-center space-x-1.5 cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Simpan Pengaturan</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* APPS SCRIPT GUIDE MODAL */}
      <GoogleScriptGuideModal
        isOpen={showGuideModal}
        onClose={() => setShowGuideModal(false)}
      />
    </div>
  );
};
