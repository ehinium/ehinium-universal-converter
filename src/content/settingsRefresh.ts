export type SettingsRefreshDependencies<T> = {
  clear: () => void;
  load: () => Promise<T>;
  apply: (settings: T) => void;
  rescan: () => Promise<void> | void;
};

export async function refreshContentSettings<T>(
  dependencies: SettingsRefreshDependencies<T>
): Promise<void> {
  dependencies.clear();
  const settings = await dependencies.load();
  dependencies.apply(settings);
  await dependencies.rescan();
}
