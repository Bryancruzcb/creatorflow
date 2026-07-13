import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type AnalysisMode = 'shape' | 'timing' | 'loop' | 'root';
export type JointScope = 'full' | 'upper' | 'lower' | 'root';
export type MotionSampleCount = 24 | 48 | 96;
export type PreviewQuality = 'battery' | 'balanced' | 'sharp';
export type ReleaseDefaultView = 'guided' | 'map';

export interface WorkspacePreferences {
  analysisMode: AnalysisMode;
  jointScope: JointScope;
  sampleCount: MotionSampleCount;
  autoplay: boolean;
  poseTrail: boolean;
  previewQuality: PreviewQuality;
  reviewThreshold: number;
  releaseDefaultView: ReleaseDefaultView;
}

export const WORKSPACE_PREFERENCES_KEY = 'creatorflow:workspace-preferences:v1';

const LEGACY_RELEASE_PREFERENCE_KEY = 'creatorflow:release-preference';
const LEGACY_RELEASE_MODE_KEY = 'creatorflow:release-mode';

export const DEFAULT_WORKSPACE_PREFERENCES: Readonly<WorkspacePreferences> = Object.freeze({
  analysisMode: 'shape',
  jointScope: 'full',
  sampleCount: 48,
  autoplay: true,
  poseTrail: true,
  previewQuality: 'balanced',
  reviewThreshold: 85,
  releaseDefaultView: 'guided',
});

const analysisModes = ['shape', 'timing', 'loop', 'root'] as const;
const jointScopes = ['full', 'upper', 'lower', 'root'] as const;
const sampleCounts = [24, 48, 96] as const;
const previewQualities = ['battery', 'balanced', 'sharp'] as const;
const releaseViews = ['guided', 'map'] as const;

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function browserStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readLegacyReleaseView(storage: PreferenceStorage | null): ReleaseDefaultView | null {
  if (!storage) return null;
  try {
    const preference = storage.getItem(LEGACY_RELEASE_PREFERENCE_KEY);
    if (preference === 'guided' || preference === 'map') return preference;
    const mode = storage.getItem(LEGACY_RELEASE_MODE_KEY);
    return mode === 'guided' || mode === 'map' ? mode : null;
  } catch {
    return null;
  }
}

export function validateWorkspacePreferences(
  value: unknown,
  fallback: WorkspacePreferences = { ...DEFAULT_WORKSPACE_PREFERENCES },
): WorkspacePreferences {
  const candidate = isRecord(value) ? value : {};
  const rawThreshold = candidate.reviewThreshold;
  const reviewThreshold = typeof rawThreshold === 'number' && Number.isFinite(rawThreshold)
    ? Math.min(100, Math.max(60, Math.round(rawThreshold)))
    : fallback.reviewThreshold;

  return {
    analysisMode: oneOf(candidate.analysisMode, analysisModes, fallback.analysisMode),
    jointScope: oneOf(candidate.jointScope, jointScopes, fallback.jointScope),
    sampleCount: oneOf(candidate.sampleCount, sampleCounts, fallback.sampleCount),
    autoplay: typeof candidate.autoplay === 'boolean' ? candidate.autoplay : fallback.autoplay,
    poseTrail: typeof candidate.poseTrail === 'boolean' ? candidate.poseTrail : fallback.poseTrail,
    previewQuality: oneOf(candidate.previewQuality, previewQualities, fallback.previewQuality),
    reviewThreshold,
    releaseDefaultView: oneOf(candidate.releaseDefaultView, releaseViews, fallback.releaseDefaultView),
  };
}

export function readWorkspacePreferences(storage: PreferenceStorage | null = browserStorage()): WorkspacePreferences {
  const legacyReleaseView = readLegacyReleaseView(storage);
  const fallback: WorkspacePreferences = {
    ...DEFAULT_WORKSPACE_PREFERENCES,
    releaseDefaultView: legacyReleaseView ?? DEFAULT_WORKSPACE_PREFERENCES.releaseDefaultView,
  };
  if (!storage) return fallback;

  try {
    const serialized = storage.getItem(WORKSPACE_PREFERENCES_KEY);
    return validateWorkspacePreferences(serialized ? JSON.parse(serialized) : null, fallback);
  } catch {
    return fallback;
  }
}

export function writeWorkspacePreferences(
  preferences: WorkspacePreferences,
  storage: PreferenceStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(WORKSPACE_PREFERENCES_KEY, JSON.stringify(validateWorkspacePreferences(preferences)));
    storage.removeItem(LEGACY_RELEASE_PREFERENCE_KEY);
    storage.removeItem(LEGACY_RELEASE_MODE_KEY);
    return true;
  } catch {
    return false;
  }
}

export type WorkspacePreferenceSaveState = 'saved' | 'unavailable';

interface WorkspacePreferencesContextValue {
  preferences: WorkspacePreferences;
  setPreference: <K extends keyof WorkspacePreferences>(key: K, value: WorkspacePreferences[K]) => void;
  updatePreferences: (patch: Partial<WorkspacePreferences>) => void;
  resetPreferences: () => void;
  saveState: WorkspacePreferenceSaveState;
}

const WorkspacePreferencesContext = createContext<WorkspacePreferencesContextValue | null>(null);

export function WorkspacePreferencesProvider({ children }: { children: ReactNode }) {
  const storageRef = useRef<Storage | null>(browserStorage());
  const [preferences, setPreferences] = useState<WorkspacePreferences>(() => readWorkspacePreferences(storageRef.current));
  const [saveState, setSaveState] = useState<WorkspacePreferenceSaveState>(storageRef.current ? 'saved' : 'unavailable');

  useEffect(() => {
    const saved = writeWorkspacePreferences(preferences, storageRef.current);
    setSaveState(saved ? 'saved' : 'unavailable');
  }, [preferences]);

  useEffect(() => {
    const syncPreferences = (event: StorageEvent) => {
      if (event.key !== WORKSPACE_PREFERENCES_KEY && event.key !== null) return;
      setPreferences(readWorkspacePreferences(storageRef.current));
    };
    window.addEventListener('storage', syncPreferences);
    return () => window.removeEventListener('storage', syncPreferences);
  }, []);

  const setPreference = useCallback(<K extends keyof WorkspacePreferences>(key: K, value: WorkspacePreferences[K]) => {
    setPreferences((current) => validateWorkspacePreferences({ ...current, [key]: value }, current));
  }, []);

  const updatePreferences = useCallback((patch: Partial<WorkspacePreferences>) => {
    setPreferences((current) => validateWorkspacePreferences({ ...current, ...patch }, current));
  }, []);

  const resetPreferences = useCallback(() => {
    setPreferences({ ...DEFAULT_WORKSPACE_PREFERENCES });
  }, []);

  const value = useMemo<WorkspacePreferencesContextValue>(() => ({
    preferences,
    setPreference,
    updatePreferences,
    resetPreferences,
    saveState,
  }), [preferences, resetPreferences, saveState, setPreference, updatePreferences]);

  return <WorkspacePreferencesContext.Provider value={value}>{children}</WorkspacePreferencesContext.Provider>;
}

export function useWorkspacePreferences(): WorkspacePreferencesContextValue {
  const context = useContext(WorkspacePreferencesContext);
  if (!context) throw new Error('useWorkspacePreferences must be used within WorkspacePreferencesProvider.');
  return context;
}
