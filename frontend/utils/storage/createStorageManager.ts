import LZString from 'lz-string';

// ─── Coach-view storage isolation ──────────────────────────────────────────
// When a coach is viewing a client's dashboard, we don't want interactions
// (filter tweaks, body-map gender toggles, etc.) to write through to the real
// localStorage and leak between sessions. A module-level map stands in as
// storage when `coachViewActive` is on. It clears whenever a new client
// context is pushed, so each coach→client session starts fresh.
const coachViewMemory: Map<string, string> = new Map();
let coachViewActive = false;

export const setCoachViewActive = (active: boolean): void => {
  coachViewActive = active;
  // NOTE: Don't clear the memory map here. When the coach switches clients
  // (a `key` change on CoachViewProvider), React unmounts the old tree AFTER
  // the new tree's useMemo has already seeded storage; clearing here would
  // wipe fresh seed data. The map is cleared only by `resetCoachViewStorage`
  // which the provider calls explicitly on fresh mount.
};

export const resetCoachViewStorage = (): void => {
  coachViewMemory.clear();
};

export const isCoachViewActive = (): boolean => coachViewActive;

const storageGet = (key: string): string | null => {
  if (coachViewActive) {
    return coachViewMemory.has(key) ? (coachViewMemory.get(key) ?? null) : null;
  }
  return localStorage.getItem(key);
};

const storageSet = (key: string, value: string): void => {
  if (coachViewActive) {
    coachViewMemory.set(key, value);
    return;
  }
  localStorage.setItem(key, value);
};

const storageRemove = (key: string): void => {
  if (coachViewActive) {
    coachViewMemory.delete(key);
    return;
  }
  localStorage.removeItem(key);
};

type StorageValidator<T> = (value: string | null) => T | null;
type StorageSerializer<T> = (value: T) => string;
type StorageDeserializer<T> = (value: string) => T;
type StorageMigrator<T> = (value: string | null) => T | null;

interface StorageManagerOptions<T> {
  key: string;
  defaultValue: T;
  validator?: StorageValidator<T>;
  serializer?: StorageSerializer<T>;
  deserializer?: StorageDeserializer<T>;
  migrator?: StorageMigrator<T>;
}

interface StorageManager<T> {
  get: () => T;
  set: (value: T) => void;
  clear: () => void;
  has: () => boolean;
}

export function createStorageManager<T>({
  key,
  defaultValue,
  validator,
  serializer = String,
  deserializer = (v) => v as unknown as T,
  migrator,
}: StorageManagerOptions<T>): StorageManager<T> {
  const get = (): T => {
    try {
      const stored = storageGet(key);

      // Apply migration if provided
      const migrated = migrator ? migrator(stored) : stored;
      const valueToValidate = migrated !== undefined ? migrated : stored;

      // Apply validation if provided
      if (validator) {
        const validated = validator(valueToValidate as string | null);
        if (validated !== null) return validated;
      } else if (valueToValidate !== null) {
        return deserializer(valueToValidate as string);
      }

      return defaultValue;
    } catch (error) {
      console.error(`Failed to retrieve ${key} from local storage:`, error);
      return defaultValue;
    }
  };

  const set = (value: T): void => {
    try {
      storageSet(key, serializer(value));
    } catch (error) {
      console.error(`Failed to save ${key} to local storage:`, error);
    }
  };

  const clear = (): void => {
    try {
      storageRemove(key);
    } catch (error) {
      console.error(`Failed to clear ${key} from local storage:`, error);
    }
  };

  const has = (): boolean => {
    try {
      return storageGet(key) !== null;
    } catch {
      return false;
    }
  };

  return { get, set, clear, has };
}

// Specialized helper for compressed data (CSV storage)
export function createCompressedStorageManager(key: string): StorageManager<string | null> {
  return {
    get: (): string | null => {
      try {
        const data = storageGet(key);
        if (data === null) return null;
        const decompressed = LZString.decompressFromUTF16(data);
        return decompressed !== null ? decompressed : data;
      } catch (error) {
        console.error(`Failed to retrieve ${key} from local storage:`, error);
        return null;
      }
    },
    set: (value: string): void => {
      try {
        const compressed = LZString.compressToUTF16(value);
        storageSet(key, compressed);
      } catch (error) {
        console.error(`Failed to save ${key} to local storage:`, error);
      }
    },
    clear: (): void => {
      try {
        storageRemove(key);
      } catch (error) {
        console.error(`Failed to clear ${key} from local storage:`, error);
      }
    },
    has: (): boolean => {
      try {
        return storageGet(key) !== null;
      } catch {
        return false;
      }
    },
  };
}
