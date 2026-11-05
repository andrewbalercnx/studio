import type { Dispatch, SetStateAction } from 'react';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { TestResult } from './shared';

/** What the regression runners need from the page. */
export type RegressionContext = {
  firestore: Firestore | null;
  auth: Auth | null;
  updateTestResult: (id: string, result: Partial<TestResult>) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setDiagnostics: Dispatch<SetStateAction<any>>;
};
