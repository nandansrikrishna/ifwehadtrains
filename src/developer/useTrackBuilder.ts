import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { GeoJSONSource, Map as MapboxMap, MapMouseEvent } from 'mapbox-gl';
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
    stationsById: Map<number, Station>;
    setNetworkTracks: Dispatch<SetStateAction<Track[]>>;
}

const DRAFT_LINE_SOURCE = 'draft-track';
const DRAFT_POINTS_SOURCE = 'draft-points';

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
}

export function useTrackBuilder({
    isDevBuild,
    isDeveloperMode,
    map,
    mapLoaded,
    stationsById,
    setNetworkTracks,
}: UseTrackBuilderParams) {
    const developerModeRef = useRef(isDeveloperMode);
    const [draftTrack, setDraftTrack] = useState<DraftTrackState>({
        startId: null,
        endId: null,
        viaPoints: []
    });
    const [savedDraftTracks, setSavedDraftTracks] = useState<Track[]>([]);
    const [copyMessage, setCopyMessage] = useState<string | null>(null);

    useEffect(() => {
        developerModeRef.current = isDeveloperMode;
    }, [isDeveloperMode]);

    useEffect(() => {
        if (!map.current || !mapLoaded) return;
        const mapInstance = map.current;
        if (!mapInstance) return;

        const handleMapClick = (event: MapMouseEvent) => {
            if (!developerModeRef.current) return;
            setCopyMessage(null);
            setDraftTrack((previous) => {
                if (previous.startId === null || previous.endId === null) return previous;
                return {
                    ...previous,
                    viaPoints: [...previous.viaPoints, [event.lngLat.lng, event.lngLat.lat]]
                };
            });
        };

        mapInstance.on('click', handleMapClick);
        return () => {
            mapInstance.off('click', handleMapClick);
        };
    }, [map, mapLoaded]);

    useEffect(() => {
        if (!map.current || !mapLoaded) return;

        const draftLineSource = map.current.getSource(DRAFT_LINE_SOURCE) as GeoJSONSource | undefined;
        const draftPointsSource = map.current.getSource(DRAFT_POINTS_SOURCE) as GeoJSONSource | undefined;
        if (!draftLineSource || !draftPointsSource) return;

        if (!isDeveloperMode) {
            draftLineSource.setData(createEmptyFeatureCollection());
            draftPointsSource.setData(createEmptyFeatureCollection());
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
        setCopyMessage(null);
    };

    const undoLastPoint = () => {
        setCopyMessage(null);
        setDraftTrack((previous) => ({ ...previous, viaPoints: previous.viaPoints.slice(0, -1) }));
    };

    const saveDraftTrack = () => {
        if (!currentDraftTrackObject) return;
        setSavedDraftTracks((previous) => [...previous, currentDraftTrackObject]);
        resetDraftTrack();
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
