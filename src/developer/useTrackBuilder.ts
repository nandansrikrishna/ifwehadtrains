import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { GeoJSONSource, Map as MapboxMap, MapLayerMouseEvent, MapMouseEvent } from 'mapbox-gl';
import type { Station, Track } from '../routing';
import { useKeyboardCommands, type KeyboardCommand } from '../hooks/useKeyboardCommands';
import { useActionHistory, type ActionHandlers, type HistoryEntry } from './useActionHistory';

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
const EMPTY_DRAFT_TRACK: DraftTrackState = {
    startId: null,
    endId: null,
    viaPoints: []
};

type DraftTrackActionType = 'insert_point' | 'delete_point' | 'move_point';
type GlobalActionDomain = 'draft' | 'network';

interface PointPayload {
    index: number;
    point: [number, number];
}

interface DeletePayload {
    index: number;
}

interface InsertCandidate {
    segmentIndex: number;
    midpoint: [number, number];
}

interface NetworkHistoryEntry {
    redo: (tracks: Track[]) => Track[];
    undo: (tracks: Track[]) => Track[];
    persistRedo?: () => Promise<boolean>;
    persistUndo?: () => Promise<boolean>;
}

function createEmptyFeatureCollection(): GeoJSON.FeatureCollection {
    return {
        type: 'FeatureCollection',
        features: []
    };
}

function pointsEqual(a: [number, number], b: [number, number]): boolean {
    return a[0] === b[0] && a[1] === b[1];
}

async function postJson(url: string, body: unknown): Promise<boolean> {
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        return response.ok;
    } catch {
        return false;
    }
}

