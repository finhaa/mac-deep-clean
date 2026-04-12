export type Risk = 'safe' | 'moderate' | 'risky';

export interface ScanResult {
  path: string;
  size: number;
  label: string;
  category: string;
  risk: Risk;
  description?: string;
}

export interface ScannerReport {
  name: string;
  category: string;
  description: string;
  risk: Risk;
  results: ScanResult[];
  totalSize: number;
  error?: string;
}

export interface CleanResult {
  freed: number;
  errors: string[];
}

export interface ScanOptions {
  deep?: boolean;
}

export interface CleanOptions {
  dryRun?: boolean;
  risky?: boolean;
  yes?: boolean;
  category?: string;
  deep?: boolean;
}
