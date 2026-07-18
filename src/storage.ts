import { get, set } from "idb-keyval";
import type { SnapshotRecord, VaultIndex } from "./domain";
import { hashText } from "./filesystem";

const SNAPSHOT_PREFIX = "xhs-preview:snapshots:";
const RECENT_VAULTS_KEY = "xhs-preview:recent-vaults";
const PUBLISH_ROOT_KEY = "xhs-preview:publish-root";

export async function addSnapshot(
  documentId: string,
  text: string,
  reason: SnapshotRecord["reason"],
): Promise<SnapshotRecord[]> {
  const key = `${SNAPSHOT_PREFIX}${documentId}`;
  const current = (await get<SnapshotRecord[]>(key)) ?? [];
  const hash = await hashText(text);
  if (current[0]?.hash === hash) return current;
  const next = [
    { timestamp: Date.now(), text, hash, reason },
    ...current,
  ].slice(0, 20);
  await set(key, next);
  return next;
}

export async function getSnapshots(documentId: string): Promise<SnapshotRecord[]> {
  return (await get<SnapshotRecord[]>(`${SNAPSHOT_PREFIX}${documentId}`)) ?? [];
}

export interface RecentVaultRecord {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  openedAt: number;
}

export async function rememberVault(vault: VaultIndex): Promise<void> {
  const current = (await get<RecentVaultRecord[]>(RECENT_VAULTS_KEY)) ?? [];
  const withoutCurrent = current.filter((entry) => entry.name !== vault.name);
  await set(
    RECENT_VAULTS_KEY,
    [
      {
        id: vault.id,
        name: vault.name,
        handle: vault.root,
        openedAt: Date.now(),
      },
      ...withoutCurrent,
    ].slice(0, 5),
  );
}

export async function getRecentVaults(): Promise<RecentVaultRecord[]> {
  try {
    return (await get<RecentVaultRecord[]>(RECENT_VAULTS_KEY)) ?? [];
  } catch {
    return [];
  }
}

export async function rememberPublishRoot(handle: FileSystemDirectoryHandle): Promise<void> {
  await set(PUBLISH_ROOT_KEY, handle);
}

export async function getPublishRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await get<FileSystemDirectoryHandle>(PUBLISH_ROOT_KEY)) ?? null;
  } catch {
    return null;
  }
}
