// The camera's random walk over the BEH files' CamPath00 .. CamPath26 (the table at 0x1005b448, 0x74 bytes a path:
// its length in seconds, the paths that may follow it): when a path has run its length the next is a random one of
// its successors (0x100131a0). CamPath00 is the opening fly-in from far above.
export interface CamNode { time: number; next: number[] }

export const CAMERA_GRAPH: CamNode[] = [
  { time: 1, next: [1, 5, 9, 11, 13, 17, 21, 23, 25, 26] },
  { time: 1, next: [2] },
  { time: 3, next: [3, 4] },
  { time: 1, next: [2] },
  { time: 1, next: [5, 23, 25, 26] },
  { time: 1, next: [6] },
  { time: 3, next: [7, 8] },
  { time: 1, next: [6] },
  { time: 1, next: [1, 9, 11, 13] },
  { time: 4, next: [10, 12] },
  { time: 4, next: [1, 9, 11, 13, 17] },
  { time: 5, next: [10, 12] },
  { time: 5, next: [1, 9, 11, 13, 17] },
  { time: 7, next: [1, 9, 11, 13, 17] },
  { time: 1, next: [21, 23, 25, 26] },
  { time: 3, next: [14, 16] },
  { time: 1, next: [15] },
  { time: 1, next: [15] },
  { time: 1, next: [9, 11, 13, 17] },
  { time: 3, next: [18, 20] },
  { time: 1, next: [19] },
  { time: 1, next: [19] },
  { time: 4, next: [5, 21, 23, 25, 26] },
  { time: 4, next: [22, 24] },
  { time: 5, next: [5, 21, 23, 25, 26] },
  { time: 5, next: [22, 24] },
  { time: 7, next: [5, 21, 23, 25, 26] },
];

/** Undersea Wonders' graph (0x1005c430, 0x48 bytes a path): CamPath00 .. CamPath15, five seconds each, three
 *  successors */
export const JELLY_GRAPH: CamNode[] = [
  { time: 5, next: [11, 12, 13] }, { time: 5, next: [12, 13, 14] }, { time: 5, next: [13, 14, 15] }, { time: 5, next: [14, 15, 8] },
  { time: 5, next: [15, 8, 9] }, { time: 5, next: [8, 9, 10] }, { time: 5, next: [9, 10, 11] }, { time: 5, next: [10, 11, 12] },
  { time: 5, next: [3, 4, 5] }, { time: 5, next: [4, 5, 6] }, { time: 5, next: [5, 6, 7] }, { time: 5, next: [6, 7, 0] },
  { time: 5, next: [7, 0, 1] }, { time: 5, next: [0, 1, 2] }, { time: 5, next: [1, 2, 3] }, { time: 5, next: [2, 3, 4] },
];
