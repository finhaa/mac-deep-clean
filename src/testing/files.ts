export const MB = 1024 * 1024;

/** A buffer over the 10 MB floor the scanners that report folders and packs apply. */
export const bigBuffer = (): Buffer => Buffer.alloc(11 * MB, 1);
