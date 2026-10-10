/** Whether the app is in the foreground — the one condition under which the connectivity loop is
 *  allowed to touch the network. `inactive` (iOS's app switcher and system sheets) counts as not
 *  foreground, so the probe waits for the app to be fully back. */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export function useAppForeground(): boolean {
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);
  return foreground;
}
