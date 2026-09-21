import { 
  collection, 
  doc, 
  onSnapshot, 
  setDoc, 
  deleteDoc, 
  writeBatch, 
  getDocs,
  Unsubscribe
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { 
  UserAccount, 
  ShiftSchedule, 
  HDMachine, 
  MachineAssignment, 
  SpecialTask, 
  MachineZoneConfig 
} from '../types';
import { 
  INITIAL_EMPLOYEES, 
  INITIAL_MACHINES, 
  INITIAL_SPECIAL_TASKS, 
  getInitialSchedules, 
  getInitialMachineAssignments 
} from '../data/initialData';
import { DEFAULT_ZONES } from '../types';
import { sortNursesByShiftScheduleOrder } from '../utils/scheduler';

export type SyncStatus = 'connecting' | 'connected' | 'syncing' | 'offline' | 'error';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errMessage = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: errMessage,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface CloudSyncListeners {
  onEmployees?: (data: UserAccount[]) => void;
  onSchedules?: (data: ShiftSchedule[]) => void;
  onMachines?: (data: HDMachine[]) => void;
  onZones?: (data: MachineZoneConfig[]) => void;
  onAssignments?: (data: MachineAssignment[]) => void;
  onSpecialTasks?: (data: SpecialTask[]) => void;
  onStatusChange?: (status: SyncStatus, error?: string) => void;
}

const COLLECTIONS = {
  EMPLOYEES: 'employees',
  SCHEDULES: 'schedules',
  MACHINES: 'machines',
  ZONES: 'zones',
  ASSIGNMENTS: 'machineAssignments',
  TASKS: 'specialTasks',
  META: 'systemMeta',
};

// Helper to chunk array for Firestore batches (max 500 operations per batch)
function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Checks if an error is due to offline/unavailable network connectivity.
 */
function isOfflineError(error: any): boolean {
  if (!error) return false;
  const msg = String(error.message || error).toLowerCase();
  const code = String(error.code || '').toLowerCase();
  return (
    code === 'unavailable' ||
    code === 'failed-precondition' ||
    msg.includes('offline') ||
    msg.includes('unavailable') ||
    msg.includes('connection failed') ||
    msg.includes('could not reach cloud firestore')
  );
}

/**
 * Checks if an error is due to permission denied.
 */
function isPermissionError(error: any): boolean {
  if (!error) return false;
  const msg = String(error.message || error).toLowerCase();
  const code = String(error.code || '').toLowerCase();
  return code === 'permission-denied' || msg.includes('permission') || msg.includes('missing or insufficient');
}

/**
 * Recursively removes any object properties with `undefined` value,
 * because Firestore rejects objects containing `undefined`.
 */
export function sanitizeForFirestore<T>(data: T): T {
  if (data === null || data === undefined) {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeForFirestore(item)) as unknown as T;
  }
  if (typeof data === 'object' && !(data instanceof Date)) {
    const clean: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        clean[key] = sanitizeForFirestore(value);
      }
    }
    return clean as T;
  }
  return data;
}

