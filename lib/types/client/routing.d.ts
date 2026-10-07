export interface Point {
    x: number;
    y: number;
}
export interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}
export interface Segment {
    a: Point;
    b: Point;
    owner: string;
}
export declare function segmentClear(a: Point, b: Point, obstacles: Rect[]): boolean;
/** Orthogonal visibility-grid A*, with bend, crossing and shared-channel costs. */
export declare function route(start: Point, end: Point, obstacles: Rect[], width: number, height: number, used: Segment[], owner: string): Point[] | null;
export declare function rounded(points: Point[]): string;
