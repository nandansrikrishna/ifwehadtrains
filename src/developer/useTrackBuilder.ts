import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { GeoJSONSource, Map as MapboxMap, MapLayerMouseEvent, MapMouseEvent } from 'mapbox-gl';
import type { Station, Track } from '../routing';

interface DraftTrackState {
    startId: number | null;
    endId: number | null;
    viaPoints: [number, number][];
}

interface UseTrackBuilderParams {
    isDevBuild: boolean;
    isDeveloperMode: boolean;
    map: MutableRefObject<MapboxMap | null>;
    mapLoaded: boolean;
    networkTracks: Track[];
    stationsById: Map<number, Station>;
    setNetworkTracks: Dispatch<SetStateAction<Track[]>>;
}

const DRAFT_LINE_SOURCE = 'draft-track';
const DRAFT_POINTS_SOURCE = 'draft-points';
const DRAFT_INSERT_SOURCE = 'draft-insert-point';

interface InsertCandidate {
    segmentIndex: number;
    midpoint: [number, number];
}

function createEmptyFeatureCollection(): GeoJSON.FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: []
    };
}

export function initializeTrackBuilderLayers(mapInstance: MapboxMap): void {
    if (!mapInstance.getSource(DRAFT_LINE_SOURCE)) {
        mapInstance.addSource(DRAFT_LINE_SOURCE, {
            type: 'geojson',
            data: createEmptyFeatureCollection()
        });
    }

    if (!mapInstance.getLayer('draft-track-line')) {
        mapInstance.addLayer({
            id: 'draft-track-line',
            type: 'line',
            source: DRAFT_LINE_SOURCE,
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': '#d97706',
                'line-width': 5,
                'line-dasharray': [2, 2]
            }
        });
    }

    if (!mapInstance.getLayer('draft-track-hitbox')) {
        mapInstance.addLayer({
            id: 'draft-track-hitbox',
            type: 'line',
            source: DRAFT_LINE_SOURCE,
            layout: {
                'line-join': 'round',
                'line-cap': 'round'
            },
            paint: {
                'line-color': '#d97706',
                'line-width': 14,
                // Keep it effectively invisible, but still reliably interactive.
                'line-opacity': 0.01
            }
        });
    }

    if (!mapInstance.getSource(DRAFT_POINTS_SOURCE)) {
        mapInstance.addSource(DRAFT_POINTS_SOURCE, {
            type: 'geojson',
            data: createEmptyFeatureCollection()
        });
    }

    if (!mapInstance.getLayer('draft-via-points')) {
        mapInstance.addLayer({
            id: 'draft-via-points',
            type: 'circle',
            source: DRAFT_POINTS_SOURCE,
            paint: {
                'circle-radius': 5,
                'circle-color': '#d97706',
                'circle-stroke-width': 1,
                'circle-stroke-color': '#ffffff'
            }
        });
    }

    if (!mapInstance.getSource(DRAFT_INSERT_SOURCE)) {
        mapInstance.addSource(DRAFT_INSERT_SOURCE, {
            type: 'geojson',
            data: createEmptyFeatureCollection()
        });
    }

    if (!mapInstance.getLayer('draft-insert-point')) {
        mapInstance.addLayer({
            id: 'draft-insert-point',
            type: 'symbol',
            source: DRAFT_INSERT_SOURCE,
            layout: {
                'text-field': '◌',
                'text-size': 26,
                'text-allow-overlap': true
            },
            paint: {
                'text-color': '#d97706',
                'text-halo-color': '#92400e',
                'text-halo-width': 0.8
            }
        });
    }
}

