import React, { useState } from 'react';
import { UserAccount, UserRole } from '../types';
import { 
  getEmployeeGender, 
  sortNursesByShiftScheduleOrder, 
  getNurseScheduleGroupInfo 
} from '../utils/scheduler';
import { storage } from '../utils/storage';
import { 
  Users, 
  UserPlus, 
  Shield, 
  UserCheck, 
  Stethoscope, 
  Activity, 
  Edit3, 
  Trash2, 
  KeyRound, 
  Search, 
  X, 
  Check, 
  Lock, 
  Phone, 
  Mail, 
  FileText,
  AlertCircle
} from 'lucide-react';

interface EmployeeManagementViewProps {
  currentUser: UserAccount;
  employees: UserAccount[];
  onUpdateEmployees: (employees: UserAccount[]) => void;
  onDeleteEmployee?: (employeeId: string) => void;
}

export const EmployeeManagementView: React.FC<EmployeeManagementViewProps> = ({
  currentUser,
  employees,
  onUpdateEmployees,
  onDeleteEmployee,
}) => {
  const [activeTableTab, setActiveTableTab] = useState<'all' | 'admin' | 'dokter' | 'perawat'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<UserAccount | null>(null);
  const [resetPasswordEmp, setResetPasswordEmp] = useState<UserAccount | null>(null);
  const [deleteTargetEmp, setDeleteTargetEmp] = useState<UserAccount | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Employee Form
  const [form, setForm] = useState<Partial<UserAccount>>({
    name: '',
    username: '',
    password: '',
    role: 'perawat',
    nip: '',
    phone: '',
    email: '',
    status: 'aktif',
    specialization: '',
  });

  const [formError, setFormError] = useState('');

  // Separate employee categories with search filtering
  const searchFilter = (emp: UserAccount) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      emp.name.toLowerCase().includes(q) ||
      emp.username.toLowerCase().includes(q) ||
      emp.nip.includes(q) ||
      (emp.nickname && emp.nickname.toLowerCase().includes(q)) ||
      (emp.specialization && emp.specialization.toLowerCase().includes(q))
    );
  };

  const adminEmployees = employees.filter((e) => e.role === 'admin' && searchFilter(e));
  const doctorEmployees = employees.filter((e) => e.role === 'dokter' && searchFilter(e));
  const nurseEmployees = sortNursesByShiftScheduleOrder(
    employees.filter(
      (e) =>
        (e.role === 'kepala_ruangan' || e.role === 'pj_shift' || e.role === 'perawat') &&
        searchFilter(e)
    )
  );

  const totalAdmins = employees.filter((e) => e.role === 'admin').length;
  const totalDoctors = employees.filter((e) => e.role === 'dokter').length;
  const totalNurses = employees.filter(
    (e) => e.role === 'kepala_ruangan' || e.role === 'pj_shift' || e.role === 'perawat'
  ).length;

  // Handle Save (Add / Edit)
  const handleSaveEmployee = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!form.name || !form.username || !form.role) {
      setFormError('Nama lengkap, username, dan peran wajib diisi.');
      return;
    }

    const usernameClean = form.username.trim().toLowerCase();

    if (editingEmployee) {
      // Check duplicate username with others
      const dup = employees.find(
        (e) => e.username.toLowerCase() === usernameClean && e.id !== editingEmployee.id
      );
      if (dup) {
        setFormError('Username tersebut sudah digunakan oleh staf lain.');
        return;
      }

      const cleanNickname = form.nickname?.trim();
      const updatedEmp: UserAccount = {
        id: editingEmployee.id,
        name: form.name.trim(),
        ...(cleanNickname ? { nickname: cleanNickname } : {}),
        gender: (form.gender as 'L' | 'P') || getEmployeeGender({ name: form.name, nip: form.nip || '', id: editingEmployee.id } as any),
        username: usernameClean,
        password: form.password && form.password.trim() ? form.password.trim() : editingEmployee.password,
        role: form.role as UserRole,
        nip: (form.nip || '').trim(),
        phone: (form.phone || '').trim(),
        email: (form.email || '').trim() || `${usernameClean}@hospital.id`,
        status: (form.status as 'aktif' | 'nonaktif') || 'aktif',
        specialization: (form.specialization || '').trim(),
        createdAt: editingEmployee.createdAt || new Date().toISOString().substring(0, 10),
      };

      const updated = employees.map((emp) =>
        emp.id === editingEmployee.id ? updatedEmp : emp
      );

      // If updating currently logged in user, keep session in sync
      if (editingEmployee.id === currentUser.id) {
        storage.setCurrentUser(updatedEmp);
      }

      onUpdateEmployees(updated);
      setEditingEmployee(null);
      setShowAddModal(false);
      showToast(`Data akun ${updatedEmp.name} berhasil disimpan & informasi lama diperbarui.`);
    } else {
      // Add new
      if (!form.password) {
        setFormError('Kata sandi awal wajib ditentukan untuk akun baru.');
        return;
      }

      const dup = employees.find((e) => e.username.toLowerCase() === usernameClean);
      if (dup) {
        setFormError('Username tersebut sudah terdaftar.');
        return;
      }

      const cleanNickname = form.nickname?.trim();
      const newEmp: UserAccount = {
        id: `emp-${Date.now()}`,
        name: form.name.trim(),
        ...(cleanNickname ? { nickname: cleanNickname } : {}),
        gender: (form.gender as 'L' | 'P') || getEmployeeGender({ name: form.name, nip: form.nip || '', id: '' } as any),
        username: usernameClean,
        password: form.password.trim(),
        role: form.role as UserRole,
        nip: (form.nip || '').trim() || `NIP-${Date.now().toString().substring(7)}`,
        phone: (form.phone || '').trim(),
        email: (form.email || '').trim() || `${usernameClean}@hospital.id`,
        status: (form.status as 'aktif' | 'nonaktif') || 'aktif',
        specialization: (form.specialization || '').trim(),
        createdAt: new Date().toISOString().substring(0, 10),
      };

      onUpdateEmployees([...employees, newEmp]);
      setShowAddModal(false);
      showToast(`Akun ${newEmp.name} berhasil ditambahkan.`);
    }

    setForm({
      name: '',
      username: '',
      password: '',
      role: 'perawat',
      gender: 'L',
      nip: '',
      phone: '',
      email: '',
      status: 'aktif',
      specialization: '',
    });
  };

  // Handle Reset Password
  const handleExecuteResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPasswordEmp || !newPassword) return;

    const updated = employees.map((emp) =>
      emp.id === resetPasswordEmp.id ? { ...emp, password: newPassword } : emp
    );

    onUpdateEmployees(updated);
    const targetName = resetPasswordEmp.name;
    setResetPasswordEmp(null);
    setNewPassword('');
    showToast(`Kata sandi akun ${targetName} berhasil diperbarui.`);
  };

  // Handle Toggle Active/Inactive
  const handleToggleStatus = (emp: UserAccount) => {
    if (emp.id === currentUser.id) {
      showToast('Anda tidak dapat menonaktifkan akun administrator sendiri.', 'error');
      return;
    }
    const nextStatus = emp.status === 'aktif' ? 'nonaktif' : 'aktif';
    const updated = employees.map((e) =>
      e.id === emp.id ? { ...e, status: nextStatus as 'aktif' | 'nonaktif' } : e
    );
    onUpdateEmployees(updated);
    showToast(`Status akun ${emp.name} diubah menjadi ${nextStatus.toUpperCase()}.`);
  };

  // Handle Request Delete (opens confirmation modal)
  const handleDeleteEmployee = (emp: UserAccount) => {
    if (emp.id === currentUser.id) {
      showToast('Tidak dapat menghapus akun administrator yang sedang login.', 'error');
      return;
    }
    setDeleteTargetEmp(emp);
  };

  // Handle Execute Delete
  const handleConfirmDeleteEmployee = () => {
    if (!deleteTargetEmp) return;
    const targetName = deleteTargetEmp.name;
    const targetId = deleteTargetEmp.id;
    if (onDeleteEmployee) {
      onDeleteEmployee(targetId);
    } else {
      const updated = employees.filter((e) => e.id !== targetId);
      onUpdateEmployees(updated);
    }
    setDeleteTargetEmp(null);
    showToast(`Akun ${targetName} berhasil dihapus dari sistem.`);
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return { label: 'Administrator', bg: 'bg-purple-100 text-purple-800 border-purple-200' };
      case 'kepala_ruangan':
      case 'karu':
        return { label: 'Kepala Ruang', bg: 'bg-amber-100 text-amber-800 border-amber-200' };
      case 'pj_shift':
        return { label: 'PJ Shift HD', bg: 'bg-emerald-100 text-emerald-800 border-emerald-200' };
      case 'dokter':
        return { label: 'Dokter HD', bg: 'bg-blue-100 text-blue-800 border-blue-200' };
      case 'perawat':
      case 'nurse':
      default:
        return { label: 'Perawat Mahir HD', bg: 'bg-teal-100 text-teal-800 border-teal-200' };
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Header */}
      <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
            <h2 className="text-base sm:text-lg font-extrabold text-slate-900">
              Manajemen Akun Karyawan &amp; Hak Akses
            </h2>
            <span className="text-[11px] sm:text-xs px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-800 font-semibold border border-purple-200">
              Hak Administrator
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            Kelola data staf medis hemodialisa, atur username, password, NIP, peran/jabatan, serta status aktivasi login akun
          </p>
        </div>

        <button
          onClick={() => {
            setEditingEmployee(null);
            setForm({
              name: '',
              username: '',
              password: '',
              role: 'perawat',
              nip: '',
              phone: '',
              email: '',
              status: 'aktif',
              specialization: '',
            });
            setFormError('');
            setShowAddModal(true);
          }}
          className="w-full sm:w-auto px-4 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-xl text-xs font-bold shadow-xs flex items-center justify-center space-x-1.5 transition active:scale-95 cursor-pointer min-h-[40px]"
        >
          <UserPlus className="w-4 h-4 shrink-0" />
          <span>Tambah Karyawan Baru</span>
        </button>
      </div>

      {/* Stats Counter Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
        <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] sm:text-xs text-slate-500 font-semibold">Total Karyawan</div>
          <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1">{employees.length}</div>
          <div className="text-[10px] text-teal-600 mt-0.5">Semua Tim HD</div>
        </div>

        <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] sm:text-xs text-slate-500 font-semibold">Kepala Ruangan</div>
          <div className="text-xl sm:text-2xl font-black text-amber-700 mt-1">
            {employees.filter((e) => e.role === 'kepala_ruangan').length}
          </div>
          <div className="text-[10px] text-amber-600 mt-0.5">Shift Pagi Tetap</div>
        </div>

        <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] sm:text-xs text-slate-500 font-semibold">PJ Shift HD</div>
          <div className="text-xl sm:text-2xl font-black text-emerald-700 mt-1">
            {employees.filter((e) => e.role === 'pj_shift').length}
          </div>
          <div className="text-[10px] text-emerald-600 mt-0.5">PJ Shift</div>
        </div>

        <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="text-[11px] sm:text-xs text-slate-500 font-semibold">Dokter HD</div>
          <div className="text-xl sm:text-2xl font-black text-blue-700 mt-1">
            {employees.filter((e) => e.role === 'dokter').length}
          </div>
          <div className="text-[10px] text-blue-600 mt-0.5">PJ Klinis HD</div>
        </div>

        <div className="bg-white p-3.5 sm:p-4 rounded-xl border border-slate-200 shadow-xs col-span-2 sm:col-span-1">
          <div className="text-[11px] sm:text-xs text-slate-500 font-semibold">Perawat Pelaksana</div>
          <div className="text-xl sm:text-2xl font-black text-teal-700 mt-1">
            {employees.filter((e) => e.role === 'perawat').length}
          </div>
          <div className="text-[10px] text-teal-600 mt-0.5">Pelaksana Sesi 1 &amp; 2</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-2xl p-3.5 sm:p-4 border border-slate-200 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold text-slate-700 mr-1 hidden sm:inline-block">Tampilan Tabel:</span>
          <button
            onClick={() => setActiveTableTab('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition min-h-[32px] cursor-pointer flex items-center gap-1.5 ${
              activeTableTab === 'all'
                ? 'bg-purple-700 text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <span>Semua (3 Tabel Terpisah)</span>
            <span className="px-1.5 py-0.2 bg-white/20 rounded-md text-[10px]">{employees.length}</span>
          </button>
          <button
            onClick={() => setActiveTableTab('admin')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition min-h-[32px] cursor-pointer flex items-center gap-1.5 ${
              activeTableTab === 'admin'
                ? 'bg-purple-800 text-white shadow-2xs'
                : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200/60'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Tabel Admin</span>
            <span className="px-1.5 py-0.2 bg-purple-200 text-purple-900 rounded-md text-[10px] font-bold">{totalAdmins}</span>
          </button>
          <button
            onClick={() => setActiveTableTab('dokter')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition min-h-[32px] cursor-pointer flex items-center gap-1.5 ${
              activeTableTab === 'dokter'
                ? 'bg-blue-600 text-white shadow-2xs'
                : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200/60'
            }`}
          >
            <Stethoscope className="w-3.5 h-3.5" />
            <span>Tabel Dokter</span>
            <span className="px-1.5 py-0.2 bg-blue-200 text-blue-900 rounded-md text-[10px] font-bold">{totalDoctors}</span>
          </button>
          <button
            onClick={() => setActiveTableTab('perawat')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition min-h-[32px] cursor-pointer flex items-center gap-1.5 ${
              activeTableTab === 'perawat'
                ? 'bg-teal-600 text-white shadow-2xs'
                : 'bg-teal-50 text-teal-700 hover:bg-teal-100 border border-teal-200/60'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Tabel Perawat</span>
            <span className="px-1.5 py-0.2 bg-teal-200 text-teal-900 rounded-md text-[10px] font-bold">{totalNurses}</span>
          </button>
        </div>

        <div className="relative w-full md:w-auto">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari nama, NIP, username..."
            className="w-full md:w-64 pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-purple-500 min-h-[34px]"
          />
        </div>
      </div>

      <div className="space-y-6">
        {/* ========================================================= */}
        {/* 1. TABEL AKUN ADMINISTRATOR */}
        {/* ========================================================= */}
        {(activeTableTab === 'all' || activeTableTab === 'admin') && (
          <div className="bg-white rounded-2xl border border-purple-200/80 shadow-xs overflow-hidden">
            <div className="px-4 py-3.5 bg-gradient-to-r from-purple-50 via-purple-50/40 to-white border-b border-purple-100 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center shadow-xs">
                  <Shield className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-900 text-sm">Tabel Akun Administrator &amp; Manajemen</h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
                      {adminEmployees.length} Akun Terdaftar
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Pengelola hak akses, konfigurasi sistem, dan manajemen data rumah sakit
                  </p>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-purple-50/50 border-b border-purple-100 text-slate-700 font-bold">
                  <tr>
                    <th className="p-3 w-12 text-center">No</th>
                    <th className="p-3">Nama Administrator &amp; NIP</th>
                    <th className="p-3">Username Login</th>
                    <th className="p-3">Kata Sandi</th>
                    <th className="p-3">Hak Akses Sistem</th>
                    <th className="p-3">Kontak &amp; Email</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-purple-50">
                  {adminEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-slate-400">
                        Tidak ada akun administrator yang cocok dengan filter pencarian.
                      </td>
                    </tr>
                  ) : (
                    adminEmployees.map((emp, idx) => {
                      const isCurrent = emp.id === currentUser.id;
                      return (
                        <tr key={emp.id} className="hover:bg-purple-50/40 transition">
                          <td className="p-3 text-center text-slate-400 font-mono text-[11px]">
                            {idx + 1}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center space-x-2.5">
                              <div className="w-8 h-8 rounded-lg bg-purple-900 text-white font-bold flex items-center justify-center text-xs">
                                {emp.name.substring(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                                  <span>{emp.name}</span>
                                  {isCurrent && (
                                    <span className="text-[9px] px-1.5 py-0.2 bg-purple-100 text-purple-800 rounded font-semibold border border-purple-200">
                                      Anda
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-400 font-mono">
                                  NIP: {emp.nip} {emp.nickname ? `• (${emp.nickname})` : ''}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="p-3 font-mono text-purple-950 font-bold">
                            @{emp.username}
                          </td>
                          <td className="p-3 font-mono text-slate-600">
                            <span className="bg-slate-100 px-2 py-0.5 rounded text-[11px] border border-slate-200">
                              {emp.password}
                            </span>
                          </td>
                          <td className="p-3">
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 border border-purple-200 inline-flex items-center gap-1">
                              <Shield className="w-3 h-3" />
                              Administrator
                            </span>
                          </td>
                          <td className="p-3 text-[11px] text-slate-600">
                            <div>{emp.phone || '-'}</div>
                            <div className="text-slate-400">{emp.email || '-'}</div>
                          </td>
                          <td className="p-3">
                            <button
                              onClick={() => handleToggleStatus(emp)}
                              className={`px-2 py-0.5 rounded-full font-bold text-[10px] uppercase transition cursor-pointer ${
                                emp.status === 'aktif'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                              title="Ubah status aktif akun"
                            >
                              {emp.status === 'aktif' ? 'Aktif' : 'Nonaktif'}
                            </button>
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end space-x-1">
                              <button
                                onClick={() => {
                                  setResetPasswordEmp(emp);
                                  setNewPassword('');
                                }}
                                className="p-1.5 text-slate-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition"
                                title="Reset Password"
                              >
                                <KeyRound className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  setEditingEmployee(emp);
                                  setForm({
                                    name: emp.name,
                                    nickname: emp.nickname || '',
                                    gender: emp.gender || getEmployeeGender(emp),
                                    username: emp.username,
                                    password: '',
                                    role: emp.role,
                                    nip: emp.nip,
                                    phone: emp.phone,
                                    email: emp.email,
                                    status: emp.status,
                                    specialization: emp.specialization || '',
                                  });
                                  setFormError('');
                                  setShowAddModal(true);
                                }}
                                className="p-1.5 text-slate-500 hover:text-purple-700 hover:bg-purple-50 rounded-lg transition"
                                title="Edit Akun"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* 2. TABEL AKUN DOKTER HEMODIALISA */}
        {/* ========================================================= */}
        {(activeTableTab === 'all' || activeTableTab === 'dokter') && (
          <div className="bg-white rounded-2xl border border-blue-200/80 shadow-xs overflow-hidden">
            <div className="px-4 py-3.5 bg-gradient-to-r from-blue-50 via-blue-50/40 to-white border-b border-blue-100 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
                  <Stethoscope className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-900 text-sm">Tabel Akun Dokter Hemodialisa</h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                      {doctorEmployees.length} Dokter Terdaftar
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Dokter Penanggung Jawab Pelayanan (DPJP) &amp; Dokter Jaga Unit HD (Bisa Dinas Pagi, Siang, atau 2 Shift)
                  </p>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-blue-50/50 border-b border-blue-100 text-slate-700 font-bold">
                  <tr>
                    <th className="p-3 w-12 text-center">No</th>
                    <th className="p-3">Nama Dokter &amp; NIP</th>
                    <th className="p-3">Nama Singkat / Panggilan</th>
                    <th className="p-3">Username Login</th>
                    <th className="p-3">Kata Sandi</th>
                    <th className="p-3">Spesialisasi &amp; Tugas Jaga</th>
                    <th className="p-3">Kontak &amp; Email</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-blue-50">
                  {doctorEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-6 text-center text-slate-400">
                        Tidak ada akun dokter yang cocok dengan filter pencarian.
                      </td>
                    </tr>
                  ) : (
                    doctorEmployees.map((emp, idx) => {
                      const isCurrent = emp.id === currentUser.id;
                      return (
                        <tr key={emp.id} className="hover:bg-blue-50/40 transition">
                          <td className="p-3 text-center text-slate-400 font-mono text-[11px]">
                            {idx + 1}
                          </td>
                          <td className="p-3">
                            <div className="flex items-center space-x-2.5">
                              <div className="w-8 h-8 rounded-lg bg-blue-700 text-white font-bold flex items-center justify-center text-xs">
                                {emp.name.substring(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                                  <span>{emp.name}</span>
                                  {isCurrent && (
                                    <span className="text-[9px] px-1.5 py-0.2 bg-blue-100 text-blue-800 rounded font-semibold border border-blue-200">
                                      Anda
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-400 font-mono">
                                  NIP: {emp.nip}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="p-3 font-semibold text-blue-900">
                            {emp.nickname ? (
                              <span className="px-2 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-blue-800 text-[11px]">
                                {emp.nickname}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic text-[11px]">-</span>
                            )}
                          </td>
                          <td className="p-3 font-mono text-blue-950 font-bold">
                            @{emp.username}
                          </td>
                          <td className="p-3 font-mono text-slate-600">
                            <span className="bg-slate-100 px-2 py-0.5 rounded text-[11px] border border-slate-200">
                              {emp.password}
                            </span>
                          </td>
                          <td className="p-3">
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200 inline-flex items-center gap-1">
                              <Stethoscope className="w-3 h-3" />
                              {emp.specialization || 'Dokter Jaga Hemodialisa'}
                            </span>
                          </td>
                          <td className="p-3 text-[11px] text-slate-600">
                            <div>{emp.phone || '-'}</div>
                            <div className="text-slate-400">{emp.email || '-'}</div>
                          </td>
                          <td className="p-3">
                            <button
                              onClick={() => handleToggleStatus(emp)}
                              className={`px-2 py-0.5 rounded-full font-bold text-[10px] uppercase transition cursor-pointer ${
                                emp.status === 'aktif'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                              title="Ubah status aktif akun"
                            >
                              {emp.status === 'aktif' ? 'Aktif' : 'Nonaktif'}
                            </button>
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end space-x-1">
                              <button
                                onClick={() => {
                                  setResetPasswordEmp(emp);
                                  setNewPassword('');
                                }}
                                className="p-1.5 text-slate-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition"
                                title="Reset Password"
                              >
                                <KeyRound className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  setEditingEmployee(emp);
                                  setForm({
                                    name: emp.name,
                                    nickname: emp.nickname || '',
                                    gender: emp.gender || getEmployeeGender(emp),
                                    username: emp.username,
                                    password: '',
                                    role: emp.role,
                                    nip: emp.nip,
                                    phone: emp.phone,
                                    email: emp.email,
                                    status: emp.status,
                                    specialization: emp.specialization || '',
                                  });
                                  setFormError('');
                                  setShowAddModal(true);
                                }}
                                className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition"
                                title="Edit Akun"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              {!isCurrent && (
                                <button
                                  onClick={() => handleDeleteEmployee(emp)}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                                  title="Hapus Akun Dokter"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* 3. TABEL AKUN PERAWAT HEMODIALISA */}
        {/* ========================================================= */}
        {(activeTableTab === 'all' || activeTableTab === 'perawat') && (
          <div className="bg-white rounded-2xl border border-teal-200/80 shadow-xs overflow-hidden">
            <div className="px-4 py-3.5 bg-gradient-to-r from-teal-50 via-teal-50/40 to-white border-b border-teal-100 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-teal-600 text-white flex items-center justify-center shadow-xs">
                  <Activity className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-900 text-sm">Tabel Akun Perawat Hemodialisa</h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-800 border border-teal-200">
                      {nurseEmployees.length} Perawat Terdaftar
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Kepala Ruangan, PJ Shift, dan Perawat Pelaksana HD (Diurutkan sesuai hierarki matrik jadwal resmi)
                  </p>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-teal-50/50 border-b border-teal-100 text-slate-700 font-bold">
                  <tr>
                    <th className="p-3">Urutan Matrik</th>
                    <th className="p-3">Nama Perawat &amp; NIP</th>
                    <th className="p-3">Nama Panggilan</th>
                    <th className="p-3">Username Login</th>
                    <th className="p-3">Kata Sandi</th>
                    <th className="p-3">Peran / Jabatan</th>
                    <th className="p-3">Kontak &amp; Email</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-teal-50">
                  {nurseEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-6 text-center text-slate-400">
                        Tidak ada akun perawat yang cocok dengan filter pencarian.
                      </td>
                    </tr>
                  ) : (
                    nurseEmployees.map((emp) => {
                      const badge = getRoleBadge(emp.role);
                      const groupInfo = getNurseScheduleGroupInfo(emp);
                      const isCurrent = emp.id === currentUser.id;

                      return (
                        <tr key={emp.id} className="hover:bg-teal-50/40 transition">
                          <td className="p-3">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${groupInfo.badgeClass}`}>
                              #{groupInfo.groupNumber} {groupInfo.label}
                            </span>
                          </td>
                          <td className="p-3">
                            <div className="flex items-center space-x-2.5">
                              <div className="w-8 h-8 rounded-lg bg-teal-800 text-white font-bold flex items-center justify-center text-xs">
                                {emp.name.substring(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                                  <span>{emp.name}</span>
                                  {isCurrent && (
                                    <span className="text-[9px] px-1.5 py-0.2 bg-teal-100 text-teal-800 rounded font-semibold border border-teal-200">
                                      Anda
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-400 font-mono">
                                  NIP: {emp.nip}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="p-3 font-semibold text-teal-900">
                            {emp.nickname ? (
                              <span className="px-2 py-0.5 rounded-md bg-teal-50 border border-teal-200 text-teal-800 text-[11px]">
                                {emp.nickname}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic text-[11px]">-</span>
                            )}
                          </td>
                          <td className="p-3 font-mono text-teal-950 font-bold">
                            @{emp.username}
                          </td>
                          <td className="p-3 font-mono text-slate-600">
                            <span className="bg-slate-100 px-2 py-0.5 rounded text-[11px] border border-slate-200">
                              {emp.password}
                            </span>
                          </td>
                          <td className="p-3">
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${badge.bg}`}>
                              {badge.label}
                            </span>
                          </td>
                          <td className="p-3 text-[11px] text-slate-600">
                            <div>{emp.phone || '-'}</div>
                            <div className="text-slate-400">{emp.email || '-'}</div>
                          </td>
                          <td className="p-3">
                            <button
                              onClick={() => handleToggleStatus(emp)}
                              className={`px-2 py-0.5 rounded-full font-bold text-[10px] uppercase transition cursor-pointer ${
                                emp.status === 'aktif'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                              title="Ubah status aktif akun"
                            >
                              {emp.status === 'aktif' ? 'Aktif' : 'Nonaktif'}
                            </button>
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end space-x-1">
                              <button
                                onClick={() => {
                                  setResetPasswordEmp(emp);
                                  setNewPassword('');
                                }}
                                className="p-1.5 text-slate-500 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition"
                                title="Reset Password Karyawan"
                              >
                                <KeyRound className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  setEditingEmployee(emp);
                                  setForm({
                                    name: emp.name,
                                    nickname: emp.nickname || '',
                                    gender: emp.gender || getEmployeeGender(emp),
                                    username: emp.username,
                                    password: '',
                                    role: emp.role,
                                    nip: emp.nip,
                                    phone: emp.phone,
                                    email: emp.email,
                                    status: emp.status,
                                    specialization: emp.specialization || '',
                                  });
                                  setFormError('');
                                  setShowAddModal(true);
                                }}
                                className="p-1.5 text-slate-500 hover:text-teal-700 hover:bg-teal-50 rounded-lg transition"
                                title="Edit Data Karyawan"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              {!isCurrent && (
                                <button
                                  onClick={() => handleDeleteEmployee(emp)}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                                  title="Hapus Akun Karyawan"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Add / Edit Employee Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <Users className="w-4 h-4 text-purple-700" />
                <span>
                  {editingEmployee ? 'Edit Data Akun Karyawan' : 'Tambah Akun Karyawan Baru'}
                </span>
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveEmployee} className="mt-4 space-y-3.5">
              {/* 1. Nama Lengkap beserta Gelar */}
              <div>
                <label className="block font-bold text-slate-800 mb-1">
                  1. Nama Lengkap beserta Gelar <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.name || ''}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Contoh: FRANSISCA RANI L, S.Kep., Ns. / dr. Reza Rizki Ramadhan"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-teal-500 font-medium text-slate-900 bg-white"
                />
              </div>

              {/* 2. Nama Panggilan */}
              <div>
                <label className="block font-bold text-slate-800 mb-1 flex items-center justify-between">
                  <span>2. Nama Panggilan <span className="text-rose-500">*</span></span>
                  <span className="text-[10px] text-teal-600 font-semibold bg-teal-50 px-2 py-0.5 rounded-full border border-teal-200">
                    Ditampilkan di Dashboard HD &amp; Plotting Mesin
                  </span>
                </label>
                <input
                  type="text"
                  value={form.nickname || ''}
                  onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                  placeholder="Contoh: Fransisca / dr. Reza / Haikal"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-teal-500 font-medium text-slate-900 bg-white"
                />
              </div>

              {/* 3. Username login & 4. Peran/Jabatan */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-800 mb-1">
                    3. Username Login <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-slate-400 font-mono font-bold">@</span>
                    <input
                      type="text"
                      required
                      value={form.username || ''}
                      onChange={(e) => setForm({ ...form, username: e.target.value })}
                      placeholder="fransisca"
                      className="w-full pl-7 pr-3 py-2 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-teal-500 font-mono text-slate-900 bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-800 mb-1">
                    4. Peran / Jabatan <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={form.role || 'perawat'}
                    onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-teal-500 font-bold text-slate-800 bg-white cursor-pointer"
                  >
                    <option value="perawat">Perawat Mahir HD</option>
                    <option value="pj_shift">Penanggung Jawab Shift (PJ Shift / PJ Shif)</option>
                    <option value="kepala_ruangan">Kepala Ruangan HD</option>
                    <option value="dokter">Dokter Hemodialisa</option>
                    <option value="admin">Administrator Unit</option>
                  </select>
                </div>
              </div>

              {/* Jenis Kelamin & Status Akun */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-800 mb-1">
                    5. Jenis Kelamin (Urutan Matrik) <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={form.gender || 'L'}
                    onChange={(e) => setForm({ ...form, gender: e.target.value as 'L' | 'P' })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-teal-500 font-bold text-slate-800 bg-white cursor-pointer"
                  >
                    <option value="L">Laki-laki (L)</option>
                    <option value="P">Perempuan (P)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-800 mb-1">
                    6. Status Akun <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={form.status || 'aktif'}
                    onChange={(e) => setForm({ ...form, status: e.target.value as 'aktif' | 'nonaktif' })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-teal-500 font-bold text-slate-800 bg-white cursor-pointer"
                  >
                    <option value="aktif">Aktif (Dinas &amp; Login)</option>
                    <option value="nonaktif">Nonaktif (Cuti / Non-aktif)</option>
                  </select>
                </div>
              </div>

              {/* 7. Nomor HP */}
              <div>
                <label className="block font-bold text-slate-800 mb-1 flex items-center justify-between">
                  <span>7. Nomor HP / WhatsApp</span>
                  <span className="text-[10px] text-slate-400">Untuk koordinasi klinis &amp; kirim jadwal</span>
                </label>
                <div className="relative flex items-center">
                  <Phone className="w-3.5 h-3.5 absolute left-3 text-slate-400" />
                  <input
                    type="text"
                    value={form.phone || ''}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="Contoh: 0812-3456-7890"
                    className="w-full pl-8 pr-3 py-2 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-teal-500 text-slate-900 bg-white"
                  />
                </div>
              </div>

              {/* 8. Kata Sandi */}
              <div>
                <label className="block font-bold text-slate-800 mb-1 flex items-center justify-between">
                  <span>
                    8. {editingEmployee ? 'Ubah Kata Sandi (Password)' : 'Kata Sandi Awal (Password)'}{' '}
                    {!editingEmployee && <span className="text-rose-500">*</span>}
                  </span>
                  {editingEmployee && (
                    <span className="text-[10px] text-slate-400">Kosongkan jika tidak ingin diubah</span>
                  )}
                </label>
                <input
                  type="text"
                  required={!editingEmployee}
                  value={form.password || ''}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={editingEmployee ? 'Ketik kata sandi baru untuk mengganti...' : 'Minimal 6 karakter'}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-teal-500 text-slate-900 bg-white"
                />
              </div>

              {/* Informasi Tambahan (Opsional) */}
              <div className="pt-2 border-t border-slate-100">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Nomor Induk Pegawai (NIP):
                    </label>
                    <input
                      type="text"
                      value={form.nip || ''}
                      onChange={(e) => setForm({ ...form, nip: e.target.value })}
                      placeholder="19920110..."
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-teal-500 text-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Keahlian / Sertifikasi HD:
                    </label>
                    <input
                      type="text"
                      value={form.specialization || ''}
                      onChange={(e) => setForm({ ...form, specialization: e.target.value })}
                      placeholder="Contoh: Kanulasi CDL / Sertifikasi HD"
                      className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-teal-500 text-slate-800"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between pt-3 border-t border-slate-100">
                {editingEmployee && editingEmployee.id !== currentUser.id ? (
                  <button
                    type="button"
                    onClick={() => {
                      const target = editingEmployee;
                      setShowAddModal(false);
                      handleDeleteEmployee(target);
                    }}
                    className="px-3 py-1.5 font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition flex items-center gap-1.5 cursor-pointer text-xs"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Hapus Akun Ini</span>
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-3.5 py-1.5 font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 font-bold text-white bg-purple-700 hover:bg-purple-800 rounded-lg transition shadow-xs cursor-pointer"
                  >
                    Simpan Akun
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetPasswordEmp && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 text-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 flex items-center gap-1.5">
                <KeyRound className="w-4 h-4 text-amber-600" />
                <span>Reset Kata Sandi Karyawan</span>
              </h3>
              <button
                onClick={() => setResetPasswordEmp(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleExecuteResetPassword} className="mt-3 space-y-3">
              <p className="text-slate-600">
                Atur kata sandi baru untuk akun <strong>{resetPasswordEmp.name}</strong> (@{resetPasswordEmp.username}):
              </p>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Kata Sandi Baru:
                </label>
                <input
                  type="text"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Masukkan kata sandi baru..."
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-amber-500 font-mono"
                />
              </div>

              <div className="mt-5 flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setResetPasswordEmp(null)}
                  className="px-3.5 py-1.5 font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition shadow-xs"
                >
                  Perbarui Kata Sandi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DELETE EMPLOYEE CONFIRMATION */}
      {deleteTargetEmp && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 text-xs animate-fade-in">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-rose-700 flex items-center gap-1.5">
                <Trash2 className="w-4 h-4 text-rose-600" />
                <span>Hapus Akun Karyawan</span>
              </h3>
              <button
                onClick={() => setDeleteTargetEmp(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-3 space-y-3">
              <p className="text-slate-700 leading-relaxed">
                Apakah Anda yakin ingin menghapus akun karyawan berikut secara permanen dari sistem?
              </p>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <div className="font-bold text-slate-900 text-sm">{deleteTargetEmp.name}</div>
                <div className="text-slate-500 text-[11px] font-mono">NIP: {deleteTargetEmp.nip} • @{deleteTargetEmp.username}</div>
                <div className="flex items-center gap-1.5 pt-1">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 text-slate-800">
                    {deleteTargetEmp.role === 'perawat'
                      ? 'Perawat HD'
                      : deleteTargetEmp.role === 'pj_shift'
                      ? 'PJ Shift HD'
                      : deleteTargetEmp.role === 'kepala_ruangan'
                      ? 'Kepala Ruang'
                      : deleteTargetEmp.role === 'dokter'
                      ? 'Dokter HD'
                      : 'Admin'}
                  </span>
                  {deleteTargetEmp.specialization && (
                    <span className="text-[10px] text-slate-500">{deleteTargetEmp.specialization}</span>
                  )}
                </div>
              </div>

              <p className="text-[11px] text-rose-600 font-semibold bg-rose-50 p-2 rounded-lg border border-rose-100">
                Tindakan ini tidak dapat dibatalkan. Seluruh jadwal dan penugasan perawat ini akan dibersihkan dari sistem.
              </p>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeleteTargetEmp(null)}
                className="px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteEmployee}
                className="px-4 py-1.5 font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition shadow-xs flex items-center space-x-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Ya, Hapus Akun</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST NOTIFICATION */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 text-xs font-semibold px-4 py-2.5 rounded-xl shadow-xl border flex items-center space-x-2 animate-fade-in ${
            toastMessage.type === 'error'
              ? 'bg-rose-900 text-white border-rose-800'
              : 'bg-slate-900 text-white border-slate-800'
          }`}
        >
          {toastMessage.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <Check className="w-4 h-4 text-teal-400 shrink-0" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}
    </div>
  );
};
