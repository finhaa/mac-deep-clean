export type Risk = 'safe' | 'moderate' | 'risky';

export interface ScanResult {
  path: string;
  size: number;
  label: string;
  category: string;
  risk: Risk;
  description?: string;
  /**
   * False when this item is reported for visibility but cannot be cleaned
   * by mac-deep-clean (e.g. Docker Desktop VM disk, which only shrinks
   * via Docker Desktop → Troubleshoot → Clean/Purge data).
   * Defaults to true.
   */
  cleanable?: boolean;
  /**
   * True when the item has no measurable size (a snapshot), so a size of 0
   * must not hide it from the cleanup list.
   */
  virtual?: boolean;
  /**
   * True when deleting the item destroys data that cannot be regenerated,
   * re-downloaded or restored (a backup, a snapshot, a recording, LocalHistory,
   * an archive). `clean --yes` never picks it from a broad `--risky`; the caller
   * must name its `--category`. Every scanner that emits such an item sets it,
   * except four that are `moderate` on purpose: Mail Downloads and Trash (the
   * owner's recorded decision), and the Maven repository and CocoaPods repos, whose
   * only non-downloadable content is a local build that `mvn install` or
   * `pod repo update` recreates.
   */
  irreversible?: boolean;
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