export const cloudSync = {
  unsubscribers: [] as Unsubscribe[],

  /**
   * Initialize real-time synchronization with Firestore
   */
  startSync(listeners: CloudSyncListeners): () => void {
    this.stopSync();
    listeners.onStatusChange?.('connecting');

    const handleListenerError = (collName: string, error: any) => {
      if (isPermissionError(error)) {
        handleFirestoreError(error, OperationType.GET, collName);
      } else if (isOfflineError(error)) {
        console.warn(`[CloudSync] ${collName} operating in offline/cached mode.`);
        listeners.onStatusChange?.('offline', error.message);
      } else {
        console.error(`[CloudSync] ${collName} sync error:`, error);
        listeners.onStatusChange?.('error', error.message);
      }
    };

    try {
      // 1. Initial check & auto-seed if cloud database is empty
      this.checkAndSeedIfEmpty().then((seeded) => {
        if (seeded) {
          console.log('[CloudSync] Cloud database initialized with standard HD unit dataset.');
        }
      }).catch((err) => {
        if (isPermissionError(err)) {
          handleFirestoreError(err, OperationType.GET, COLLECTIONS.EMPLOYEES);
        }
        console.warn('[CloudSync] Check/Seed notice:', err?.message || err);
      });

      // 2. EMPLOYEES Listener
      const unsubEmployees = onSnapshot(
        collection(db, COLLECTIONS.EMPLOYEES),
        (snapshot) => {
          if (!snapshot.empty) {
            const list: UserAccount[] = [];
            snapshot.forEach((docSnap) => {
              list.push(docSnap.data() as UserAccount);
            });
            const sortedList = sortNursesByShiftScheduleOrder(list);
            listeners.onEmployees?.(sortedList);
          }
          listeners.onStatusChange?.('connected');
        },
        (error) => handleListenerError(COLLECTIONS.EMPLOYEES, error)
      );
      this.unsubscribers.push(unsubEmployees);

      // 3. SCHEDULES Listener
      const unsubSchedules = onSnapshot(
        collection(db, COLLECTIONS.SCHEDULES),
        (snapshot) => {
          if (!snapshot.empty) {
            const list: ShiftSchedule[] = [];
            snapshot.forEach((docSnap) => {
              list.push(docSnap.data() as ShiftSchedule);
            });
            listeners.onSchedules?.(list);
          }
        },
        (error) => handleListenerError(COLLECTIONS.SCHEDULES, error)
      );
      this.unsubscribers.push(unsubSchedules);

      // 4. MACHINES Listener
      const unsubMachines = onSnapshot(
        collection(db, COLLECTIONS.MACHINES),
        (snapshot) => {
          if (!snapshot.empty) {
            const list: HDMachine[] = [];
            snapshot.forEach((docSnap) => {
              list.push(docSnap.data() as HDMachine);
            });
            listeners.onMachines?.(list);
          }
        },
        (error) => handleListenerError(COLLECTIONS.MACHINES, error)
      );
      this.unsubscribers.push(unsubMachines);

      // 5. ZONES Listener
      const unsubZones = onSnapshot(
        collection(db, COLLECTIONS.ZONES),
        (snapshot) => {
          if (!snapshot.empty) {
            const list: MachineZoneConfig[] = [];
            snapshot.forEach((docSnap) => {
              list.push(docSnap.data() as MachineZoneConfig);
            });
            list.sort((a, b) => a.order - b.order);
            listeners.onZones?.(list);
          }
        },
        (error) => handleListenerError(COLLECTIONS.ZONES, error)
      );
      this.unsubscribers.push(unsubZones);

      // 6. MACHINE ASSIGNMENTS Listener
      const unsubAssignments = onSnapshot(
        collection(db, COLLECTIONS.ASSIGNMENTS),
        (snapshot) => {
          if (!snapshot.empty) {
            const list: MachineAssignment[] = [];
            snapshot.forEach((docSnap) => {
              list.push(docSnap.data() as MachineAssignment);
            });
            listeners.onAssignments?.(list);
          }
        },
        (error) => handleListenerError(COLLECTIONS.ASSIGNMENTS, error)
      );
      this.unsubscribers.push(unsubAssignments);

      // 7. SPECIAL TASKS Listener
      const unsubTasks = onSnapshot(
        collection(db, COLLECTIONS.TASKS),
        (snapshot) => {
          if (!snapshot.empty) {
            const list: SpecialTask[] = [];
            snapshot.forEach((docSnap) => {
              list.push(docSnap.data() as SpecialTask);
            });
            listeners.onSpecialTasks?.(list);
          }
        },
        (error) => handleListenerError(COLLECTIONS.TASKS, error)
      );
      this.unsubscribers.push(unsubTasks);

    } catch (err: any) {
      console.error('[CloudSync] Initialization error:', err);
      if (isPermissionError(err)) {
        handleFirestoreError(err, OperationType.LIST, null);
      }
      listeners.onStatusChange?.(isOfflineError(err) ? 'offline' : 'error', err.message);
    }

    return () => this.stopSync();
  },

  /**
   * Stop all active Firestore listeners
   */
  stopSync() {
    this.unsubscribers.forEach((unsub) => {
      try {
        unsub();
      } catch (e) {
        console.error(e);
      }
    });
    this.unsubscribers = [];
  },

  /**
   * Check if Firestore has data; if empty, seed initial data
   */
  async checkAndSeedIfEmpty(): Promise<boolean> {
    try {
      const empSnapshot = await getDocs(collection(db, COLLECTIONS.EMPLOYEES));
      if (empSnapshot.empty) {
        await this.resetToInitialDataset();
        return true;
      }
      return false;
    } catch (e: any) {
      if (isPermissionError(e)) {
        handleFirestoreError(e, OperationType.GET, COLLECTIONS.EMPLOYEES);
      }
      console.warn('[CloudSync] checkAndSeedIfEmpty notice:', e?.message || e);
      return false;
    }
  },

  /**
   * Reset/Seed all initial data to Firestore using batched writes
   */
  async resetToInitialDataset(): Promise<void> {
    try {
      const initialSchedules = getInitialSchedules();
      const initialAssignments = getInitialMachineAssignments();

      // 1. Employees
      const empBatches = chunkArray(INITIAL_EMPLOYEES, 400);
      for (const chunk of empBatches) {
        const batch = writeBatch(db);
        chunk.forEach((emp) => {
          const ref = doc(db, COLLECTIONS.EMPLOYEES, emp.id);
          batch.set(ref, sanitizeForFirestore(emp));
        });
        await batch.commit();
      }

      // 2. Machines
      const machBatches = chunkArray(INITIAL_MACHINES, 400);
      for (const chunk of machBatches) {
        const batch = writeBatch(db);
        chunk.forEach((mach) => {
          const ref = doc(db, COLLECTIONS.MACHINES, mach.id);
          batch.set(ref, sanitizeForFirestore(mach));
        });
        await batch.commit();
      }

      // 3. Zones
      const zoneBatch = writeBatch(db);
      DEFAULT_ZONES.forEach((z) => {
        const ref = doc(db, COLLECTIONS.ZONES, z.id);
        zoneBatch.set(ref, sanitizeForFirestore(z));
      });
      await zoneBatch.commit();

      // 4. Special Tasks
      const taskBatch = writeBatch(db);
      INITIAL_SPECIAL_TASKS.forEach((t) => {
        const ref = doc(db, COLLECTIONS.TASKS, t.id);
        taskBatch.set(ref, sanitizeForFirestore(t));
      });
      await taskBatch.commit();

      // 5. Schedules (chunked by 400)
      const schBatches = chunkArray(initialSchedules, 400);
      for (const chunk of schBatches) {
        const batch = writeBatch(db);
        chunk.forEach((sch) => {
          const ref = doc(db, COLLECTIONS.SCHEDULES, sch.id);
          batch.set(ref, sanitizeForFirestore(sch));
        });
        await batch.commit();
      }

      // 6. Assignments
      const assignBatches = chunkArray(initialAssignments, 400);
      for (const chunk of assignBatches) {
        const batch = writeBatch(db);
        chunk.forEach((assign) => {
          const ref = doc(db, COLLECTIONS.ASSIGNMENTS, assign.id);
          batch.set(ref, sanitizeForFirestore(assign));
        });
        await batch.commit();
      }
    } catch (e: any) {
      if (isPermissionError(e)) {
        handleFirestoreError(e, OperationType.WRITE, 'initial_dataset');
      }
      console.warn('[CloudSync] Reset dataset notice:', e?.message || e);
    }
  },

  // -------------------------
  // Real-time Mutation Sync
  // -------------------------

  async saveEmployees(employees: UserAccount[]): Promise<void> {
    try {
      const snapshot = await getDocs(collection(db, COLLECTIONS.EMPLOYEES));
      const currentIds = new Set(employees.map((e) => e.id));
      const toDelete = snapshot.docs.filter((d) => !currentIds.has(d.id));

      if (toDelete.length > 0) {
        const delBatches = chunkArray(toDelete, 400);
        for (const chunk of delBatches) {
          const batch = writeBatch(db);
          chunk.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      }

      const batches = chunkArray(employees, 400);
      for (const chunk of batches) {
        const batch = writeBatch(db);
        chunk.forEach((emp) => {
          const ref = doc(db, COLLECTIONS.EMPLOYEES, emp.id);
          batch.set(ref, sanitizeForFirestore(emp));
        });
        await batch.commit();
      }
    } catch (e: any) {
      if (isPermissionError(e)) {
        handleFirestoreError(e, OperationType.WRITE, COLLECTIONS.EMPLOYEES);
      }
      console.warn('[CloudSync] saveEmployees notice:', e?.message || e);
    }
  },

  async saveSingleEmployee(emp: UserAccount): Promise<void> {
    try {
      const ref = doc(db, COLLECTIONS.EMPLOYEES, emp.id);
      await setDoc(ref, sanitizeForFirestore(emp));
    } catch (e: any) {
      if (isPermissionError(e)) {
        handleFirestoreError(e, OperationType.WRITE, `${COLLECTIONS.EMPLOYEES}/${emp.id}`);
      }
      console.warn('[CloudSync] saveSingleEmployee notice:', e?.message || e);
    }
  },

  async deleteEmployee(employeeId: string): Promise<void> {
    try {
      const ref = doc(db, COLLECTIONS.EMPLOYEES, employeeId);
      await deleteDoc(ref);
    } catch (e: any) {
      if (isPermissionError(e)) {
        handleFirestoreError(e, OperationType.DELETE, `${COLLECTIONS.EMPLOYEES}/${employeeId}`);
      }
      console.warn('[CloudSync] deleteEmployee notice:', e?.message || e);
    }
  },

  async saveSchedules(schedules: ShiftSchedule[]): Promise<void> {
    try {
      const snapshot = await getDocs(collection(db, COLLECTIONS.SCHEDULES));
      const currentIds = new Set(schedules.map((s) => s.id));
      const toDelete = snapshot.docs.filter((d) => !currentIds.has(d.id));

      if (toDelete.length > 0) {
        const delBatches = chunkArray(toDelete, 400);
        for (const chunk of delBatches) {
          const batch = writeBatch(db);
          chunk.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      }

      const batches = chunkArray(schedules, 400);
      for (const chunk of batches) {
        const batch = writeBatch(db);
        chunk.forEach((sch) => {
          const ref = doc(db, COLLECTIONS.SCHEDULES, sch.id);
          batch.set(ref, sanitizeForFirestore(sch));
        });
        await batch.commit();
      }
    } catch (e: any) {
      if (isPermissionError(e)) {
        handleFirestoreError(e, OperationType.WRITE, COLLECTIONS.SCHEDULES);
      }
      console.warn('[CloudSync] saveSchedules notice:', e?.message || e);
    }
  },

  async saveSingleSchedule(sch: ShiftSchedule): Promise<void> {
    try {
      const ref = doc(db, COLLECTIONS.SCHEDULES, sch.id);
      await setDoc(ref, sanitizeForFirestore(sch));
    } catch (e: any) {
      if (isPermissionError(e)) {
        handleFirestoreError(e, OperationType.WRITE, `${COLLECTIONS.SCHEDULES}/${sch.id}`);
      }
      console.warn('[CloudSync] saveSingleSchedule notice:', e?.message || e);
    }
  },

  async saveMachines(machines: HDMachine[]): Promise<void> {
    try {
      const batches = chunkArray(machines, 400);
      for (const chunk of batches) {
        const batch = writeBatch(db);
        chunk.forEach((mach) => {
          const ref = doc(db, COLLECTIONS.MACHINES, mach.id);
          batch.set(ref, sanitizeForFirestore(mach));
        });
        await batch.commit();
      }
    } catch (e: any) {
      if (isPermissionError(e)) {
        handleFirestoreError(e, OperationType.WRITE, COLLECTIONS.MACHINES);
      }
      console.warn('[CloudSync] saveMachines notice:', e?.message || e);
    }
  },

  async saveSingleMachine(mach: HDMachine): Promise<void> {
    try {
      const ref = doc(db, COLLECTIONS.MACHINES, mach.id);
      await setDoc(ref, sanitizeForFirestore(mach));
    } catch (e: any) {
      if (isPermissionError(e)) {
        handleFirestoreError(e, OperationType.WRITE, `${COLLECTIONS.MACHINES}/${mach.id}`);
      }
      console.warn('[CloudSync] saveSingleMachine notice:', e?.message || e);
    }
  },

  async saveZones(zones: MachineZoneConfig[]): Promise<void> {
    try {
      const batch = writeBatch(db);
      zones.forEach((z) => {
        const ref = doc(db, COLLECTIONS.ZONES, z.id);
        batch.set(ref, sanitizeForFirestore(z));
      });
      await batch.commit();
    } catch (e: any) {
      if (isPermissionError(e)) {
        handleFirestoreError(e, OperationType.WRITE, COLLECTIONS.ZONES);
      }
      console.warn('[CloudSync] saveZones notice:', e?.message || e);
    }
  },

  async saveMachineAssignments(assignments: MachineAssignment[]): Promise<void> {
    try {
      const batches = chunkArray(assignments, 400);
      for (const chunk of batches) {
        const batch = writeBatch(db);
        chunk.forEach((assign) => {
          const ref = doc(db, COLLECTIONS.ASSIGNMENTS, assign.id);
          batch.set(ref, sanitizeForFirestore(assign));
        });
        await batch.commit();
      }
    } catch (e: any) {
      if (isPermissionError(e)) {
        handleFirestoreError(e, OperationType.WRITE, COLLECTIONS.ASSIGNMENTS);
      }
      console.warn('[CloudSync] saveMachineAssignments notice:', e?.message || e);
    }
  },

  async saveSingleAssignment(assign: MachineAssignment): Promise<void> {
    try {
      const ref = doc(db, COLLECTIONS.ASSIGNMENTS, assign.id);
      await setDoc(ref, sanitizeForFirestore(assign));
    } catch (e: any) {
      if (isPermissionError(e)) {
        handleFirestoreError(e, OperationType.WRITE, `${COLLECTIONS.ASSIGNMENTS}/${assign.id}`);
      }
      console.warn('[CloudSync] saveSingleAssignment notice:', e?.message || e);
    }
  },

  async saveSpecialTasks(tasks: SpecialTask[]): Promise<void> {
    try {
      const batches = chunkArray(tasks, 400);
      for (const chunk of batches) {
        const batch = writeBatch(db);
        chunk.forEach((t) => {
          const ref = doc(db, COLLECTIONS.TASKS, t.id);
          batch.set(ref, sanitizeForFirestore(t));
        });
        await batch.commit();
      }
    } catch (e: any) {
      if (isPermissionError(e)) {
        handleFirestoreError(e, OperationType.WRITE, COLLECTIONS.TASKS);
      }
      console.warn('[CloudSync] saveSpecialTasks notice:', e?.message || e);
    }
  },

  async saveSingleSpecialTask(task: SpecialTask): Promise<void> {
    try {
      const ref = doc(db, COLLECTIONS.TASKS, task.id);
      await setDoc(ref, sanitizeForFirestore(task));
    } catch (e: any) {
      if (isPermissionError(e)) {
        handleFirestoreError(e, OperationType.WRITE, `${COLLECTIONS.TASKS}/${task.id}`);
      }
      console.warn('[CloudSync] saveSingleSpecialTask notice:', e?.message || e);
    }
  },

  async deleteSpecialTask(taskId: string): Promise<void> {
    try {
      const ref = doc(db, COLLECTIONS.TASKS, taskId);
      await deleteDoc(ref);
    } catch (e: any) {
      if (isPermissionError(e)) {
        handleFirestoreError(e, OperationType.DELETE, `${COLLECTIONS.TASKS}/${taskId}`);
      }
      console.warn('[CloudSync] deleteSpecialTask notice:', e?.message || e);
    }
  }
};