const draftTrackActionHandlers: ActionHandlers<DraftTrackState, DraftTrackActionType> = {
    insert_point: (state, payload) => {
        const { index, point } = payload as PointPayload;
        if (index < 0 || index > state.viaPoints.length) return state;

        const viaPoints = [...state.viaPoints];
        viaPoints.splice(index, 0, point);
        return {
            ...state,
            viaPoints
        };
    },
    delete_point: (state, payload) => {
        const { index } = payload as DeletePayload;
        if (index < 0 || index >= state.viaPoints.length) return state;

        const viaPoints = [...state.viaPoints];
        viaPoints.splice(index, 1);
        return {
            ...state,
            viaPoints
        };
    },
    move_point: (state, payload) => {
        const { index, point } = payload as PointPayload;
        if (index < 0 || index >= state.viaPoints.length) return state;

        const viaPoints = [...state.viaPoints];
        viaPoints[index] = point;
        return {
            ...state,
            viaPoints
        };
    }
};

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
                'circle-radius': [
                    'case',
                    ['==', ['get', 'selected'], true],
                    7,
                    5
                ],
                'circle-color': [
                    'case',
                    ['==', ['get', 'selected'], true],
                    '#b45309',
                    '#d97706'
                ],
                'circle-stroke-width': [
                    'case',
                    ['==', ['get', 'selected'], true],
                    2,
                    1
                ],
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
    const dragStartPointRef = useRef<[number, number] | null>(null);
    const insertCandidateRef = useRef<InsertCandidate | null>(null);
    const lastInsertAtRef = useRef(0);
    const suppressNextLineInsertRef = useRef(false);
    const isApplyingNetworkActionRef = useRef(false);

    const {
        state: draftTrack,
        setState: setDraftTrack,
        execute: executeDraftTrackActionRaw,
        record: recordDraftTrackActionRaw,
        undo: undoDraftTrackActionRaw,
        redo: redoDraftTrackActionRaw,
        clearHistory: clearDraftTrackHistory,
    } = useActionHistory<DraftTrackState, DraftTrackActionType>(
        EMPTY_DRAFT_TRACK,
        draftTrackActionHandlers
    );

    const draftTrackRef = useRef(draftTrack);
    const globalUndoStackRef = useRef<GlobalActionDomain[]>([]);
    const globalRedoStackRef = useRef<GlobalActionDomain[]>([]);
    const networkUndoStackRef = useRef<NetworkHistoryEntry[]>([]);
    const networkRedoStackRef = useRef<NetworkHistoryEntry[]>([]);

    const [historyVersion, setHistoryVersion] = useState(0);
    const [savedDraftTracks, setSavedDraftTracks] = useState<Track[]>([]);
    const [copyMessage, setCopyMessage] = useState<string | null>(null);
    const [editingTrackIndex, setEditingTrackIndex] = useState<number | null>(null);
    const [selectedViaPointIndex, setSelectedViaPointIndex] = useState<number | null>(null);
    const [selectedTrackDeleteIndex, setSelectedTrackDeleteIndex] = useState<number | null>(null);

    useEffect(() => {
        developerModeRef.current = isDeveloperMode;
    }, [isDeveloperMode]);

    useEffect(() => {
        draftTrackRef.current = draftTrack;
    }, [draftTrack]);

    const bumpHistoryVersion = useCallback(() => {
        setHistoryVersion((value) => value + 1);
    }, []);

    const pushGlobalNewAction = useCallback((domain: GlobalActionDomain) => {
        globalUndoStackRef.current.push(domain);
        globalRedoStackRef.current = [];
        bumpHistoryVersion();
    }, [bumpHistoryVersion]);

    const executeDraftTrackAction = useCallback((entry: HistoryEntry<DraftTrackActionType>) => {
        executeDraftTrackActionRaw(entry);
        pushGlobalNewAction('draft');
    }, [executeDraftTrackActionRaw, pushGlobalNewAction]);

    const recordDraftTrackAction = useCallback((entry: HistoryEntry<DraftTrackActionType>) => {
        recordDraftTrackActionRaw(entry);
        pushGlobalNewAction('draft');
    }, [recordDraftTrackActionRaw, pushGlobalNewAction]);

    const executeNetworkAction = useCallback(async (entry: NetworkHistoryEntry) => {
        if (isApplyingNetworkActionRef.current) return false;
        isApplyingNetworkActionRef.current = true;

        try {
            if (entry.persistRedo) {
                const persisted = await entry.persistRedo();
                if (!persisted) return false;
            }

            setNetworkTracks((previous) => entry.redo(previous));
            networkUndoStackRef.current.push(entry);
            networkRedoStackRef.current = [];
            pushGlobalNewAction('network');
            return true;
        } finally {
            isApplyingNetworkActionRef.current = false;
        }
    }, [pushGlobalNewAction, setNetworkTracks]);

    const clearDraftBuilderState = useCallback(() => {
        setDraftTrack(EMPTY_DRAFT_TRACK);
        clearDraftTrackHistory();
        setSelectedViaPointIndex(null);
    }, [clearDraftTrackHistory, setDraftTrack]);

    const deleteTrackByIndex = useCallback(async (index: number) => {
        if (index < 0 || index >= networkTracks.length) return false;
        const removedTrack = networkTracks[index];

        const entry: NetworkHistoryEntry = {
            redo: (tracks) => tracks.filter((_, trackIndex) => trackIndex !== index),
            undo: (tracks) => {
                const updated = [...tracks];
                updated.splice(index, 0, removedTrack);
                return updated;
            },
            persistRedo: isDevBuild
                ? () => postJson('/__dev/delete-track', { index })
                : undefined,
            persistUndo: isDevBuild
                ? () => postJson('/__dev/insert-track', { index, track: removedTrack })
                : undefined,
        };

        const deleted = await executeNetworkAction(entry);
        if (!deleted) {
            setCopyMessage('Delete failed: could not persist track deletion.');
            return false;
        }

        if (editingTrackIndex === index) {
            clearDraftBuilderState();
            setEditingTrackIndex(null);
        }

        setSelectedTrackDeleteIndex(null);
        setCopyMessage(`Deleted track #${index}.`);
        return true;
    }, [clearDraftBuilderState, editingTrackIndex, executeNetworkAction, isDevBuild, networkTracks]);

    const canUndo = historyVersion >= 0 && globalUndoStackRef.current.length > 0;
    const canRedo = historyVersion >= 0 && globalRedoStackRef.current.length > 0;

    const undoGlobalAction = useCallback(async () => {
        const domain = globalUndoStackRef.current.pop();
        if (!domain) return false;

        if (domain === 'draft') {
            const didUndo = undoDraftTrackActionRaw();
            if (!didUndo) return false;
            globalRedoStackRef.current.push('draft');
            bumpHistoryVersion();
            return true;
        }

        const entry = networkUndoStackRef.current.pop();
        if (!entry) return false;

        if (isApplyingNetworkActionRef.current) {
            networkUndoStackRef.current.push(entry);
            globalUndoStackRef.current.push('network');
            return false;
        }

        isApplyingNetworkActionRef.current = true;
        try {
            if (entry.persistUndo) {
                const persisted = await entry.persistUndo();
                if (!persisted) {
                    networkUndoStackRef.current.push(entry);
                    globalUndoStackRef.current.push('network');
                    return false;
                }
            }
            setNetworkTracks((previous) => entry.undo(previous));
            networkRedoStackRef.current.push(entry);
            globalRedoStackRef.current.push('network');
            bumpHistoryVersion();
            return true;
        } finally {
            isApplyingNetworkActionRef.current = false;
        }
    }, [bumpHistoryVersion, setNetworkTracks, undoDraftTrackActionRaw]);

    const redoGlobalAction = useCallback(async () => {
        const domain = globalRedoStackRef.current.pop();
        if (!domain) return false;

        if (domain === 'draft') {
            const didRedo = redoDraftTrackActionRaw();
            if (!didRedo) return false;
            globalUndoStackRef.current.push('draft');
            bumpHistoryVersion();
            return true;
        }

        const entry = networkRedoStackRef.current.pop();
        if (!entry) return false;

        if (isApplyingNetworkActionRef.current) {
            networkRedoStackRef.current.push(entry);
            globalRedoStackRef.current.push('network');
            return false;
        }

        isApplyingNetworkActionRef.current = true;
        try {
            if (entry.persistRedo) {
                const persisted = await entry.persistRedo();
                if (!persisted) {
                    networkRedoStackRef.current.push(entry);
                    globalRedoStackRef.current.push('network');
                    return false;
                }
            }
            setNetworkTracks((previous) => entry.redo(previous));
            networkUndoStackRef.current.push(entry);
            globalUndoStackRef.current.push('network');
            bumpHistoryVersion();
            return true;
        } finally {
            isApplyingNetworkActionRef.current = false;
        }
    }, [bumpHistoryVersion, redoDraftTrackActionRaw, setNetworkTracks]);

    const isUndoShortcut = useCallback((event: KeyboardEvent) => {
        if (!(event.metaKey || event.ctrlKey)) return false;
        if (event.altKey) return false;
        return event.key.toLowerCase() === 'z' && !event.shiftKey;
    }, []);

    const isRedoShortcut = useCallback((event: KeyboardEvent) => {
        if (!(event.metaKey || event.ctrlKey)) return false;
        if (event.altKey) return false;
        return event.key.toLowerCase() === 'z' && event.shiftKey;
    }, []);

    const keyboardCommands = useMemo<KeyboardCommand[]>(() => [
        {
            id: 'undo-track-builder-action',
            enabled: isDeveloperMode && canUndo,
            matches: isUndoShortcut,
            handler: () => {
                void undoGlobalAction().then((didUndo) => {
                    if (didUndo) {
                        setSelectedViaPointIndex(null);
                        setSelectedTrackDeleteIndex(null);
                        setCopyMessage(null);
                    }
                });
            }
        },
        {
            id: 'redo-track-builder-action',
            enabled: isDeveloperMode && canRedo,
            matches: isRedoShortcut,
            handler: () => {
                void redoGlobalAction().then((didRedo) => {
                    if (didRedo) {
                        setSelectedViaPointIndex(null);
                        setSelectedTrackDeleteIndex(null);
                        setCopyMessage(null);
                    }
                });
            }
        },
        {
            id: 'delete-selected-track-point',
            enabled: isDeveloperMode && selectedViaPointIndex !== null,
            matches: (event) => event.key === 'Delete' || event.key === 'Backspace',
            handler: () => {
                const index = selectedViaPointIndex;
                if (index === null) return;

                const point = draftTrackRef.current.viaPoints[index];
                if (!point) return;

                const entry: HistoryEntry<DraftTrackActionType> = {
                    redo: {
                        type: 'delete_point',
                        payload: { index }
                    },
                    undo: {
                        type: 'insert_point',
                        payload: { index, point }
                    }
                };
                executeDraftTrackAction(entry);
                setSelectedViaPointIndex(null);
                setCopyMessage(null);
            }
        },
        {
            id: 'delete-selected-network-track',
            enabled: isDeveloperMode && selectedTrackDeleteIndex !== null && selectedViaPointIndex === null,
            matches: (event) => event.key === 'Delete' || event.key === 'Backspace',
            handler: () => {
                const index = selectedTrackDeleteIndex;
                if (index === null) return;
                void deleteTrackByIndex(index);
            }
        }
    ], [
        canRedo,
        canUndo,
        deleteTrackByIndex,
        executeDraftTrackAction,
        isDeveloperMode,
        isRedoShortcut,
        isUndoShortcut,
        redoGlobalAction,
        selectedTrackDeleteIndex,
        selectedViaPointIndex,
        undoGlobalAction,
    ]);

    useKeyboardCommands(keyboardCommands);

    useEffect(() => {
        if (!map.current || !mapLoaded) return;
        const mapInstance = map.current;
        if (!mapInstance.getLayer('tracks-base')) return;

        const handleTrackClick = (event: MapLayerMouseEvent) => {
            if (!developerModeRef.current) return;

            const rawIndex = event.features?.[0]?.properties?.index;
            const index = typeof rawIndex === 'number' ? rawIndex : Number(rawIndex);
            if (!Number.isInteger(index) || index < 0 || index >= networkTracks.length) return;

            const isDeleteSelect = event.originalEvent.metaKey || event.originalEvent.ctrlKey;
            if (isDeleteSelect) {
                setSelectedTrackDeleteIndex(index);
                setCopyMessage(`Track #${index} selected for deletion. Press Delete/Backspace to remove.`);
                return;
            }

            const interactingWithDraft = mapInstance.queryRenderedFeatures(event.point, {
                layers: ['draft-via-points', 'draft-track-hitbox', 'draft-track-line']
            }).length > 0;
            if (interactingWithDraft) return;

            const track = networkTracks[index];
            setCopyMessage(`Editing track #${index}. Drag points or add new points, then save.`);
            setEditingTrackIndex(index);
            setSelectedTrackDeleteIndex(null);
            setDraftTrack({
                startId: track.endpoints[0],
                endId: track.endpoints[1],
                viaPoints: track.coordinates.slice(1, -1)
            });
            clearDraftTrackHistory();
            setSelectedViaPointIndex(null);
        };

        mapInstance.on('click', 'tracks-base', handleTrackClick);
        return () => {
            mapInstance.off('click', 'tracks-base', handleTrackClick);
        };
    }, [clearDraftTrackHistory, map, mapLoaded, networkTracks, setDraftTrack]);

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

            suppressNextLineInsertRef.current = true;
            draggingViaIndexRef.current = index;
            dragStartPointRef.current = draftTrackRef.current.viaPoints[index] ?? null;
            setSelectedViaPointIndex(index);
            mapInstance.getCanvas().style.cursor = 'grabbing';
            mapInstance.dragPan.disable();
        };

        const handlePointClick = (event: MapLayerMouseEvent) => {
            if (!developerModeRef.current) return;
            const rawIndex = event.features?.[0]?.properties?.index;
            const index = typeof rawIndex === 'number' ? rawIndex : Number(rawIndex);
            if (!Number.isInteger(index)) return;

            suppressNextLineInsertRef.current = true;
            setSelectedViaPointIndex(index);
            setCopyMessage(null);
            window.setTimeout(() => {
                suppressNextLineInsertRef.current = false;
            }, 0);
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
            const activeIndex = draggingViaIndexRef.current;
            if (activeIndex === null) return;

            draggingViaIndexRef.current = null;
            mapInstance.dragPan.enable();
            mapInstance.getCanvas().style.cursor = developerModeRef.current ? 'grab' : '';

            const fromPoint = dragStartPointRef.current;
            const toPoint = draftTrackRef.current.viaPoints[activeIndex];
            dragStartPointRef.current = null;
            if (!fromPoint || !toPoint || pointsEqual(fromPoint, toPoint)) return;

            const entry: HistoryEntry<DraftTrackActionType> = {
                redo: {
                    type: 'move_point',
                    payload: {
                        index: activeIndex,
                        point: toPoint
                    }
                },
                undo: {
                    type: 'move_point',
                    payload: {
                        index: activeIndex,
                        point: fromPoint
                    }
                }
            };
            recordDraftTrackAction(entry);
            setCopyMessage(null);
        };

        mapInstance.on('mouseenter', 'draft-via-points', handleMouseEnter);
        mapInstance.on('mouseleave', 'draft-via-points', handleMouseLeave);
        mapInstance.on('mousedown', 'draft-via-points', handlePointMouseDown);
        mapInstance.on('click', 'draft-via-points', handlePointClick);
        mapInstance.on('mousemove', handleMouseMove);
        mapInstance.on('mouseup', stopDragging);

        return () => {
            mapInstance.off('mouseenter', 'draft-via-points', handleMouseEnter);
            mapInstance.off('mouseleave', 'draft-via-points', handleMouseLeave);
            mapInstance.off('mousedown', 'draft-via-points', handlePointMouseDown);
            mapInstance.off('click', 'draft-via-points', handlePointClick);
            mapInstance.off('mousemove', handleMouseMove);
            mapInstance.off('mouseup', stopDragging);
            mapInstance.dragPan.enable();
            mapInstance.getCanvas().style.cursor = '';
        };
    }, [map, mapLoaded, recordDraftTrackAction, setDraftTrack]);

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
            const startStation = draftTrackRef.current.startId !== null ? stationsById.get(draftTrackRef.current.startId) : undefined;
            const endStation = draftTrackRef.current.endId !== null ? stationsById.get(draftTrackRef.current.endId) : undefined;
            if (!startStation || !endStation) return [];

            return [startStation.lngLat, ...draftTrackRef.current.viaPoints, endStation.lngLat];
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
            if (suppressNextLineInsertRef.current) {
                suppressNextLineInsertRef.current = false;
                return;
            }
            if (!setInsertCandidateFromEvent(event)) return;
            const candidate = insertCandidateRef.current;
            if (!candidate) return;

            const now = Date.now();
            if (now - lastInsertAtRef.current < 120) return;
            lastInsertAtRef.current = now;

            const entry: HistoryEntry<DraftTrackActionType> = {
                redo: {
                    type: 'insert_point',
                    payload: {
                        index: candidate.segmentIndex,
                        point: candidate.midpoint
                    }
                },
                undo: {
                    type: 'delete_point',
                    payload: {
                        index: candidate.segmentIndex
                    }
                }
            };

            executeDraftTrackAction(entry);
            setSelectedViaPointIndex(candidate.segmentIndex);
            setCopyMessage(null);
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
    }, [executeDraftTrackAction, map, mapLoaded, stationsById]);

    useEffect(() => {
        if (!isDeveloperMode && map.current) {
            draggingViaIndexRef.current = null;
            dragStartPointRef.current = null;
            map.current.dragPan.enable();
            map.current.getCanvas().style.cursor = '';
            setSelectedViaPointIndex(null);
            setSelectedTrackDeleteIndex(null);
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
                properties: {
                    index,
                    selected: selectedViaPointIndex === index
                },
                geometry: {
                    type: 'Point' as const,
                    coordinates: point
                }
            }))
        });

        draftInsertSource.setData(createEmptyFeatureCollection());
        insertCandidateRef.current = null;
    }, [draftTrack, isDeveloperMode, map, mapLoaded, selectedViaPointIndex, stationsById]);

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
        setSelectedViaPointIndex(null);

        const current = draftTrackRef.current;
        if (current.startId === null || current.endId !== null) {
            setEditingTrackIndex(null);
            setDraftTrack({
                startId: stationId,
                endId: null,
                viaPoints: []
            });
            clearDraftTrackHistory();
            return;
        }

        if (current.startId === stationId) return;

        setDraftTrack((previous) => ({
            ...previous,
            endId: stationId
        }));
    };

    const resetDraftTrack = () => {
        clearDraftBuilderState();
        setEditingTrackIndex(null);
        setCopyMessage(null);
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
            setEditingTrackIndex(null);
            clearDraftBuilderState();
            setCopyMessage('Track updated successfully.');
            return;
        }

        setSavedDraftTracks((previous) => [...previous, currentDraftTrackObject]);
        clearDraftBuilderState();
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
        selectedTrackDeleteIndex,
        currentDraftTrackObject,
        canUndo,
        canRedo,
        draftStartStation: draftTrack.startId !== null ? stationsById.get(draftTrack.startId) ?? null : null,
        draftEndStation: draftTrack.endId !== null ? stationsById.get(draftTrack.endId) ?? null : null,
        handleStationClick,
        resetDraftTrack,
        saveDraftTrack,
        copyCurrentJson,
        copySavedJson,
        appendSavedTracksToFile,
        selectedViaPointIndex,
    };
}
