// React wrapper component for Recap UX.

import { useEffect } from 'react';
import type { RecapConfig } from './types.js';
import { Recap } from './index.js';

export interface RecapProps extends RecapConfig {
  onExport?: (data: object) => void;
}

/**
 * Drop-in React component. Add to your app layout to enable tracking.
 *
 * @example
 * ```tsx
 * import { Recap } from 'recap-ux/react';
 * <Recap showPanel sessionName="participant-01" />
 * ```
 */
export function RecapComponent({ onExport: _onExport, ...config }: RecapProps): null {
  useEffect(() => {
    // Every RecapConfig setting passes through (panel, labels, screenName, requireConsent, supabase…).
    Recap.init(config);

    return () => {
      Recap.destroy();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

// Named export matching the design spec
export { RecapComponent as Recap };
export default RecapComponent;