export function useTrackBuilder({
    isDevBuild,
    isDeveloperMode,
    map,
    mapLoaded,
    networkTracks,
    stationsById,
    setNetworkTracks,
}: UseTrackBuilderParams) {
    const developerModeRef = useRef(isDeveloperMode);
    const draggingViaIndexRef = useRef<number | null>(null);
    const insertCandidateRef = useRef<InsertCandidate | null>(null);
    const lastInsertAtRef = useRef(0);
    const [draftTrack, setDraftTrack] = useState<DraftTrackState>({
        startId: null,
        endId: null,
        viaPoints: []
    });
    const [savedDraftTracks, setSavedDraftTracks] = useState<Track[]>([]);
    const [copyMessage, setCopyMessage] = useState<string | null>(null);
    const [editingTrackIndex, setEditingTrackIndex] = useState<number | null>(null);

    useEffect(() => {
        developerModeRef.current = isDeveloperMode;
    }, [isDeveloperMode]);

    useEffect(() => {
        if (!map.current || !mapLoaded) return;
        const mapInstance = map.current;
        if (!mapInstance.getLayer('tracks-base')) return;

        const handleTrackClick = (event: MapLayerMouseEvent) => {
            if (!developerModeRef.current) return;
            const rawIndex = event.features?.[0]?.properties?.index;
            const index = typeof rawIndex === 'number' ? rawIndex : Number(rawIndex);
            if (!Number.isInteger(index) || index < 0 || index >= networkTracks.length) return;

            const track = networkTracks[index];
            setCopyMessage(`Editing track #${index}. Drag points or add new points, then save.`);
            setEditingTrackIndex(index);
            setDraftTrack({
                startId: track.endpoints[0],
                endId: track.endpoints[1],
                viaPoints: track.coordinates.slice(1, -1)
            });
        };

        mapInstance.on('click', 'tracks-base', handleTrackClick);
        return () => {
            mapInstance.off('click', 'tracks-base', handleTrackClick);
        };
    }, [map, mapLoaded, networkTracks]);

    useEffect(() => {
        if (!map.current || !mapLoaded) return;
        const mapInstance = map.current;
        if (!mapInstance.getLayer('draft-via-points')) return;

        const handleMouseEnter = () => {
            if (!developerModeRef.current) return;
            mapInstance.getCanvas().style.cursor = 'grab';
        };

        const handleMouseLeave = () => {
            if (draggingViaIndexRef.current !== null) return;
            mapInstance.getCanvas().style.cursor = '';
        };

        const handlePointMouseDown = (event: MapLayerMouseEvent) => {
            if (!developerModeRef.current) return;
            const rawIndex = event.features?.[0]?.properties?.index;
            const index = typeof rawIndex === 'number' ? rawIndex : Number(rawIndex);
            if (!Number.isInteger(index)) return;

            draggingViaIndexRef.current = index;
            mapInstance.getCanvas().style.cursor = 'grabbing';
            mapInstance.dragPan.disable();
        };

        const handleMouseMove = (event: MapMouseEvent) => {
            const activeIndex = draggingViaIndexRef.current;
            if (activeIndex === null) return;

            setDraftTrack((previous) => {
                if (activeIndex < 0 || activeIndex >= previous.viaPoints.length) return previous;
                const updatedViaPoints = [...previous.viaPoints];
                updatedViaPoints[activeIndex] = [event.lngLat.lng, event.lngLat.lat];
                return {
                    ...previous,
                    viaPoints: updatedViaPoints
                };
            });
        };

        const stopDragging = () => {
            if (draggingViaIndexRef.current === null) return;
            draggingViaIndexRef.current = null;
            mapInstance.dragPan.enable();
            mapInstance.getCanvas().style.cursor = developerModeRef.current ? 'grab' : '';
        };

        mapInstance.on('mouseenter', 'draft-via-points', handleMouseEnter);
        mapInstance.on('mouseleave', 'draft-via-points', handleMouseLeave);
        mapInstance.on('mousedown', 'draft-via-points', handlePointMouseDown);
        mapInstance.on('mousemove', handleMouseMove);
        mapInstance.on('mouseup', stopDragging);

        return () => {
            mapInstance.off('mouseenter', 'draft-via-points', handleMouseEnter);
            mapInstance.off('mouseleave', 'draft-via-points', handleMouseLeave);
            mapInstance.off('mousedown', 'draft-via-points', handlePointMouseDown);
            mapInstance.off('mousemove', handleMouseMove);
            mapInstance.off('mouseup', stopDragging);
            mapInstance.dragPan.enable();
            mapInstance.getCanvas().style.cursor = '';
        };
    }, [map, mapLoaded]);

    useEffect(() => {
        if (!map.current || !mapLoaded) return;
        const mapInstance = map.current;
        if (!mapInstance.getLayer('draft-track-hitbox')) return;

        const insertSource = mapInstance.getSource(DRAFT_INSERT_SOURCE) as GeoJSONSource | undefined;
        if (!insertSource) return;

        const clearInsertCandidate = () => {
            insertCandidateRef.current = null;
            insertSource.setData(createEmptyFeatureCollection());
        };

        const buildLineCoordinates = (): [number, number][] => {
            const startStation = draftTrack.startId !== null ? stationsById.get(draftTrack.startId) : undefined;
            const endStation = draftTrack.endId !== null ? stationsById.get(draftTrack.endId) : undefined;
            if (!startStation || !endStation) return [];

            return [startStation.lngLat, ...draftTrack.viaPoints, endStation.lngLat];
        };

        const getClosestInsertCandidate = (event: MapMouseEvent): InsertCandidate | null => {
            const lineCoordinates = buildLineCoordinates();
            if (lineCoordinates.length < 2) return null;

            const mousePoint = event.point;
            let bestDistance = Number.POSITIVE_INFINITY;
            let bestSegmentIndex = -1;
            let bestMidpoint: [number, number] | null = null;

            for (let index = 0; index < lineCoordinates.length - 1; index += 1) {
                const from = lineCoordinates[index];
                const to = lineCoordinates[index + 1];
                const fromPixel = mapInstance.project(from);
                const toPixel = mapInstance.project(to);

                const segmentX = toPixel.x - fromPixel.x;
                const segmentY = toPixel.y - fromPixel.y;
                const lengthSquared = segmentX * segmentX + segmentY * segmentY;
                if (lengthSquared === 0) continue;

                const projectedT = ((mousePoint.x - fromPixel.x) * segmentX + (mousePoint.y - fromPixel.y) * segmentY) / lengthSquared;
                const clampedT = Math.max(0, Math.min(1, projectedT));
                const closestX = fromPixel.x + clampedT * segmentX;
                const closestY = fromPixel.y + clampedT * segmentY;

                const dx = mousePoint.x - closestX;
                const dy = mousePoint.y - closestY;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestSegmentIndex = index;
                    bestMidpoint = [
                        (from[0] + to[0]) / 2,
                        (from[1] + to[1]) / 2
                    ];
                }
            }

            if (bestSegmentIndex < 0 || !bestMidpoint) return null;
            return {
                segmentIndex: bestSegmentIndex,
                midpoint: bestMidpoint
            };
        };

        const setInsertCandidateFromEvent = (event: MapMouseEvent): boolean => {
            if (!developerModeRef.current || draggingViaIndexRef.current !== null) return false;

            const candidate = getClosestInsertCandidate(event);
            if (!candidate) return false;

            insertCandidateRef.current = candidate;
            insertSource.setData({
                type: 'FeatureCollection',
                features: [{
                    type: 'Feature',
                    properties: {},
                    geometry: {
                        type: 'Point',
                        coordinates: candidate.midpoint
                    }
                }]
            });
            return true;
        };

        const handleDraftLineMove = (event: MapMouseEvent) => {
            if (!setInsertCandidateFromEvent(event)) {
                clearInsertCandidate();
            }
        };

        const handleDraftLineLeave = () => {
            if (draggingViaIndexRef.current !== null) return;
            clearInsertCandidate();
        };

        const handleDraftLineClick = (event: MapMouseEvent) => {
            if (!setInsertCandidateFromEvent(event)) return;
            const candidate = insertCandidateRef.current;
            if (!candidate) return;

            const now = Date.now();
            if (now - lastInsertAtRef.current < 120) return;
            lastInsertAtRef.current = now;

            setCopyMessage(null);

            setDraftTrack((previous) => {
                if (previous.startId === null || previous.endId === null) return previous;
                const updatedViaPoints = [...previous.viaPoints];
                updatedViaPoints.splice(candidate.segmentIndex, 0, candidate.midpoint);
                return {
                    ...previous,
                    viaPoints: updatedViaPoints
                };
            });
        };

        mapInstance.on('mousemove', 'draft-track-hitbox', handleDraftLineMove);
        mapInstance.on('mousemove', 'draft-track-line', handleDraftLineMove);
        mapInstance.on('mouseleave', 'draft-track-hitbox', handleDraftLineLeave);
        mapInstance.on('mouseleave', 'draft-track-line', handleDraftLineLeave);
        mapInstance.on('click', 'draft-track-hitbox', handleDraftLineClick);

        return () => {
            mapInstance.off('mousemove', 'draft-track-hitbox', handleDraftLineMove);
            mapInstance.off('mousemove', 'draft-track-line', handleDraftLineMove);
            mapInstance.off('mouseleave', 'draft-track-hitbox', handleDraftLineLeave);
            mapInstance.off('mouseleave', 'draft-track-line', handleDraftLineLeave);
            mapInstance.off('click', 'draft-track-hitbox', handleDraftLineClick);
            clearInsertCandidate();
        };
    }, [draftTrack, map, mapLoaded, stationsById]);

    useEffect(() => {
        if (!isDeveloperMode && map.current) {
            draggingViaIndexRef.current = null;
            map.current.dragPan.enable();
            map.current.getCanvas().style.cursor = '';
        }
    }, [isDeveloperMode, map]);

    useEffect(() => {
        if (!map.current || !mapLoaded) return;

        const draftLineSource = map.current.getSource(DRAFT_LINE_SOURCE) as GeoJSONSource | undefined;
        const draftPointsSource = map.current.getSource(DRAFT_POINTS_SOURCE) as GeoJSONSource | undefined;
        const draftInsertSource = map.current.getSource(DRAFT_INSERT_SOURCE) as GeoJSONSource | undefined;
        if (!draftLineSource || !draftPointsSource || !draftInsertSource) return;

        if (!isDeveloperMode) {
            draftLineSource.setData(createEmptyFeatureCollection());
            draftPointsSource.setData(createEmptyFeatureCollection());
            draftInsertSource.setData(createEmptyFeatureCollection());
            return;
        }

        const startStation = draftTrack.startId !== null ? stationsById.get(draftTrack.startId) : undefined;
        const endStation = draftTrack.endId !== null ? stationsById.get(draftTrack.endId) : undefined;
        const lineCoordinates = [
            ...(startStation ? [startStation.lngLat] : []),
            ...draftTrack.viaPoints,
            ...(endStation ? [endStation.lngLat] : []),
        ];

        draftLineSource.setData({
            type: 'FeatureCollection',
            features: lineCoordinates.length > 1
                ? [{
                    type: 'Feature',
                    properties: {},
                    geometry: {
                        type: 'LineString',
                        coordinates: lineCoordinates
                    }
                }]
                : []
        });

        draftPointsSource.setData({
            type: 'FeatureCollection',
            features: draftTrack.viaPoints.map((point, index) => ({
                type: 'Feature' as const,
                properties: { index },
                geometry: {
                    type: 'Point' as const,
                    coordinates: point
                }
            }))
        });

        draftInsertSource.setData(createEmptyFeatureCollection());
        insertCandidateRef.current = null;
    }, [draftTrack, isDeveloperMode, map, mapLoaded, stationsById]);

    const currentDraftTrackObject: Track | null = useMemo(() => {
        if (draftTrack.startId === null || draftTrack.endId === null) return null;
        const startStation = stationsById.get(draftTrack.startId);
        const endStation = stationsById.get(draftTrack.endId);
        if (!startStation || !endStation) return null;

        return {
            endpoints: [startStation.id, endStation.id],
            maxSpeedMph: 200,
            coordinates: [startStation.lngLat, ...draftTrack.viaPoints, endStation.lngLat]
        };
    }, [draftTrack, stationsById]);

    const handleStationClick = (stationId: number) => {
        if (!developerModeRef.current) return;

        setCopyMessage(null);
        setEditingTrackIndex(null);
        setDraftTrack((previous) => {
            if (previous.startId === null || previous.endId !== null) {
                return { startId: stationId, endId: null, viaPoints: [] };
            }
            if (previous.startId === stationId) {
                return previous;
            }
            return { ...previous, endId: stationId };
        });
    };

    const resetDraftTrack = () => {
        setDraftTrack({ startId: null, endId: null, viaPoints: [] });
        setEditingTrackIndex(null);
        setCopyMessage(null);
    };

    const undoLastPoint = () => {
        setCopyMessage(null);
        setDraftTrack((previous) => ({ ...previous, viaPoints: previous.viaPoints.slice(0, -1) }));
    };

    const saveDraftTrack = async () => {
        if (!currentDraftTrackObject) return;

        if (editingTrackIndex !== null) {
            if (editingTrackIndex < 0 || editingTrackIndex >= networkTracks.length) {
                setCopyMessage('Cannot save edit: selected track no longer exists.');
                return;
            }

            if (isDevBuild) {
                try {
                    const response = await fetch('/__dev/update-track', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ index: editingTrackIndex, track: currentDraftTrackObject })
                    });

                    if (!response.ok) {
                        const message = await response.text();
                        setCopyMessage(`Update failed: ${message || response.statusText}`);
                        return;
                    }
                } catch {
                    setCopyMessage('Update failed: local dev server endpoint not available.');
                    return;
                }
            }

            setNetworkTracks((previous) => previous.map((track, index) => (
                index === editingTrackIndex ? currentDraftTrackObject : track
            )));
            setDraftTrack({ startId: null, endId: null, viaPoints: [] });
            setEditingTrackIndex(null);
            setCopyMessage('Track updated successfully.');
            return;
        }

        setSavedDraftTracks((previous) => [...previous, currentDraftTrackObject]);
        setDraftTrack({ startId: null, endId: null, viaPoints: [] });
        setCopyMessage('Track added to saved drafts. Append when ready.');
    };

    const handleCopyText = async (text: string, successText: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopyMessage(successText);
        } catch {
            setCopyMessage('Clipboard copy failed. Copy manually from the text box below.');
        }
    };

    const copyCurrentJson = () => {
        if (!currentDraftTrackObject) return;
        void handleCopyText(JSON.stringify(currentDraftTrackObject, null, 2), 'Current track copied.');
    };

    const copySavedJson = () => {
        if (savedDraftTracks.length === 0) return;
        void handleCopyText(JSON.stringify(savedDraftTracks, null, 2), 'Saved track list copied.');
    };

    const appendSavedTracksToFile = async () => {
        if (!isDevBuild || savedDraftTracks.length === 0) return;

        setCopyMessage(null);
        try {
            const response = await fetch('/__dev/append-tracks', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ tracks: savedDraftTracks })
            });

            if (!response.ok) {
                const message = await response.text();
                setCopyMessage(`Append failed: ${message || response.statusText}`);
                return;
            }

            setNetworkTracks((previous) => [...previous, ...savedDraftTracks]);
            setSavedDraftTracks([]);
            setCopyMessage('Saved tracks appended to src/tracks.json.');
        } catch {
            setCopyMessage('Append failed: local dev server endpoint not available.');
        }
    };

    return {
        draftTrack,
        savedDraftTracks,
        copyMessage,
        editingTrackIndex,
        currentDraftTrackObject,
        draftStartStation: draftTrack.startId !== null ? stationsById.get(draftTrack.startId) ?? null : null,
        draftEndStation: draftTrack.endId !== null ? stationsById.get(draftTrack.endId) ?? null : null,
        handleStationClick,
        resetDraftTrack,
        undoLastPoint,
        saveDraftTrack,
        copyCurrentJson,
        copySavedJson,
        appendSavedTracksToFile,
    };
}
