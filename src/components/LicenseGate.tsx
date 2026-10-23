import React from 'react';

interface LicenseGateProps {
  children: React.ReactNode;
}

/**
 * LicenseGate - Conditional rendering wrapper for license verification
 * (Bypassed)
 */
export function LicenseGate({ children }: LicenseGateProps) {
  return <>{children}</>;
}
