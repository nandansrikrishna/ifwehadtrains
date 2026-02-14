export type LngLat = [number, number];

export interface Station {
    id: number;
    name: string;
    IATA: string;
    lngLat: LngLat;
}

export interface Track {
    endpoints: [number, number];
    coordinates: LngLat[];
    maxSpeedMph?: number;
    travelTimeMin?: number;
}

interface Edge {
    to: number;
    minutes: number;
}

export interface RouteResult {
    pathStationIds: number[];
    pathCoordinates: LngLat[];
    totalMinutes: number;
}

const EARTH_RADIUS_MILES = 3958.8;
const DEFAULT_SPEED_MPH = 200;

function toRadians(value: number): number {
    return (value * Math.PI) / 180;
}

function haversineMiles(a: LngLat, b: LngLat): number {
    const [lon1, lat1] = a;
    const [lon2, lat2] = b;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const rLat1 = toRadians(lat1);
    const rLat2 = toRadians(lat2);

    const sinDLat = Math.sin(dLat / 2);
    const sinDLon = Math.sin(dLon / 2);

    const h =
        sinDLat * sinDLat +
        Math.cos(rLat1) * Math.cos(rLat2) * sinDLon * sinDLon;

    return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

function polylineMiles(coordinates: LngLat[]): number {
    if (coordinates.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < coordinates.length; i += 1) {
        total += haversineMiles(coordinates[i - 1], coordinates[i]);
    }
    return total;
}

function estimateTrackMinutes(track: Track): number {
    if (track.travelTimeMin && track.travelTimeMin > 0) {
        return track.travelTimeMin;
    }
    const speedMph = track.maxSpeedMph && track.maxSpeedMph > 0
        ? track.maxSpeedMph
        : DEFAULT_SPEED_MPH;
    const miles = polylineMiles(track.coordinates);
    return (miles / speedMph) * 60;
}

function edgeKey(a: number, b: number): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function mergeTrackCoordinates(pathStationIds: number[], tracksByEdge: Map<string, Track>): LngLat[] {
    const merged: LngLat[] = [];

    for (let i = 1; i < pathStationIds.length; i += 1) {
        const from = pathStationIds[i - 1];
        const to = pathStationIds[i];
        const track = tracksByEdge.get(edgeKey(from, to));
        if (!track || track.coordinates.length === 0) continue;

        const [trackStart] = track.endpoints;
        const oriented = trackStart === from
            ? track.coordinates
            : [...track.coordinates].reverse();

        if (merged.length === 0) {
            merged.push(...oriented);
        } else {
            merged.push(...oriented.slice(1));
        }
    }

    return merged;
}

export function computeFastestRoute(fromId: number, toId: number, tracks: Track[]): RouteResult | null {
    if (fromId === toId) {
        return {
            pathStationIds: [fromId],
            pathCoordinates: [],
            totalMinutes: 0,
        };
    }

    const adjacency = new Map<number, Edge[]>();
    const tracksByEdge = new Map<string, Track>();
    const stationIds = new Set<number>();

    for (const track of tracks) {
        const [a, b] = track.endpoints;
        const minutes = estimateTrackMinutes(track);
        if (!Number.isFinite(minutes) || minutes <= 0) continue;

        stationIds.add(a);
        stationIds.add(b);
        tracksByEdge.set(edgeKey(a, b), track);

        const aEdges = adjacency.get(a) ?? [];
        aEdges.push({ to: b, minutes });
        adjacency.set(a, aEdges);

        const bEdges = adjacency.get(b) ?? [];
        bEdges.push({ to: a, minutes });
        adjacency.set(b, bEdges);
    }

    if (!stationIds.has(fromId) || !stationIds.has(toId)) return null;

    const dist = new Map<number, number>();
    const prev = new Map<number, number>();
    const unvisited = new Set<number>(stationIds);

    for (const id of stationIds) dist.set(id, Number.POSITIVE_INFINITY);
    dist.set(fromId, 0);

    while (unvisited.size > 0) {
        let current: number | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;

        for (const id of unvisited) {
            const candidate = dist.get(id) ?? Number.POSITIVE_INFINITY;
            if (candidate < bestDistance) {
                bestDistance = candidate;
                current = id;
            }
        }

        if (current === null || bestDistance === Number.POSITIVE_INFINITY) break;
        if (current === toId) break;

        unvisited.delete(current);
        for (const edge of adjacency.get(current) ?? []) {
            if (!unvisited.has(edge.to)) continue;
            const alt = bestDistance + edge.minutes;
            if (alt < (dist.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
                dist.set(edge.to, alt);
                prev.set(edge.to, current);
            }
        }
    }

    const totalMinutes = dist.get(toId) ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(totalMinutes) || totalMinutes === Number.POSITIVE_INFINITY) {
        return null;
    }

    const pathStationIds: number[] = [];
    let cursor: number | undefined = toId;
    while (cursor !== undefined) {
        pathStationIds.push(cursor);
        cursor = prev.get(cursor);
    }
    pathStationIds.reverse();

    if (pathStationIds[0] !== fromId) return null;

    return {
        pathStationIds,
        pathCoordinates: mergeTrackCoordinates(pathStationIds, tracksByEdge),
        totalMinutes,
    };
}
